// server.js
// Express HTTP server — receives pushes from GRDNConnect instances.
// Runs alongside the Discord bot in index.js.
//
// Environment variables:
//   HTTP_PORT   — port to listen on (default: 3000)
//   HTTP_BIND   — interface to bind (default: 127.0.0.1, loopback only)
//   HTTP_SECRET — legacy global secret, accepted as host-level during migration
//
// Auth: every request carries x-secret, which is one of the two tokens minted for
// the session (see utils/sessionAuth.js). A host token opens everything. A client
// token opens only CLIENT_ROUTES below, because every player in the session holds
// one.
//
// Endpoints:
//   POST /radio-change   — move a crew member's Discord VC based on train number
//   GET  /radio-channels — the crew voice channel list
//   POST /update-crew    — re-assign a crew member to a different train (in-game /setcrew)
//   POST /stats-push     — session stats from the host
//   POST /mod-sync       — (beta) the host's scanned mod list
//   POST /defect-alert   (shelved) acks and drops stray posts
//   GET  /ping           — health check

const express = require('express');
const storage = require('./database/storage');
const db      = require('./database/db');
const { getCrewVCByChannel } = storage;
const { buildNickname }   = require('./utils/nickname');
const { updateTrainBoard } = require('./utils/trainBoard');
const { ChannelType } = require('discord.js');
const { TRAIN_BOARD_CHANNEL_ID, CREW_VC_CATEGORY_ID, MOD_SYNC_BETA } = require('./config');
const { applyScan } = require('./utils/modSync');

const sessionAuth = require('./utils/sessionAuth');

module.exports = function startServer(client) {
    const app    = express();
    const PORT   = process.env.HTTP_PORT   || 3000;
    const SECRET = process.env.HTTP_SECRET || '';

    // ── Steam link prompt dedup ───────────────────────────────────────────────
    // Prevents re-posting the "Is this you?" embed for the same Steam ID within
    // 5 minutes (e.g. if the player boards multiple locos before clicking).
    const pendingLinkPrompts = new Map(); // steamId → timestamp (ms)
    const LINK_PROMPT_COOLDOWN = 5 * 60 * 1000;

    async function postLinkPrompt(guild, steamId, steamName, trainNumber, locoType) {
        const now = Date.now();
        if (pendingLinkPrompts.has(steamId) &&
            now - pendingLinkPrompts.get(steamId) < LINK_PROMPT_COOLDOWN) return;
        pendingLinkPrompts.set(steamId, now);

        const channelId = process.env.STEAM_LINK_CHANNEL_ID;
        if (!channelId) {
            console.log(`[SteamLink] Unlinked Steam ${steamId} (${steamName}) — set STEAM_LINK_CHANNEL_ID in .env to enable auto-prompts`);
            return;
        }
        const channel = guild.channels.cache.get(channelId);
        if (!channel) { console.warn(`[SteamLink] Channel ${channelId} not found in guild`); return; }

        const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

        const embed = new EmbedBuilder()
            .setTitle('🔗 Unlinked player in-game')
            .setColor(0xF0A500)
            .setDescription(
                'A player just boarded their loco but hasn\'t linked their Discord account yet.\n\n' +
                '**If this is you, click the button below — you\'ll never need to again.**'
            )
            .addFields(
                { name: 'Steam Name', value: steamName || 'Unknown', inline: true },
                { name: 'Train',      value: trainNumber || '?',     inline: true },
                { name: 'Loco',       value: locoType    || '?',     inline: true },
            )
            .setTimestamp();

        // Encode train + loco in the button ID so the handler has it at click time.
        // Strip colons (our delimiter) from values as a safety measure — none of these
        // fields should ever contain one, but better safe than a broken split.
        const safeId    = steamId.replace(/:/g, '');
        const safeTrain = (trainNumber || '').replace(/:/g, '');
        const safeLoco  = (locoType    || '').replace(/:/g, '');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`linksteam:${safeId}:${safeTrain}:${safeLoco}`)
                .setLabel('✅  Yes, that\'s me')
                .setStyle(ButtonStyle.Success)
        );

        await channel.send({ embeds: [embed], components: [row] });
        console.log(`[SteamLink] Posted link prompt for Steam ${steamId} (${steamName})`);
    }

    app.use(express.json());

    // ── Auth middleware ───────────────────────────────────────────────────────
    // Routes a client token may use. Everything else is host-only.
    //
    // A client token is held by every player in the session, because the host has
    // to hand one over for crew voice switching to work. So it opens only what a
    // client genuinely needs: moving its own voice channel, and reading the channel
    // list. Crew reassignment, stats and the mod preset stay host-only.
    const CLIENT_ROUTES = new Set(['/radio-change', '/radio-channels', '/ping']);

    app.use((req, res, next) => {
        const provided = req.headers['x-secret'];

        // Preferred: a live per-session token (minted at /session start). During
        // migration also accept the global HTTP_SECRET so already-deployed mods
        // keep working, treating it as host-level. TODO(1.0): drop the HTTP_SECRET
        // branch once every host runs a build that uses session tokens.
        const role = sessionAuth.roleOf(provided)
            ?? ((SECRET && provided === SECRET) ? 'host' : null);

        if (!role) {
            console.warn(`[HTTP] Rejected unauthorised request from ${req.ip}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const path = req.path.toLowerCase();
        if (role === 'client' && !CLIENT_ROUTES.has(path)) {
            console.warn(`[HTTP] Client token refused for ${req.method} ${path} from ${req.ip}`);
            return res.status(403).json({ error: 'Forbidden', detail: 'host token required' });
        }

        req.authRole = role;
        next();
    });

    // ── POST /mod-sync (BETA) ──────────────────────────────────────────────────
    // Body: { mods: [{ id, name?, version?, url?, category? }] }
    // GRDNConnect posts the host's scanned mod list; the bot fills the Auto Sync
    // preset. Gated by MOD_SYNC_BETA so it stays a no-op until the beta is on.
    app.post('/mod-sync', (req, res) => {
        if (!MOD_SYNC_BETA) return res.status(503).json({ ok: false, status: 'beta_disabled' });
        try {
            const mods = req.body?.mods;
            if (!Array.isArray(mods)) return res.status(400).json({ ok: false, status: 'bad_request' });
            const summary = applyScan(mods);
            console.log(`[ModSync] Applied scan: ${summary.total} mod(s) ${JSON.stringify(summary.counts)}${summary.skipped ? `, ${summary.skipped} skipped` : ''}`);
            return res.json({ ok: true, ...summary });
        } catch (err) {
            console.error('[ModSync] apply failed:', err.message);
            return res.status(500).json({ ok: false, status: 'error' });
        }
    });

    // ── POST /radio-change ────────────────────────────────────────────────────
    // Body: { vcId, steamId?, trainNumber? }
    //
    // Resolution order:
    //   1. steamId linked → move that Discord user directly (most accurate,
    //      works even when the player is not in a loco)
    //   2. trainNumber → fall back to the existing crew-lookup by train number
    //
    // The player does NOT need to be in a loco to switch their own VC.
    app.post('/radio-change', async (req, res) => {
        const { vcId, steamId, trainNumber } = req.body ?? {};
        if (!vcId || (!steamId && !trainNumber)) {
            return res.status(400).json({ ok: false, status: 'bad_request' });
        }

        // Resolve a single outcome so the in-game radio can show *why* a switch did
        // or didn't happen, instead of always claiming success. Higher rank wins.
        let status = 'no_match';
        const rank = { no_match: 0, no_member: 1, not_linked: 2, not_in_voice: 3, already_there: 4, moved: 5 };
        const note = s => { if (rank[s] > rank[status]) status = s; };

        try {
            for (const [, guild] of client.guilds.cache) {

                // ── 1. Steam ID resolution ────────────────────────────────────
                if (steamId) {
                    const link = storage.getSteamLink(String(steamId));
                    if (link) {
                        const member = await guild.members.fetch(link.discordId).catch(() => null);
                        if (!member) {
                            console.log(`[Radio] Steam ${steamId}: member not found in guild`);
                            note('no_member');
                        } else if (!member.voice?.channel) {
                            console.log(`[Radio] ${member.displayName}: not in a voice channel — skipped`);
                            note('not_in_voice');
                        } else if (member.voice.channel.id === vcId) {
                            console.log(`[Radio] ${member.displayName}: already in target channel — skipped`);
                            note('already_there');
                        } else {
                            await member.voice.setChannel(vcId).catch(err =>
                                console.error(`[Radio] Failed to move ${link.discordId}:`, err.message)
                            );
                            console.log(`[Radio] Moved ${member.displayName} (steam ${steamId}) → ${vcId}`);
                            note('moved');
                        }
                        continue; // steam link found — don't fall through to train number
                    }
                    console.log(`[Radio] Steam ${steamId}: not linked yet — falling back to train number`);
                    note('not_linked');
                }

                // ── 2. Train number fallback ──────────────────────────────────
                if (!trainNumber) continue;

                const allCrew = storage.getAllCrew(guild.id);
                const crew    = allCrew.filter(c => String(c.trainNumber) === String(trainNumber));

                console.log(`[Radio] Train ${trainNumber} → vcId=${vcId} | ${crew.length}/${allCrew.length} crew matched`);

                for (const c of crew) {
                    const member = await guild.members.fetch(c.userId).catch(() => null);
                    if (!member) {
                        console.log(`[Radio] ${c.preferredName} (${c.userId}): not found in guild`);
                        note('no_member');
                        continue;
                    }
                    if (!member.voice?.channel) {
                        console.log(`[Radio] ${c.preferredName}: not in a voice channel — skipped`);
                        note('not_in_voice');
                        continue;
                    }
                    if (member.voice.channel.id === vcId) {
                        console.log(`[Radio] ${c.preferredName}: already in target channel — skipped`);
                        note('already_there');
                        continue;
                    }
                    await member.voice.setChannel(vcId).catch(err =>
                        console.error(`[Radio] Failed to move ${c.userId}:`, err.message)
                    );
                    console.log(`[Radio] Moved ${c.preferredName} (train ${trainNumber}) → ${vcId}`);
                    note('moved');
                }
            }
        } catch (err) {
            console.error('[Radio] Error:', err.message);
            return res.json({ ok: false, status: 'error' });
        }

        const ok = status === 'moved' || status === 'already_there';
        console.log(`[Radio] vcId=${vcId} → status=${status}`);
        res.json({ ok, status });
    });

    // ── GET /radio-channels ───────────────────────────────────────────────────
    // Returns the current crew voice channels from the bot's guild.
    // Called by GRDNConnect every 60 s so clients joining after /session start
    // can self-populate their channel list without a host relay.
    app.get('/radio-channels', async (req, res) => {
        try {
            for (const [, guild] of client.guilds.cache) {
                const channels = [...guild.channels.cache.values()]
                    .filter(ch =>
                        ch.parentId === CREW_VC_CATEGORY_ID &&
                        ch.type === ChannelType.GuildVoice)
                    .sort((a, b) => a.rawPosition - b.rawPosition)
                    .map(ch => ({ name: ch.name, vcId: ch.id }));
                return res.json({ ok: true, channels });
            }
            res.json({ ok: true, channels: [] });
        } catch (err) {
            console.error('[RadioChannels] Error:', err.message);
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    // ── POST /defect-alert ────────────────────────────────────────────────────
    // SHELVED: defect detection was scrapped, and the voice alerts that announced
    // defects are gone too. The mod no longer sends these. Ack and drop any stray
    // or forged POST. The old body is in git history.
    app.post('/defect-alert', (req, res) => res.json({ ok: true, shelved: true }));

    // ── POST /update-crew ─────────────────────────────────────────────────────
    // Body: { fromTrainNumber?, toTrainNumber, locoType?, steamId?, steamName? }
    //
    // Called by the in-game GRDN Crew CommsRadio mode when a player boards a loco.
    // Resolution order:
    //   1. steamId linked + existing crew record → update train number by discordId
    //   2. steamId linked + NO crew record + player in crew VC → auto-register them
    //      (sends a DM to confirm — zero commands needed for first-time setup)
    //   3. steamId provided + NOT linked → post "Is this you?" prompt, fall through
    //   4. fromTrainNumber lookup (original behaviour — final fallback)
    //
    // fromTrainNumber is optional when steamId resolves the player directly.
    app.post('/update-crew', async (req, res) => {
        const { fromTrainNumber, toTrainNumber, locoType, steamId, steamName } = req.body ?? {};
        if (!toTrainNumber) {
            return res.status(400).json({ error: 'Missing toTrainNumber' });
        }

        let updatedRow;
        let resolvedByLink  = false;
        let autoRegistered  = false;  // true only when we created a brand-new crew record
        let autoMember      = null;   // resolved Discord member, used for DM after res.json

        // ── 1 & 2. Steam link resolution ─────────────────────────────────────
        if (steamId) {
            const link = storage.getSteamLink(String(steamId));

            if (link) {
                try {
                    // Check for existing active registration first
                    const existing = db.prepare(`
                        SELECT user_id, type, train_number, loco_type, preferred_name
                        FROM registrations WHERE user_id = ? AND active = 1
                    `).get(link.discordId);

                    if (existing) {
                        // ── 1. Already registered — update train/loco only ────
                        // If they were a Controller but are now boarding a loco, flip them
                        // to Road Crew automatically so hours track correctly.
                        db.prepare(`
                            UPDATE registrations
                            SET train_number = ?,
                                loco_type    = CASE WHEN ? IS NOT NULL THEN ? ELSE loco_type END,
                                type         = CASE WHEN type = 'Controller' THEN 'Road Crew' ELSE type END
                            WHERE user_id = ? AND active = 1
                        `).run(toTrainNumber, locoType ?? null, locoType ?? null, link.discordId);

                        resolvedByLink = true;
                        updatedRow = db.prepare(`
                            SELECT user_id, type, train_number, loco_type, preferred_name
                            FROM registrations WHERE user_id = ? AND active = 1
                        `).get(link.discordId);

                        const locoTag = locoType ? ` [${locoType}]` : '';
                        console.log(`[CrewUpdate] Steam-linked update: ${existing.train_number || '?'} → ${toTrainNumber}${locoTag} (${link.discordId})`);

                    } else {
                        // ── 2. No record yet — auto-register if in crew VC ────
                        for (const [, guild] of client.guilds.cache) {
                            const member = await guild.members.fetch(link.discordId).catch(() => null);
                            if (!member) continue;

                            if (member.voice?.channel?.parentId !== CREW_VC_CATEGORY_ID) {
                                console.log(`[CrewUpdate] ${member.displayName}: not in crew VC — skipping auto-register`);
                                continue;
                            }

                            storage.upsertCrew(link.discordId, 'Crew', toTrainNumber, member.displayName, locoType ?? null);
                            resolvedByLink = true;
                            autoRegistered = true;
                            autoMember     = member;

                            updatedRow = db.prepare(`
                                SELECT user_id, type, train_number, loco_type, preferred_name
                                FROM registrations WHERE user_id = ? AND active = 1
                            `).get(link.discordId);

                            const locoTag = locoType ? ` [${locoType}]` : '';
                            console.log(`[CrewUpdate] Auto-registered: ${member.displayName} → Train ${toTrainNumber}${locoTag}`);
                            break; // one guild is enough
                        }

                        if (!resolvedByLink)
                            console.log(`[CrewUpdate] Steam ${steamId}: linked but not in crew VC — skipped auto-register`);
                    }
                } catch (err) {
                    console.error('[CrewUpdate] Steam-link resolution error:', err.message);
                }

            } else {
                // Not linked — fire the "Is this you?" prompt in all guilds
                for (const [, guild] of client.guilds.cache) {
                    postLinkPrompt(guild, String(steamId), steamName || 'Unknown', toTrainNumber, locoType)
                        .catch(err => console.error('[SteamLink] postLinkPrompt error:', err.message));
                }
            }
        }

        // ── 3. Fallback: fromTrainNumber lookup ───────────────────────────────
        if (!resolvedByLink) {
            if (!fromTrainNumber) {
                // steamId was provided but didn't resolve (unlinked / not in VC) — that's ok
                if (steamId) return res.json({ ok: true, updated: 0, note: 'Steam ID not linked yet' });
                return res.status(400).json({ error: 'Missing fromTrainNumber' });
            }

            try {
                // For multi-crew trains, only the most recently registered person on
                // fromTrainNumber is moved. Pin that user first so updatedRow is the
                // player who moved, not whoever registered last on toTrainNumber.
                const target = db.prepare(`
                    SELECT user_id FROM registrations
                    WHERE train_number = ? AND active = 1
                    ORDER BY rowid DESC
                    LIMIT 1
                `).get(fromTrainNumber);

                if (!target) {
                    if (steamId) {
                        return res.json({ ok: true, updated: 0, note: 'Steam ID not linked yet' });
                    }
                    console.log(`[CrewUpdate] No crew found for train ${fromTrainNumber}`);
                    return res.status(404).json({ ok: false, error: 'No crew found for fromTrainNumber' });
                }

                db.prepare(`
                    UPDATE registrations
                    SET train_number = ?,
                        loco_type    = CASE WHEN ? IS NOT NULL THEN ? ELSE loco_type END
                    WHERE user_id = ? AND active = 1
                `).run(toTrainNumber, locoType ?? null, locoType ?? null, target.user_id);

                updatedRow = db.prepare(`
                    SELECT user_id, type, train_number, loco_type, preferred_name
                    FROM registrations WHERE user_id = ? AND active = 1
                `).get(target.user_id);

            } catch (err) {
                console.error('[CrewUpdate] Error:', err.message);
                return res.status(500).json({ ok: false, error: 'Internal error' });
            }
        }

        const locoTag = locoType ? ` [${locoType}]` : '';
        console.log(`[CrewUpdate] ${fromTrainNumber || '?'} → ${toTrainNumber}${locoTag}`);
        res.json({ ok: true });

        // ── Channel confirmation — only on first-time auto-registration ─────
        // Posts to STEAM_LINK_CHANNEL_ID (same channel as the link prompt) so
        // the player sees it without needing DMs open.
        if (autoRegistered && autoMember) {
            try {
                const channelId = process.env.STEAM_LINK_CHANNEL_ID;
                const channel   = channelId
                    ? autoMember.guild.channels.cache.get(channelId)
                    : null;
                if (channel) {
                    const locoLabel = locoType ? ` (${locoType})` : '';
                    await channel.send(
                        `✅ ${autoMember} auto-assigned → Train **${toTrainNumber}**${locoLabel}`
                    );
                }
            } catch (err) {
                console.error('[CrewUpdate] Auto-register channel message error:', err.message);
            }
        }

        // ── Post-response: sync nickname, crew VC name, enroll in hours, and train board ─
        // These run after the HTTP response is sent — failures are non-fatal.
        // Every crew member on toTrainNumber is visited so their crew VC picks up the
        // train number, but only the player whose row changed (updatedRow) is renamed
        // and enrolled.
        try {
            for (const [, guild] of client.guilds.cache) {
                const crew = storage.getAllCrew(guild.id)
                    .filter(c => String(c.trainNumber) === String(toTrainNumber));

                for (const c of crew) {
                    const member = await guild.members.fetch(c.userId).catch(() => null);
                    if (!member) continue;

                    const isChanger = !!updatedRow && c.userId === updatedRow.user_id;

                    // Sync Discord nickname
                    if (isChanger) {
                        const nick = buildNickname(
                            updatedRow.type,
                            updatedRow.train_number,
                            updatedRow.preferred_name
                        );
                        await member.setNickname(nick).catch(() => {});
                    }

                    // Rename crew VC if they're in one
                    if (member.voice?.channel) {
                        const vc = getCrewVCByChannel(member.voice.channel.id);
                        if (vc) {
                            await member.voice.channel
                                .setName(`(${toTrainNumber}) | Crew ${vc.crew_number}`)
                                .catch(() => {});
                        }
                    }

                    // Enroll in session hour tracking — mirrors enrollIfSessionActive in setcrew.js.
                    // Without this, players who registered via the in-game radio instead of /setcrew
                    // were never added to session_crew and never had their hours clock started.
                    // Changer only: crewmates opted in through their own /setcrew or radio
                    // update, and member.voice must be the changer's, not a crewmate's.
                    const activeSession = storage.getActiveSession(guild.id);
                    if (activeSession && isChanger) {
                        const category = storage.classifyCategory(c.type, c.trainNumber);
                        if (category) {
                            storage.addToSessionCrew(activeSession.id, c.userId);
                            // Only official ops and stress tests accrue hours.
                            if (member.voice?.channel && storage.sessionTracksHours(activeSession)) {
                                storage.openOpsEntry(c.userId, guild.id, activeSession.id, category, Date.now());
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[CrewUpdate] Post-sync error:', err.message);
        }

        // Refresh train board if a session is active
        try {
            for (const [, guild] of client.guilds.cache) {
                if (!storage.getActiveSession(guild.id)) continue;
                await updateTrainBoard(client, guild.id, TRAIN_BOARD_CHANNEL_ID);
            }
        } catch (err) {
            console.error('[CrewUpdate] TrainBoard refresh failed:', err.message);
        }

    });

    // ── POST /stats-push ──────────────────────────────────────────────────────
    // Body: { entries: [{ trainNumber, carMiles }] }
    // GRDNConnect pushes car-miles for each active train every 60 s.
    // Resolves train number → Discord user via the registrations table,
    // then upserts user_session_stats and user_lifetime_stats.
    app.post('/stats-push', async (req, res) => {
        const { entries } = req.body ?? {};
        if (!Array.isArray(entries) || entries.length === 0)
            return res.json({ ok: true, recorded: 0 });

        let recorded = 0;
        for (const [, guild] of client.guilds.cache) {
            const session = storage.getActiveSession(guild.id);
            if (!session) continue;

            for (const { trainNumber, carMiles } of entries) {
                if (!trainNumber || !carMiles || carMiles <= 0) continue;
                const reg = storage.getRegistrationByTrainNumber(String(trainNumber));
                if (!reg) {
                    console.log(`[StatsPush] No registration for train ${trainNumber} — skipped`);
                    continue;
                }
                storage.addCarMiles(session.id, reg.userId, carMiles);
                recorded++;
            }
        }

        console.log(`[StatsPush] Recorded ${recorded} car-mile update(s) from ${entries.length} train(s)`);
        res.json({ ok: true, recorded });
    });

    // ── Health check ──────────────────────────────────────────────────────────
    app.get('/ping', (req, res) => res.json({ ok: true }));

    // Bind to loopback only. cloudflared runs on this machine and reaches the
    // server at http://localhost:3000, so nothing legitimate needs an external
    // interface. Without the explicit host, Node binds 0.0.0.0 and the VPS's
    // public IP answers on this port directly, which skips Cloudflare entirely:
    // no WAF, no rate limiting, no Access. Set HTTP_BIND to override.
    const BIND = process.env.HTTP_BIND || '127.0.0.1';
    app.listen(PORT, BIND, () => {
        console.log(`[HTTP] Bot server listening on ${BIND}:${PORT}`);
    });
};

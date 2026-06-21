// server.js
// Express HTTP server — receives pushes from GRDNConnect instances.
// Runs alongside the Discord bot in index.js.
//
// Environment variables:
//   HTTP_PORT   — port to listen on (default: 3000)
//   HTTP_SECRET — shared secret; set the same value in GRDNConnect settings
//
// Endpoints:
//   POST /radio-change   — move a crew member's Discord VC based on train number
//   POST /defect-alert   — announce a hotbox/defect to opted-in crew
//   POST /update-crew    — re-assign a crew member to a different train (in-game /setcrew)
//   GET  /ping           — health check

const express = require('express');
const storage = require('./database/storage');
const db      = require('./database/db');
const { getCrewVCByChannel } = storage;
const { buildNickname }   = require('./utils/nickname');
const { updateTrainBoard } = require('./utils/trainBoard');
const { ChannelType } = require('discord.js');
const { TRAIN_BOARD_CHANNEL_ID, CREW_VC_CATEGORY_ID } = require('./config');

// voiceAlert is optional — gracefully absent if @discordjs/voice isn't installed
let alertTrain, alertChannel;
try {
    ({ alertTrain, alertChannel } = require('./utils/voiceAlert'));
} catch {
    alertTrain = alertChannel = null;
}

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
    app.use((req, res, next) => {
        if (SECRET && req.headers['x-secret'] !== SECRET) {
            console.warn(`[HTTP] Rejected unauthorised request from ${req.ip}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
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
    // Body: { trainNumber, defectType, message, detail? }
    //
    // GRDNConnect sends a pre-formatted CSX MicroHBD-style message.
    // Bot joins the VC of opted-in crew and plays it via TTS.
    app.post('/defect-alert', async (req, res) => {
        const { trainNumber, defectType, message, detail } = req.body ?? {};
        if (!trainNumber || !defectType || !message) {
            return res.status(400).json({ error: 'Missing trainNumber, defectType, or message' });
        }
        res.json({ ok: true });

        try {
            for (const [, guild] of client.guilds.cache) {
                // Alert ALL opted-in crew regardless of which train the defect is on.
                // If you've opted in, you hear every defect across the whole session.
                const allCrew = storage.getAllCrew(guild.id);

                const alertedChannels = new Set();
                for (const c of allCrew) {
                    const pref = db.prepare(
                        `SELECT enabled FROM defect_prefs WHERE user_id = ?`
                    ).get(c.userId);

                    if (!pref?.enabled) continue;

                    const member = await guild.members.fetch(c.userId).catch(() => null);
                    const vc = member?.voice?.channel;
                    if (!vc || alertedChannels.has(vc.id)) continue;

                    alertedChannels.add(vc.id);
                    console.log(`[Defect] ${defectType} (train ${trainNumber}) → ${c.userId} in ${vc.name}`);

                    if (alertChannel) {
                        alertChannel(guild, vc.id, trainNumber, defectType, detail ?? null).catch(err =>
                            console.error('[Defect] Voice alert failed:', err.message)
                        );
                    }
                }
            }
        } catch (err) {
            console.error('[Defect] Error:', err.message);
        }
    });

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
                        // If they were a Dispatcher but are now boarding a loco, flip them
                        // to Road Crew automatically so hours track correctly.
                        db.prepare(`
                            UPDATE registrations
                            SET train_number = ?,
                                loco_type    = CASE WHEN ? IS NOT NULL THEN ? ELSE loco_type END,
                                type         = CASE WHEN type = 'Dispatcher' THEN 'Road Crew' ELSE type END
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
                // LIMIT 1 via rowid subquery — for multi-crew trains, only the most recently
                // registered person is moved. Avoids clobbering both registrations when one
                // of a two-person crew switches locos mid-op.
                const result = db.prepare(`
                    UPDATE registrations
                    SET train_number = ?,
                        loco_type    = CASE WHEN ? IS NOT NULL THEN ? ELSE loco_type END
                    WHERE rowid IN (
                        SELECT rowid FROM registrations
                        WHERE train_number = ? AND active = 1
                        ORDER BY rowid DESC
                        LIMIT 1
                    )
                `).run(toTrainNumber, locoType ?? null, locoType ?? null, fromTrainNumber);

                if (result.changes === 0) {
                    if (steamId) {
                        return res.json({ ok: true, updated: 0, note: 'Steam ID not linked yet' });
                    }
                    console.log(`[CrewUpdate] No crew found for train ${fromTrainNumber}`);
                    return res.status(404).json({ ok: false, error: 'No crew found for fromTrainNumber' });
                }

                updatedRow = db.prepare(`
                    SELECT user_id, type, train_number, loco_type, preferred_name
                    FROM registrations
                    WHERE train_number = ? AND active = 1
                    ORDER BY rowid DESC LIMIT 1
                `).get(toTrainNumber);

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
        try {
            for (const [, guild] of client.guilds.cache) {
                const crew = storage.getAllCrew(guild.id)
                    .filter(c => String(c.trainNumber) === String(toTrainNumber));

                for (const c of crew) {
                    const member = await guild.members.fetch(c.userId).catch(() => null);
                    if (!member) continue;

                    // Sync Discord nickname
                    if (updatedRow) {
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
                    const activeSession = storage.getActiveSession(guild.id);
                    if (activeSession && updatedRow) {
                        const category = storage.classifyCategory(updatedRow.type, updatedRow.train_number);
                        if (category) {
                            storage.addToSessionCrew(activeSession.id, updatedRow.user_id);
                            if (member.voice?.channel) {
                                storage.openOpsEntry(updatedRow.user_id, guild.id, activeSession.id, category, Date.now());
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

    app.listen(PORT, () => {
        console.log(`[HTTP] Bot server listening on port ${PORT}`);
    });
};

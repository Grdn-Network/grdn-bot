// commands/ops/session.js
// /session action:[start|end|jobs|board|embed]
//
//   start — open official ops session, sync embed from GRDNConnect
//   end   — close session, save hours, reset nicknames
//   jobs  — list active DV jobs
//   board — force-post a fresh Train Board
//   embed — post or restore the Operations dispatch embed

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch    = require('node-fetch');
const fs       = require('fs');
const path     = require('path');
const db       = require('../../database/db');
const storage  = require('../../database/storage');
const { hasAnyRole }                             = require('../../utils/permissions');
const { updateTrainBoard }                       = require('../../utils/trainBoard');
const { buildDispatchEmbed, buildDispatchComponents, deriveDvConnectUrl } = require('../../utils/dispatchEmbed');
const { deleteAllCrewVCs }                       = require('../../utils/crewVCManager');
const sessionAuth                                = require('../../utils/sessionAuth');
const { cfAccessHeaders }                        = require('../../utils/hostConnect');
const { pushSessionConfig, forgetHost }          = require('../../utils/sessionConfig');
const { sendLog }                                = require('../../logging/logHelper');
const loggingConfig                              = require('../../config/logging.json');
const {
    ADMIN_ROLE, HOST_ROLE, DISPATCH_QUAL_ROLE, DVMP_COMMAND_ROLE,
    DISPATCH_CHANNEL_ID, TRAIN_BOARD_CHANNEL_ID, OPS_CATEGORY_ID,
} = require('../../config');
const { requireCategory } = require('../../utils/commandChannel');

const FETCH_TIMEOUT_MS = 5000;

// handleStart and handleEnd are exported so the dispatch embed buttons
// (buttons/syncnames.js and buttons/endop.js) can call them directly.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('session')
        .setDescription('Manage the ops session.')
        .addStringOption(opt => opt
            .setName('action')
            .setDescription('What to do')
            .setRequired(true)
            .addChoices(
                { name: 'Start — open an official ops session',        value: 'start' },
                { name: 'End — close session and save hours',          value: 'end'   },
                { name: 'Jobs — list active Derail Valley jobs',       value: 'jobs'  },
                { name: 'Board — force-refresh the Train Board',       value: 'board' },
                { name: 'Embed — post or restore the ops embed',       value: 'embed' },
            )
        ),

    async execute(interaction) {
        if (!await requireCategory(interaction, OPS_CATEGORY_ID)) return;

        const action = interaction.options.getString('action');
        if (action === 'start') return handleStart(interaction);
        if (action === 'end')   return handleEnd(interaction);
        if (action === 'jobs')  return handleJobs(interaction);
        if (action === 'board') return handleBoard(interaction);
        if (action === 'embed') return handleEmbed(interaction);
    },

    // Exposed for button handlers
    handleStart,
    handleEnd,
    canStartSession,
};

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

// Who can open an ops session. Hosts and admins run sessions; Controller Qual
// (dispatch) does not. Sessions are always official now: unofficial and stress
// test were retired in #39.
function canStartSession(member) {
    return hasAnyRole(member, [ADMIN_ROLE, HOST_ROLE]);
}

// ── start ─────────────────────────────────────────────────────────────────────

async function syncEmbedFromMod(guild) {
    // Step 1 — mark ops active immediately.
    // Do this first so the embed shows correctly even if the game is offline.
    db.prepare(`
        INSERT OR IGNORE INTO dispatch_settings (id, server_name, server_password, remote_link, remote_password)
        VALUES (1, 'Not set', 'Not set', 'Not set', 'GRDN')
    `).run();
    db.prepare(`UPDATE dispatch_settings SET ops_active = 1 WHERE id = 1`).run();

    // Step 2 — resolve the GRDNConnect URL.
    // Prefer a Remote Dispatch link (e.g. grdn.grdnnetwork.com → grdn-connect.grdnnetwork.com).
    // If none is set or it can't be derived, fall back to the stored tunnel URL.
    const stored  = db.prepare(`SELECT remote_link FROM dispatch_settings WHERE id = 1`).get();
    const rdLink  = stored?.remote_link;
    const derived = (rdLink && rdLink !== 'Not set') ? deriveDvConnectUrl(rdLink) : null;
    const connectUrl = derived ?? storage.getDvBaseUrl();
    if (connectUrl) storage.setDvUrl(connectUrl);

    // Step 3 — try to fetch server name / password (and interchange mode) from GRDNConnect.
    // A failure here is non-fatal — session is already marked active.
    let serverName, password, gameStatus;
    let interchangeMode = false;

    if (!connectUrl) {
        gameStatus = 'no_url';
    } else try {
        const res = await fetch(`${connectUrl}/server-info`, { headers: cfAccessHeaders(), timeout: FETCH_TIMEOUT_MS });
        if (res.ok) {
            const data = await res.json();
            serverName      = data.serverName;
            password        = data.password;
            interchangeMode = !!data.interchangeMode;
            gameStatus      = 'ok';
        } else {
            gameStatus = `HTTP ${res.status}`;
        }
    } catch (err) {
        gameStatus = 'unreachable';
    }

    // Step 4 — write whatever info we got into the DB.
    if (serverName) {
        db.prepare(`UPDATE dispatch_settings SET server_name     = ? WHERE id = 1`).run(serverName);
    } else {
        // Game unreachable — clear stale server name so old session info doesn't show
        db.prepare(`UPDATE dispatch_settings SET server_name = 'Not set' WHERE id = 1`).run();
    }
    if (password) {
        db.prepare(`UPDATE dispatch_settings SET server_password = ? WHERE id = 1`).run(password);
    } else {
        // Same for password — don't carry over a stale value from a previous session
        db.prepare(`UPDATE dispatch_settings SET server_password = 'Not set' WHERE id = 1`).run();
    }
    if (rdLink && rdLink !== 'Not set')
        db.prepare(`UPDATE dispatch_settings SET remote_link = ? WHERE id = 1`).run(rdLink);

    // Step 5 — push the updated embed to Discord.
    const embedRow = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
    if (!embedRow) return { status: '✅ Session open — no embed posted yet (run `/operembed`).', interchangeMode };

    const channel = guild.channels.cache.get(DISPATCH_CHANNEL_ID);
    if (!channel)  return { status: '✅ Session open — dispatch channel not found.', interchangeMode };

    const msg = await channel.messages.fetch(embedRow.message_id).catch(() => null);
    if (!msg)  return { status: '✅ Session open — embed message not found (run `/operembed`).', interchangeMode };

    await msg.edit({ embeds: [buildDispatchEmbed()], components: msg.components });

    if (serverName) return { status: `✅ Embed updated — **${serverName}** | ${rdLink || connectUrl}`, interchangeMode };
    if (gameStatus === 'no_url')
        return { status: `✅ Session open, but no host tunnel URL could be resolved. Set Server Name and Password manually with \`/editembed\`.`, interchangeMode };
    if (gameStatus === 'unreachable')
        return { status: `✅ Session open — game not reachable yet. Use \`/editembed\` to set Server Name and Password manually.`, interchangeMode };
    return { status: `✅ Session open — GRDNConnect at \`${connectUrl}\` returned status: ${gameStatus}.`, interchangeMode };
}

async function handleStart(interaction) {
    const sessionType = 'official';

    if (!canStartSession(interaction.member)) {
        return interaction.reply({
            content: '❌ Only admins and hosts can start an ops session.',
            flags: 64,
        });
    }

    // Block starting a new op while one is already running. Starting would
    // orphan-close the live session and wipe the embed info, which has been
    // abused. The current op must be ended first (End Operation).
    if (storage.getActiveSession(interaction.guild.id)) {
        return interaction.reply({
            content: '❌ An operation is already running. End it first with **End Operation** before starting a new one.',
            flags: 64,
        });
    }

    // ── Resolve the clicker's Cloudflare tunnel ───────────────────────────────
    // Whoever clicks Start Op IS the host for this session — their tunnel is used.
    // host-tunnels.json: { "discordUserId": "tunnelName", ... }
    // "red" → Remote Dispatch: https://red.grdnnetwork.com
    //       → GRDNConnect:     https://red-connect.grdnnetwork.com
    // Checked before the session opens. A host with no tunnel is told to get one
    // instead of getting a session the bot can't reach (or that pushes this
    // session's token to the previous host).
    let tunnelName;
    try {
        const tunnelsPath = path.join(__dirname, '../../host-tunnels.json');
        tunnelName = JSON.parse(fs.readFileSync(tunnelsPath, 'utf8'))[interaction.user.id];
    } catch (err) {
        return interaction.reply({ content: `❌ Could not read \`host-tunnels.json\`: ${err.message}`, flags: 64 });
    }
    if (!tunnelName) {
        console.log(`[Session] ${interaction.user.tag} → not in host-tunnels.json, start refused`);
        return interaction.reply({
            content: `❌ You don't have a host tunnel yet, so the bot can't reach your game. Ask <@&${DVMP_COMMAND_ROLE}> to set up your \`-connect\` tunnel, then start the op again.`,
            flags: 64,
            allowedMentions: { parse: [] },
        });
    }

    await interaction.deferReply({ flags: 64 });
    const now = Date.now();
    const sessionId = storage.openSession(interaction.guild.id, interaction.user.id, now, sessionType);

    const rdLink = `https://${tunnelName}.grdnnetwork.com`;
    db.prepare(`
        INSERT OR IGNORE INTO dispatch_settings
            (id, server_name, server_password, remote_link, remote_password)
        VALUES (1, 'Not set', 'Not set', 'Not set', 'GRDN')
    `).run();
    db.prepare(`UPDATE dispatch_settings SET remote_link = ? WHERE id = 1`).run(rdLink);
    const connectUrl = deriveDvConnectUrl(rdLink);
    console.log(`[Session] ${interaction.user.tag} → tunnel "${tunnelName}" → ${connectUrl}`);

    // ── Push bot URL, tokens and live crew channels to GRDNConnect ───────────
    // A fresh token pair is minted here, so this push is unconditional. The host
    // keeps the host token and relays the client token to its clients.
    //
    // Run the push and the embed sync concurrently so their host round-trips do not
    // stack against the deferReply, then surface a failed push below. The push used
    // to be fire-and-forget, so a refused or unreachable push left /session start
    // reporting success while radio and voice were silently dead. The push resolver
    // reports failure in its result rather than rejecting, but guard it anyway so a
    // thrown push cannot turn a started session into a command error.
    const [pushResult, { status: embedStatus }] = await Promise.all([
        pushSessionConfig(interaction.guild, { mint: true, reason: 'session start' })
            .catch(err => ({ pushed: false, error: err.message })),
        syncEmbedFromMod(interaction.guild),
    ]);

    // Interchange Mode — SHELVED. We are not running interchange ops for now, and
    // the mod now always reports interchangeMode false.
    //
    // Nothing about stats depended on this. Every /complete is still classified as
    // local / hub_inbound / hub_outbound / interchange from the configured hub
    // stations (see complete.js -> classifyLeg), so car-km, job counts, leg types
    // and role labels are unaffected. All of that data is untouched.
    //
    // This block only wrote ops_sessions.ops_mode, which nothing ever read back.
    // setSessionOpsMode/getSessionOpsMode are kept in storage.js for the revival.
    //
    // To revive: restore the setting in the mod's Settings.cs and the
    // interchangeMode field in its /server-info, then uncomment below.
    //   const { interchangeMode: isInterchangeMode } = await syncEmbedFromMod(...);
    //   if (isInterchangeMode) {
    //       storage.setSessionOpsMode(sessionId, 'interchange');
    //       console.log(`[Session] Interchange Mode active for session ${sessionId}`);
    //   }

    const sessionTypeLabel = 'Official';

    const logEmbed = new EmbedBuilder()
        .setTitle('🟢 Ops Session Opened')
        .setColor(0x57f287)
        .addFields(
            { name: 'Started by',    value: `<@${interaction.user.id}>`,                              inline: true },
            { name: 'Session Type',  value: sessionTypeLabel,                                         inline: true },
            // Mode field dropped with Interchange Mode: it only ever read
            // 'Standard' once interchange was shelved, so it was a field that
            // could not vary. Restore alongside the block above.
            //   { name: 'Mode', value: isInterchangeMode ? '🔄 Interchange' : 'Standard', inline: true },
            { name: 'Dispatch',      value: embedStatus,                                               inline: false },
        )
        .setTimestamp()
        .setFooter({ text: 'GRDN Ops' });

    sendLog(interaction.client, loggingConfig.logChannel, logEmbed);

    updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
        .catch(err => console.error('[TrainBoard] session start update failed:', err));

    // modeNote dropped with Interchange Mode; restore alongside the block above.
    //   const modeNote = isInterchangeMode ? '\n• **🔄 Interchange Mode** — stats and role labels active' : '';

    return interaction.editReply({
        content:
            `✅ ${sessionTypeLabel} ops session open.\n` +
            `• Crew: run **/setcrew** with your **train number** to join\n` +
            `• Dispatch embed: ${embedStatus}` +
            pushWarning(pushResult),
    });
}

// Turns a failed session-config push into a line appended to the /session start
// reply, so a refused or unreachable host is visible to whoever opened the session
// instead of only in the VPS console. Returns '' on success. Carries no token or
// URL value, only field names, so it is safe to show in Discord.
function pushWarning(result) {
    if (!result || result.pushed) return '';
    if (result.status === 403)
        return '\n\n⚠️ The host refused the config (403). Check the host\'s connect.cfg bot URL and the bot\'s BOT_PUBLIC_URL; if every host shows this, check the Cloudflare Access service token. Fix it, then rerun **/session start**.';
    if (result.status)
        return `\n\n⚠️ The host rejected the config push (HTTP ${result.status}). Radio and voice switching will not work until it is resolved, then rerun **/session start**.`;
    if (result.error)
        return '\n\n⚠️ The host could not be reached to receive its config. Radio and voice switching will not work until the host is online, then rerun **/session start**.';
    if (result.skipped === 'BOT_PUBLIC_URL unset')
        return '\n\n⚠️ The bot\'s public URL is not configured, so the host was not sent its config. Ask an admin to set BOT_PUBLIC_URL on the bot host.';
    if (result.skipped)
        return `\n\n⚠️ The host was not sent its config (${result.skipped}). Radio and voice switching may not work.`;
    return '';
}

// ── end ───────────────────────────────────────────────────────────────────────

async function handleEnd(interaction) {
    const guild = interaction.guild;
    const now   = Date.now();

    // Fetch the active session up front: it drives both the permission check
    // (the person who started this op may end it) and the cleanup below.
    const activeSession = storage.getActiveSession(guild.id);

    // Who may end an op: staff and DVMP Command can end any op; the person who
    // started the current op can end their own. Nobody else, to stop trolling.
    const isStaff   = hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE]);
    const isStarter = !!activeSession && activeSession.started_by === interaction.user.id;
    if (!isStaff && !isStarter) {
        return interaction.reply({
            content: '❌ Only staff, DVMP Command, or the person who started this op can end it.',
            flags: 64,
        });
    }

    await interaction.reply({ content: '🔄 Closing ops session and resetting nicknames…', flags: 64 });

    // Capture participants BEFORE closing — closeSession wipes session_crew
    const participants  = activeSession ? storage.getSessionCrew(activeSession.id) : [];

    // Build the unified reset set: session_crew participants + anyone in the crew DB
    // who has a train number set. The second group catches people who ran /setcrew
    // before the session opened — enrollIfSessionActive is a no-op when no session is
    // active, so those users never land in session_crew, but their nickname is still
    // formatted with a train number and needs to be cleared on end-op.
    const allCrew = storage.getAllCrew(guild.id);
    const toReset = new Map(); // userId → preferredName

    for (const userId of participants) {
        const crew = storage.getCrewRaw(userId);
        toReset.set(userId, crew?.preferred_name ?? null);
    }
    for (const c of allCrew) {
        if (!toReset.has(c.userId) && c.trainNumber && c.trainNumber.trim()) {
            toReset.set(c.userId, c.preferredName ?? null);
        }
    }

    // Close session — writes final minutes to ops_log, clears session_crew
    const sessionId = storage.closeSession(guild.id, interaction.user.id, now);
    sessionAuth.clear(); // revoke both of this session's auth tokens
    forgetHost();        // next session pushes config unconditionally

    let reset = 0, failed = 0;

    for (const [userId, preferredName] of toReset) {
        try {
            storage.clearTrainNumber(userId);

            // 10007 = Unknown Member (definitively left server)
            const member = await guild.members.fetch(userId)
                .catch(err => err.code === 10007 ? null : undefined);
            if (member === null) { storage.removeCrew(userId); continue; }
            if (member === undefined) { failed++; continue; }

            try {
                await member.setNickname(preferredName);
                reset++;
            } catch (err) {
                if (err?.code === 50013) { reset++; } // Missing Permissions (e.g. server owner)
                else { failed++; }
            }
        } catch { failed++; }
    }

    storage.clearAllAssignments(guild.id);
    await deleteAllCrewVCs(guild.client, guild.id);

    // Mark op inactive + refresh dispatch embed.
    // The Remote Dispatch password is not hidden when ops are inactive (unlike the
    // server name/password), so reset it to the default instead of leaving the last
    // session's password on public display.
    try {
        db.prepare(`UPDATE dispatch_settings SET ops_active = 0, remote_password = 'GRDN' WHERE id = 1`).run();
        const embedRow = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
        if (embedRow) {
            const ch = guild.channels.cache.get(DISPATCH_CHANNEL_ID);
            if (ch) {
                const msg = await ch.messages.fetch(embedRow.message_id).catch(() => null);
                if (msg) await msg.edit({ embeds: [buildDispatchEmbed()], components: msg.components });
            }
        }
    } catch (err) {
        console.error('[session end] dispatch embed update failed:', err);
    }

    const logEmbed = new EmbedBuilder()
        .setTitle('🔴 Ops Session Closed')
        .setColor(0xed4245)
        .addFields(
            { name: 'Closed by',       value: `<@${interaction.user.id}>`,                 inline: true },
            { name: 'Nicknames reset', value: `${reset} reset, ${failed} failed`,          inline: true },
            { name: 'Hours',           value: sessionId ? 'Saved ✓' : 'No active session', inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'GRDN Ops' });

    sendLog(interaction.client, loggingConfig.logChannel, logEmbed);

    updateTrainBoard(interaction.client, guild.id, TRAIN_BOARD_CHANNEL_ID)
        .catch(err => console.error('[TrainBoard] session end update failed:', err));

    return interaction.followUp({
        content:
            `✅ Reset complete.\n` +
            `• Nicknames reset: **${reset}** | Failed: **${failed}**\n` +
            `• Ops session: **${sessionId ? 'closed — hours saved' : 'no active session'}**`,
        flags: 64,
    });
}

// ── jobs ──────────────────────────────────────────────────────────────────────

async function handleJobs(interaction) {
    const baseUrl = storage.getDvBaseUrl();
    if (!baseUrl)
        return interaction.reply({
            content: '❌ DV connection not configured. Ask a staff member to set it up.',
            flags: 64,
        });

    await interaction.deferReply();

    try {
        const response = await fetch(`${baseUrl}/jobs`, { headers: cfAccessHeaders(), timeout: FETCH_TIMEOUT_MS });
        if (!response.ok)
            return interaction.editReply('⚠️ The Derail Valley mod responded with an error.');

        const jobs = await response.json();
        if (!jobs.length)
            return interaction.editReply('📋 No active jobs found.');

        const embed = new EmbedBuilder()
            .setTitle('📋 Active Derail Valley Jobs')
            .setColor(0x2b2d31)
            .setTimestamp();

        for (const job of jobs.slice(0, 25)) {
            embed.addFields({
                name:  `${job.id} — ${job.type}`,
                value: `**State:** ${job.state}\n**From:** ${job.departure}\n**To:** ${job.destination}`,
                inline: true,
            });
        }
        if (jobs.length > 25) embed.setFooter({ text: `Showing 25 of ${jobs.length} jobs` });

        return interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error('[GRDNConnect] jobs fetch error:', err);
        return interaction.editReply('⚠️ Could not reach the Derail Valley mod. Is the game running?');
    }
}

// ── board ─────────────────────────────────────────────────────────────────────

async function handleBoard(interaction) {
    await interaction.reply({ content: '📨 Sending new Train Board…', flags: 64 });

    storage.setTrainBoardMessageId(interaction.guild.id, null);

    await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
        .catch(err => console.error('[TrainBoard] board refresh failed:', err));

    return interaction.editReply('✅ New Train Board sent.');
}

// ── embed ─────────────────────────────────────────────────────────────────────

async function handleEmbed(interaction) {
    if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE])) {
        return interaction.reply({ content: '❌ Only admins and hosts can post the embed.', flags: 64 });
    }

    const channel = interaction.guild.channels.cache.get(DISPATCH_CHANNEL_ID);
    if (!channel) {
        return interaction.reply({ content: '❌ Dispatch channel not found.', flags: 64 });
    }

    // If a live embed already exists, don't post a duplicate
    const existing = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
    if (existing?.message_id) {
        const existingMsg = await channel.messages.fetch(existing.message_id).catch(() => null);
        if (existingMsg) {
            return interaction.reply({
                content: '❌ An Operations embed already exists. Delete the old one first, or use `/editembed` to update a field.',
                flags: 64,
            });
        }
    }

    const msg = await channel.send({
        embeds:     [buildDispatchEmbed()],
        components: buildDispatchComponents(),
    });

    db.prepare(`DELETE FROM dispatch_embed`).run();
    db.prepare(`INSERT INTO dispatch_embed (id, message_id) VALUES (1, ?)`).run(msg.id);

    return interaction.reply({ content: '✅ Operations embed posted.', flags: 64 });
}

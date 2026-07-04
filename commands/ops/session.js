// commands/ops/session.js
// /session action:[start|end|jobs|board|embed]
//
//   start — open official ops session, sync embed from GRDNConnect
//   end   — close session, save hours, reset nicknames
//   jobs  — list active DV jobs
//   board — force-post a fresh Train Board
//   embed — post or restore the Operations dispatch embed

const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const fetch    = require('node-fetch');
const fs       = require('fs');
const path     = require('path');
const db       = require('../../database/db');
const storage  = require('../../database/storage');
const { hasAnyRole }                             = require('../../utils/permissions');
const { updateTrainBoard }                       = require('../../utils/trainBoard');
const { buildDispatchEmbed, buildDispatchComponents, deriveDvConnectUrl } = require('../../utils/dispatchEmbed');
const { deleteAllCrewVCs }                       = require('../../utils/crewVCManager');
const { sendLog }                                = require('../../logging/logHelper');
const loggingConfig                              = require('../../config/logging.json');
const {
    ADMIN_ROLE, HOST_ROLE, DISPATCH_QUAL_ROLE, DVMP_COMMAND_ROLE,
    DISPATCH_CHANNEL_ID, TRAIN_BOARD_CHANNEL_ID, CREW_VC_CATEGORY_ID, OPS_CATEGORY_ID,
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
        )
        .addStringOption(opt => opt
            .setName('session_type')
            .setDescription('Type of session (only used with Start)')
            .addChoices(
                { name: 'Official',    value: 'official'    },
                { name: 'Unofficial',  value: 'unofficial'  },
                { name: 'Stress Test', value: 'stress_test' },
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

// Who can open a given session type. Unofficial is open to any member; official
// and stress test stay restricted to admins, hosts, and dispatch-qualified staff.
function canStartSession(member, sessionType) {
    if (sessionType === 'unofficial') return true;
    return hasAnyRole(member, [ADMIN_ROLE, HOST_ROLE, DISPATCH_QUAL_ROLE]);
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
    // If none is set or it can't be derived, fall back to the direct IP from config.
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
        const res = await fetch(`${connectUrl}/server-info`, { timeout: FETCH_TIMEOUT_MS });
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
        return { status: `✅ Session open — no host connection configured. Run \`/setdvconnection\` with your mod URL, or set Server Name and Password manually with \`/editembed\`.`, interchangeMode };
    if (gameStatus === 'unreachable')
        return { status: `✅ Session open — game not reachable yet. Use \`/editembed\` to set Server Name and Password manually.`, interchangeMode };
    return { status: `✅ Session open — GRDNConnect at \`${connectUrl}\` returned status: ${gameStatus}.`, interchangeMode };
}

async function handleStart(interaction, typeOverride = null) {
    const sessionType = typeOverride ?? interaction.options?.getString?.('session_type') ?? 'official';

    if (!canStartSession(interaction.member, sessionType)) {
        const label = { official: 'official', stress_test: 'stress test', unofficial: 'unofficial' }[sessionType] ?? sessionType;
        return interaction.reply({
            content: `❌ Only admins, hosts, and dispatch-qualified members can start ${label} sessions.`,
            flags: 64,
        });
    }

    await interaction.deferReply({ flags: 64 });
    const now = Date.now();
    const sessionId = storage.openSession(interaction.guild.id, interaction.user.id, now, sessionType);

    // ── Resolve the clicker's Cloudflare tunnel ───────────────────────────────
    // Whoever clicks Start Op IS the host for this session — their tunnel is used.
    // host-tunnels.json: { "discordUserId": "tunnelName", ... }
    // "red" → Remote Dispatch: https://red.grdnnetwork.com
    //       → GRDNConnect:     https://red-connect.grdnnetwork.com
    let connectUrl = null;
    try {
        const tunnelsPath = path.join(__dirname, '../../host-tunnels.json');
        const hostTunnels = JSON.parse(fs.readFileSync(tunnelsPath, 'utf8'));
        const tunnelName  = hostTunnels[interaction.user.id];

        if (tunnelName) {
            // Official host with a Cloudflare tunnel
            const rdLink = `https://${tunnelName}.grdnnetwork.com`;
            db.prepare(`
                INSERT OR IGNORE INTO dispatch_settings
                    (id, server_name, server_password, remote_link, remote_password)
                VALUES (1, 'Not set', 'Not set', 'Not set', 'GRDN')
            `).run();
            db.prepare(`UPDATE dispatch_settings SET remote_link = ? WHERE id = 1`).run(rdLink);
            connectUrl = deriveDvConnectUrl(rdLink);
            console.log(`[Session] ${interaction.user.tag} → tunnel "${tunnelName}" → ${connectUrl}`);
        } else {
            // Not in host-tunnels — fall back to URL set via /setdvconnection
            connectUrl = storage.getDvBaseUrl();
            if (!connectUrl) {
                console.log(`[Session] ${interaction.user.tag} → no DV URL configured, session opening without game connection`);
            } else {
                console.log(`[Session] ${interaction.user.tag} → using pre-set URL: ${connectUrl}`);
            }
        }
    } catch (err) {
        return interaction.editReply(`❌ Could not read \`host-tunnels.json\`: ${err.message}`);
    }

    // ── Push bot URL, secret, and live crew channels to GRDNConnect ──────────
    // Uses the tunnel URL if resolved above, direct IP if not.
    // Fire-and-forget — don't let game-unreachable block the Discord response.
    const botPublicUrl  = process.env.BOT_PUBLIC_URL || '';
    const botSecret     = process.env.HTTP_SECRET    || '';
    const crewChannels  = interaction.guild.channels.cache
        .filter(ch => ch.parentId === CREW_VC_CATEGORY_ID && ch.type === ChannelType.GuildVoice)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(ch => ({ name: ch.name, vcId: ch.id }));

    if (botPublicUrl) {
        fetch(`${connectUrl}/session-config`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ botUrl: botPublicUrl, secret: botSecret, channels: crewChannels }),
            timeout: 3000,
        }).then(r => {
            if (!r.ok) console.warn(`[SessionConfig] Game returned ${r.status}`);
            else       console.log(`[SessionConfig] Pushed to game — ${crewChannels.length} channel(s), url=${botPublicUrl}`);
        }).catch(err =>
            console.warn('[SessionConfig] Could not reach game — manual UMM config required:', err.message)
        );
    } else {
        console.warn('[SessionConfig] BOT_PUBLIC_URL not set in .env — game will use UMM settings as fallback');
    }

    const { status: embedStatus, interchangeMode: isInterchangeMode } = await syncEmbedFromMod(interaction.guild);

    // Apply Interchange Mode if the game reports it enabled in UMM Settings
    if (isInterchangeMode) {
        storage.setSessionOpsMode(sessionId, 'interchange');
        console.log(`[Session] Interchange Mode active for session ${sessionId} (read from mod /server-info)`);
    }

    const sessionTypeLabel = { official: 'Official', unofficial: 'Unofficial', stress_test: 'Stress Test' }[sessionType] ?? sessionType;

    const logEmbed = new EmbedBuilder()
        .setTitle('🟢 Ops Session Opened')
        .setColor(0x57f287)
        .addFields(
            { name: 'Started by',    value: `<@${interaction.user.id}>`,                              inline: true },
            { name: 'Session Type',  value: sessionTypeLabel,                                         inline: true },
            { name: 'Mode',          value: isInterchangeMode ? '🔄 Interchange' : 'Standard',       inline: true },
            { name: 'Dispatch',      value: embedStatus,                                               inline: false },
        )
        .setTimestamp()
        .setFooter({ text: 'GRDN Ops' });

    sendLog(interaction.client, loggingConfig.logChannel, logEmbed);

    updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
        .catch(err => console.error('[TrainBoard] session start update failed:', err));

    const modeNote = isInterchangeMode ? '\n• **🔄 Interchange Mode** — stats and role labels active' : '';

    return interaction.editReply({
        content:
            `✅ ${sessionTypeLabel} ops session open.${modeNote}\n` +
            `• Crew: run **/setcrew** with your **train number** to join\n` +
            `• Dispatch embed: ${embedStatus}`,
    });
}

// ── end ───────────────────────────────────────────────────────────────────────

async function handleEnd(interaction) {
    if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE])) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
    }

    await interaction.reply({ content: '🔄 Closing ops session and resetting nicknames…', flags: 64 });

    const guild = interaction.guild;
    const now   = Date.now();

    // Capture participants BEFORE closing — closeSession wipes session_crew
    const activeSession = storage.getActiveSession(guild.id);
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

    // Mark op inactive + refresh dispatch embed
    try {
        db.prepare(`UPDATE dispatch_settings SET ops_active = 0 WHERE id = 1`).run();
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
        const response = await fetch(`${baseUrl}/jobs`, { timeout: FETCH_TIMEOUT_MS });
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

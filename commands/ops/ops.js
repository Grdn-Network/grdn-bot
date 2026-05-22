// commands/ops/ops.js
// Consolidated ops command — all operational subcommands in one place.
//
//   /ops start     — open official ops session (was /syncop)
//   /ops end       — close session, save hours, reset nicknames (was /endop)
//   /ops assign    — set train assignment info (was /assign)
//   /ops unassign  — clear a train's assignment (was /unassign)
//   /ops complete  — complete a DV job via GRDNConnect (was /complete)
//   /ops jobs      — list active DV jobs (was /jobs)
//   /ops board     — force-post a fresh Train Board (was /trainboard)

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch    = require('node-fetch');
const db       = require('../../database/db');
const storage  = require('../../database/storage');
const { hasAnyRole }                    = require('../../utils/permissions');
const { updateTrainBoard }              = require('../../utils/trainBoard');
const { buildDispatchEmbed, deriveDvConnectUrl } = require('../../utils/dispatchEmbed');
const { deleteAllCrewVCs }              = require('../../utils/crewVCManager');
const { sendLog }                       = require('../../logging/logHelper');
const loggingConfig                     = require('../../config/logging.json');
const {
    ADMIN_ROLE, HOST_ROLE, DISPATCH_QUAL_ROLE,
    DISPATCH_CHANNEL_ID, TRAIN_BOARD_CHANNEL_ID, STAFF_ROLES,
} = require('../../config');

const FETCH_TIMEOUT_MS = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// COMMAND DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

// handleStart and handleEnd are also exported so the dispatch embed buttons
// (buttons/syncnames.js and buttons/endop.js) can call them directly without
// going through the command lookup system.
module.exports = {
    data: new SlashCommandBuilder()
        .setName('ops')
        .setDescription('Operations management.')
        // ── start ──────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('start')
               .setDescription('Open an official ops session and sync server info from GRDNConnect.')
        )
        // ── end ────────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('end')
               .setDescription('Close the ops session, save hours, and reset crew nicknames.')
        )
        // ── assign ─────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('assign')
               .setDescription('Set operational info for a train.')
               .addStringOption(opt =>
                   opt.setName('train')
                      .setDescription('Train number (staff only — leave blank to use your registered train)')
               )
               .addStringOption(opt => opt.setName('dep').setDescription('Departing station'))
               .addStringOption(opt => opt.setName('des').setDescription('Destination station'))
               .addStringOption(opt => opt.setName('trk').setDescription('Arrival track'))
               .addStringOption(opt => opt.setName('job').setDescription('Job code'))
               .addStringOption(opt => opt.setName('rmk').setDescription('Remarks / notes'))
        )
        // ── unassign ───────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('unassign')
               .setDescription('Clear the assignment for a train. (Staff only)')
               .addStringOption(opt =>
                   opt.setName('train')
                      .setDescription('Train number to clear')
                      .setRequired(true)
               )
        )
        // ── complete ───────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('complete')
               .setDescription('Complete a Derail Valley job by job ID. (Staff only)')
               .addStringOption(opt =>
                   opt.setName('jobid')
                      .setDescription('Job ID to complete (e.g. HB-SU-27)')
                      .setRequired(true)
               )
        )
        // ── jobs ───────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('jobs')
               .setDescription('List all active Derail Valley jobs. (Staff only)')
        )
        // ── board ──────────────────────────────────────────────────────────
        .addSubcommand(sub =>
            sub.setName('board')
               .setDescription('Force-post a fresh Train Board message. (Staff only)')
        ),

    // ─────────────────────────────────────────────────────────────────────────
    // ROUTER
    // ─────────────────────────────────────────────────────────────────────────
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'start')    return handleStart(interaction);
        if (sub === 'end')      return handleEnd(interaction);
        if (sub === 'assign')   return handleAssign(interaction);
        if (sub === 'unassign') return handleUnassign(interaction);
        if (sub === 'complete') return handleComplete(interaction);
        if (sub === 'jobs')     return handleJobs(interaction);
        if (sub === 'board')    return handleBoard(interaction);
    },

    // Exposed for button handlers that bypass the slash command router
    handleStart,
    handleEnd,
};

// ─────────────────────────────────────────────────────────────────────────────
// HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

// ── /ops start ───────────────────────────────────────────────────────────────

async function syncEmbedFromMod(guild) {
    const stored = db.prepare(`SELECT remote_link FROM dispatch_settings WHERE id = 1`).get();
    const rdLink = stored?.remote_link;
    if (!rdLink || rdLink === 'Not set')
        return '⚠️ Remote Dispatch link not set — run `/editembed field:remote_dispatch_link` first.';

    const connectUrl = deriveDvConnectUrl(rdLink);
    if (!connectUrl) return '⚠️ Could not derive GRDNConnect URL from Remote Dispatch link.';

    storage.setDvUrl(connectUrl);

    let serverName, password;
    try {
        const res = await fetch(`${connectUrl}/server-info`, { timeout: FETCH_TIMEOUT_MS });
        if (!res.ok) return '⚠️ GRDNConnect responded with an error — embed not updated.';
        const data = await res.json();
        serverName = data.serverName;
        password   = data.password;
    } catch {
        return '⚠️ Could not reach GRDNConnect — is the game running?';
    }

    if (!serverName && !password) return '⚠️ GRDNConnect returned no server info — is DVMP running?';

    db.prepare(`
        INSERT OR IGNORE INTO dispatch_settings (id, server_name, server_password, remote_link, remote_password)
        VALUES (1, 'Not set', 'Not set', 'Not set', 'Not set')
    `).run();
    if (serverName) db.prepare(`UPDATE dispatch_settings SET server_name     = ? WHERE id = 1`).run(serverName);
    if (password)   db.prepare(`UPDATE dispatch_settings SET server_password = ? WHERE id = 1`).run(password);
    db.prepare(`UPDATE dispatch_settings SET remote_link = ? WHERE id = 1`).run(rdLink);
    db.prepare(`UPDATE dispatch_settings SET ops_active  = 1 WHERE id = 1`).run();

    const embedRow = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
    if (!embedRow) return '✅ DB updated — no embed posted yet (run `/operembed`).';

    const channel = guild.channels.cache.get(DISPATCH_CHANNEL_ID);
    if (!channel) return '✅ DB updated — dispatch channel not found.';

    const msg = await channel.messages.fetch(embedRow.message_id).catch(() => null);
    if (!msg) return '✅ DB updated — embed message not found (run `/operembed`).';

    await msg.edit({ embeds: [buildDispatchEmbed()], components: msg.components });
    return `✅ Embed updated — **${serverName}** | ${rdLink}`;
}

async function handleStart(interaction) {
    if (!hasAnyRole(interaction.member, [ADMIN_ROLE, DISPATCH_QUAL_ROLE])) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const now = Date.now();
    storage.openSession(interaction.guild.id, interaction.user.id, now, 'official');

    const embedStatus = await syncEmbedFromMod(interaction.guild);

    const logEmbed = new EmbedBuilder()
        .setTitle('🟢 Official Ops Session Opened')
        .setColor(0x57f287)
        .addFields(
            { name: 'Started by', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'Dispatch',   value: embedStatus,                  inline: false },
        )
        .setTimestamp()
        .setFooter({ text: 'GRDN Ops' });

    sendLog(interaction.client, loggingConfig.logChannel, logEmbed);

    updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
        .catch(err => console.error('[TrainBoard] ops start update failed:', err));

    return interaction.editReply({
        content:
            `✅ Official ops session open.\n` +
            `• Crew: run **/setcrew** with your **train number** to join\n` +
            `• Dispatch embed: ${embedStatus}`,
    });
}

// ── /ops end ─────────────────────────────────────────────────────────────────

async function handleEnd(interaction) {
    if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE])) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
    }

    await interaction.reply({ content: '🔄 Closing ops session and resetting nicknames…', flags: 64 });

    const guild = interaction.guild;
    const now   = Date.now();

    // Capture participants BEFORE closing — closeSession wipes session_crew
    const activeSession  = storage.getActiveSession(guild.id);
    const participants   = activeSession ? storage.getSessionCrew(activeSession.id) : [];

    // Close session — writes final minutes to ops_log, clears session_crew
    const sessionId = storage.closeSession(guild.id, interaction.user.id, now);

    let reset = 0, failed = 0;

    for (const userId of participants) {
        try {
            storage.clearTrainNumber(userId);

            const crew         = storage.getCrewRaw(userId);
            const preferredName = crew?.preferred_name ?? null;

            // 10007 = Unknown Member (definitively left server)
            const member = await guild.members.fetch(userId)
                .catch(err => err.code === 10007 ? null : undefined);
            if (member === null) { storage.removeCrew(userId); continue; }
            if (member === undefined) { failed++; continue; } // fetch error — keep record

            try {
                await member.setNickname(preferredName);
                reset++;
            } catch (err) {
                if (err?.code === 50013) { reset++; } // Missing Permissions (e.g. server owner) — not a real failure
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
        console.error('[ops end] dispatch embed update failed:', err);
    }

    const logEmbed = new EmbedBuilder()
        .setTitle('🔴 Ops Session Closed')
        .setColor(0xed4245)
        .addFields(
            { name: 'Closed by',       value: `<@${interaction.user.id}>`,                     inline: true },
            { name: 'Nicknames reset', value: `${reset} reset, ${failed} failed`,              inline: true },
            { name: 'Hours',           value: sessionId ? 'Saved ✓' : 'No active session',     inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'GRDN Ops' });

    sendLog(interaction.client, loggingConfig.logChannel, logEmbed);

    updateTrainBoard(interaction.client, guild.id, TRAIN_BOARD_CHANNEL_ID)
        .catch(err => console.error('[TrainBoard] ops end update failed:', err));

    return interaction.followUp({
        content:
            `✅ Reset complete.\n` +
            `• Nicknames reset: **${reset}** | Failed: **${failed}**\n` +
            `• Ops session: **${sessionId ? 'closed — hours saved' : 'no active session'}**`,
        flags: 64,
    });
}

// ── /ops assign ──────────────────────────────────────────────────────────────

async function handleAssign(interaction) {
    const guildId      = interaction.guild.id;
    const isStaff      = STAFF_ROLES.some(r => interaction.member.roles.cache.has(r));
    const requestedTrain = interaction.options.getString('train');

    let train;
    if (isStaff) {
        if (!requestedTrain)
            return interaction.reply({ content: '❌ Please specify a train number.', flags: 64 });
        train = requestedTrain;
    } else {
        const crew = storage.getCrewByUserId(guildId, interaction.user.id);
        if (!crew?.trainNumber)
            return interaction.reply({
                content: "❌ You don't have a train registered. Ask staff to register you first.",
                flags: 64,
            });
        if (requestedTrain && requestedTrain !== crew.trainNumber)
            return interaction.reply({
                content: `❌ You can only update your own train (**${crew.trainNumber}**).`,
                flags: 64,
            });
        train = crew.trainNumber;
    }

    const existing = storage.getAssignmentByTrain(guildId, train) || {};
    const dep = interaction.options.getString('dep') ?? existing.dep ?? '—';
    const des = interaction.options.getString('des') ?? existing.des ?? '—';
    const trk = interaction.options.getString('trk') ?? existing.trk ?? '—';
    const job = interaction.options.getString('job') ?? existing.job ?? '—';
    const rmk = interaction.options.getString('rmk') ?? existing.rmk ?? '—';

    storage.setAssignment(guildId, train, { dep, des, trk, job, rmk, timestamp: Date.now() });

    await interaction.reply({
        content:
            `Assignment saved for train **${train}**:\n` +
            `DEP : ${dep}\nDES : ${des}\nTRK : ${trk}\nJOB : ${job}\nRMK : ${rmk}`,
        flags: 64,
    });

    await updateTrainBoard(interaction.client, guildId, TRAIN_BOARD_CHANNEL_ID)
        .catch(err => console.error('[TrainBoard] assign update failed:', err));
}

// ── /ops unassign ────────────────────────────────────────────────────────────

async function handleUnassign(interaction) {
    if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
    }

    const guildId = interaction.guild.id;
    const train   = interaction.options.getString('train');
    const existing = storage.getAssignmentByTrain(guildId, train);

    if (!existing)
        return interaction.reply({ content: `❌ Train **${train}** has no assignment to remove.`, flags: 64 });

    storage.setAssignment(guildId, train, {
        dep: '—', des: '—', trk: '—', job: '—', rmk: '—', timestamp: Date.now(),
    });

    await interaction.reply({ content: `🗑️ Assignment for train **${train}** cleared.`, flags: 64 });

    await updateTrainBoard(interaction.client, guildId, TRAIN_BOARD_CHANNEL_ID)
        .catch(err => console.error('[TrainBoard] unassign update failed:', err));
}

// ── /ops complete ─────────────────────────────────────────────────────────────

async function handleComplete(interaction) {
    if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
    }

    const baseUrl = storage.getDvBaseUrl();
    if (!baseUrl)
        return interaction.reply({
            content: '❌ DV connection not configured. Ask a staff member to run `/setdvconnection`.',
            flags: 64,
        });

    const jobId = interaction.options.getString('jobid');
    await interaction.deferReply();

    try {
        const response = await fetch(`${baseUrl}/complete-job`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ jobId }),
            timeout: FETCH_TIMEOUT_MS,
        });

        let result;
        try { result = await response.json(); } catch { result = null; }

        if (!result)
            return interaction.editReply('⚠️ The Derail Valley mod returned an unexpected response. Is the game running?');

        if (result.ok) {
            return interaction.editReply(`✅ Job **${jobId}** completed. The crew will receive payment in-game.`);
        } else if (response.status === 404) {
            return interaction.editReply(`⚠️ Job **${jobId}** could not be completed — not finished yet or not found.`);
        } else {
            return interaction.editReply(`❌ Could not complete **${jobId}**: ${result.error ?? 'Unknown error'}`);
        }
    } catch (err) {
        console.error('[GRDNConnect] complete-job error:', err);
        return interaction.editReply('⚠️ Could not reach the Derail Valley mod. Is the game running and the mod enabled?');
    }
}

// ── /ops jobs ─────────────────────────────────────────────────────────────────

async function handleJobs(interaction) {
    if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
    }

    const baseUrl = storage.getDvBaseUrl();
    if (!baseUrl)
        return interaction.reply({
            content: '❌ DV connection not configured. Ask a staff member to run `/setdvconnection`.',
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
                name:   `${job.id} — ${job.type}`,
                value:  `**State:** ${job.state}\n**From:** ${job.departure}\n**To:** ${job.destination}`,
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

// ── /ops board ────────────────────────────────────────────────────────────────

async function handleBoard(interaction) {
    if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
        return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
    }

    await interaction.reply({ content: '📨 Sending new Train Board…', flags: 64 });

    storage.setTrainBoardMessageId(interaction.guild.id, null);

    await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
        .catch(err => console.error('[TrainBoard] board refresh failed:', err));

    return interaction.editReply('✅ New Train Board sent.');
}

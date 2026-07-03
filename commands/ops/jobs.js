// commands/ops/jobs.js
// /jobs filter:[all|accepted|assigned]
//
//   all      — every job currently in the session
//   accepted — jobs that are in-progress (InProgress state)
//   assigned — jobs grouped by which loco they're attached to
//
// Queries the running DV game via GRDNConnect (/jobs and /locos endpoints).
// Available to all crew. Reply is public so the whole channel can see it.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch   = require('node-fetch');
const storage = require('../../database/storage');
const { OPS_CHAT_CHANNEL_ID } = require('../../config');
const { requireChannel } = require('../../utils/commandChannel');

const FETCH_TIMEOUT_MS = 8000;

// ── Type / state mappings ──────────────────────────────────────────────────────

const JOB_TYPE_LABELS = {
    ShuntingUnload: 'Unload',
    ShuntingLoad:   'Load',
    Transport:      'Haul',
    EmptyHaul:      'Empty',
};

// Matches RadioIntegration.MapCarType in the C# mod
const LOCO_TYPE_LABELS = {
    LocoDiesel:       'DE6',
    LocoSteamHeavy:   'S282',
    LocoMicroshunter: 'BE2',
    LocoShunter:      'DE2',
    LocoDH4:          'DH4',
    LocoDM3:          'DM3',
    LocoS060:         'S060',
    HandCar:          'Handcar',
};

function fmtJobType(t)  { return JOB_TYPE_LABELS[t]  ?? t ?? '?'; }
function fmtLocoType(t) { return LOCO_TYPE_LABELS[t] ?? t ?? '?'; }

// Extract trailing number from loco ID e.g. "SH-282-1" → "1", "DE6-5" → "5"
function locoNum(id) {
    const m = (id ?? '').match(/(\d+)$/);
    return m ? m[1] : (id ?? '?');
}

function stateEmoji(state) {
    switch (state) {
        case 'InProgress': return '🟢';
        case 'Available':  return '🔵';
        case 'Completed':  return '✅';
        case 'Expired':    return '🔴';
        default:           return '⚪';
    }
}

// ── Format helpers ─────────────────────────────────────────────────────────────

function fmtJobLine(job) {
    // e.g. "🟢 `HB-SU-27` | Unload | HB → SM"
    const id    = job.id ?? job.jobId ?? '?';
    const type  = fmtJobType(job.type);
    const dep   = job.departure   ?? '?';
    const des   = job.destination ?? '?';
    return `${stateEmoji(job.state)} \`${id}\` | ${type} | ${dep} → ${des}`;
}

function fmtAssignedJobLine(job) {
    // e.g. "🟢 `HB-SU-27` | Unload | HB → SM · Track HB-F-3"
    const base  = fmtJobLine(job);
    const track = job.track && job.track !== '—' ? ` · Track ${job.track}` : '';
    return base + track;
}

// Split a flat array of lines into chunks that each fit inside an embed field (1024 chars).
function chunkLines(lines, limit = 1024) {
    const chunks = [];
    let current  = '';
    for (const line of lines) {
        const next = current ? `${current}\n${line}` : line;
        if (next.length > limit) {
            if (current) chunks.push(current);
            current = line;
        } else {
            current = next;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

// ── Command ────────────────────────────────────────────────────────────────────

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jobs')
        .setDescription('Show Derail Valley job data from the running session.')
        .addStringOption(opt =>
            opt.setName('filter')
               .setDescription('Which jobs to show')
               .setRequired(true)
               .addChoices(
                   { name: 'All jobs in the session',   value: 'all'      },
                   { name: 'Accepted (in-progress)',     value: 'accepted' },
                   { name: 'Assigned to trains',         value: 'assigned' },
               )
        ),

    async execute(interaction) {
        if (!await requireChannel(interaction, OPS_CHAT_CHANNEL_ID)) return;

        const baseUrl = storage.getDvBaseUrl();
        if (!baseUrl)
            return interaction.reply({
                content: '❌ DV connection not configured. Ask staff to run `/setdvconnection`.',
                flags: 64,
            });

        const filter = interaction.options.getString('filter');
        await interaction.deferReply();

        try {
            // ── all / accepted ─────────────────────────────────────────────────
            if (filter === 'all' || filter === 'accepted') {
                const res = await fetch(`${baseUrl}/jobs`, { timeout: FETCH_TIMEOUT_MS });
                if (!res.ok)
                    return interaction.editReply('⚠️ DV returned an error fetching jobs. Is the game running?');

                let jobs = await res.json();
                if (filter === 'accepted')
                    jobs = jobs.filter(j => j.state === 'InProgress');

                const embed = new EmbedBuilder()
                    .setColor(filter === 'accepted' ? 0x57F287 : 0x5865F2)
                    .setTitle(filter === 'accepted'
                        ? `🟢 In-Progress Jobs (${jobs.length})`
                        : `📋 All Jobs (${jobs.length})`
                    )
                    .setTimestamp();

                if (jobs.length === 0) {
                    embed.setDescription(filter === 'accepted'
                        ? 'No jobs are currently in progress.'
                        : 'No jobs found in the session.'
                    );
                    return interaction.editReply({ embeds: [embed] });
                }

                const lines  = jobs.map(fmtJobLine);
                const chunks = chunkLines(lines, 4000); // description cap

                embed.setDescription(chunks[0]);
                // Overflow into fields (up to 25 total embed fields, but description counts)
                for (let i = 1; i < Math.min(chunks.length, 5); i++)
                    embed.addFields({ name: '​', value: chunks[i] });

                if (jobs.length > 50)
                    embed.setFooter({ text: `Showing first 50 of ${jobs.length} jobs` });

                return interaction.editReply({ embeds: [embed] });

            // ── assigned ───────────────────────────────────────────────────────
            } else {
                const res = await fetch(`${baseUrl}/locos`, { timeout: FETCH_TIMEOUT_MS });
                if (!res.ok)
                    return interaction.editReply('⚠️ DV returned an error fetching loco data. Is the game running?');

                const locos    = await res.json();
                const withJobs = locos.filter(l => Array.isArray(l.jobs) && l.jobs.length > 0);
                const empty    = locos.filter(l => !l.jobs || l.jobs.length === 0);

                const embed = new EmbedBuilder()
                    .setColor(0xFEE75C)
                    .setTitle(`🚂 Jobs by Loco`)
                    .setTimestamp();

                if (withJobs.length === 0) {
                    embed.setDescription(
                        locos.length === 0
                            ? 'No locos found in the session.'
                            : `${locos.length} loco${locos.length !== 1 ? 's' : ''} found — none have assigned jobs yet.`
                    );
                    return interaction.editReply({ embeds: [embed] });
                }

                // One embed field per loco (max 25 fields)
                for (const loco of withJobs.slice(0, 24)) {
                    const fieldName = `${fmtLocoType(loco.locoType)}  ·  Train ${locoNum(loco.locoId)}`;
                    const lines     = loco.jobs.map(fmtAssignedJobLine);
                    const chunks    = chunkLines(lines, 1020);
                    embed.addFields({ name: fieldName, value: chunks[0] ?? '—' });
                    // Rare: loco with too many jobs — overflow to continuation fields
                    for (let i = 1; i < Math.min(chunks.length, 2); i++)
                        embed.addFields({ name: `↳ ${fieldName} (cont.)`, value: chunks[i] });
                }

                // Summary footer
                const parts = [];
                if (withJobs.length > 24) parts.push(`${withJobs.length - 24} more loco(s) not shown`);
                if (empty.length)         parts.push(`${empty.length} loco${empty.length !== 1 ? 's' : ''} idle`);
                if (parts.length)         embed.setFooter({ text: parts.join(' · ') });

                return interaction.editReply({ embeds: [embed] });
            }

        } catch (err) {
            console.error('[jobs] fetch error:', err);
            return interaction.editReply(
                '⚠️ Could not reach the Derail Valley mod. Is the game running and the mod enabled?'
            );
        }
    },
};

// commands/crew/leaderboard.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../../database/storage');
const { getRoleLabel } = require('../../utils/statsHelper');

function fmt(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
}

function fmtMiles(miles) {
    return miles >= 1000
        ? `${(miles / 1000).toFixed(1)}k`
        : miles.toFixed(1);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View crew leaderboards.')
        .addStringOption(opt => opt
            .setName('view')
            .setDescription('Which leaderboard to show (default: hours)')
            .setRequired(false)
            .addChoices(
                { name: 'Hours — total ops hours',  value: 'hours' },
                { name: 'Stats — career statistics', value: 'stats' },
            )
        ),

    async execute(interaction) {
        await interaction.deferReply();

        const view = interaction.options.getString('view') ?? 'hours';

        if (view === 'stats') return showStats(interaction);
        return showHours(interaction);
    }
};

// ── Hours leaderboard (existing behaviour) ─────────────────────────────────────

async function showHours(interaction) {
    const crew = storage.getAllCrew(interaction.guild.id);
    if (crew.length === 0) {
        return interaction.editReply('❌ No crew registered yet.');
    }

    const entries = [];

    for (const row of crew) {
        const member = await interaction.guild.members.fetch(row.userId)
            .catch(err => err.code === 10007 ? null : undefined);
        if (member === null) {
            storage.removeCrew(row.userId);
            continue;
        }
        if (member === undefined) continue;

        const h = storage.getUserHours(row.userId);
        const total = h.road_crew + h.dispatch + h.shunting + h.trainmaster + h.bonus;
        entries.push({ row, total, h });
    }

    if (entries.length === 0) {
        return interaction.editReply('❌ No crew found in this server.');
    }

    entries.sort((a, b) => b.total - a.total);
    const top = entries.slice(0, 10);

    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map((e, i) => {
        const medal = medals[i] ?? `**${i + 1}.**`;
        return `${medal} <@${e.row.userId}> — ${fmt(e.total)} *(${e.row.type})*`;
    });

    const embed = new EmbedBuilder()
        .setTitle('🏆 Operations Leaderboard')
        .setColor(0x2b2d31)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Top 10 by total hours • /leaderboard view:stats for career stats' })
        .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
}

// ── Career stats leaderboard ───────────────────────────────────────────────────

async function showStats(interaction) {
    const allStats = storage.getAllLifetimeStats();

    if (allStats.length === 0) {
        return interaction.editReply('❌ No career stats recorded yet. Complete jobs during an ops session to start tracking.');
    }

    // Build display rows — resolve Discord usernames, skip members who left
    const rows = [];
    for (const stat of allStats) {
        const member = await interaction.guild.members.fetch(stat.user_id)
            .catch(err => err.code === 10007 ? null : undefined);
        if (member === null) continue;  // left server — skip
        if (member === undefined) continue; // fetch error — skip
        rows.push({ stat, member });
    }

    if (rows.length === 0) {
        return interaction.editReply('❌ No career stats for current server members.');
    }

    // Sort by car-miles for the main column, then build sub-rankings
    const byMiles    = [...rows].sort((a, b) => (b.stat.car_miles || 0) - (a.stat.car_miles || 0));
    const byDelivery = [...rows].sort((a, b) =>
        ((b.stat.hub_outbound || 0) + (b.stat.local_deliveries || 0)) -
        ((a.stat.hub_outbound || 0) + (a.stat.local_deliveries || 0)));
    const byInterchange = [...rows].sort((a, b) => (b.stat.interchange || 0) - (a.stat.interchange || 0));

    const top5 = (arr) => arr.slice(0, 5);

    const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
    const col = (arr, valFn) =>
        top5(arr)
            .map((r, i) => `${medals[i]} ${r.member.displayName}: ${valFn(r.stat)}`)
            .join('\n') || '*No data*';

    const milesCol      = col(byMiles,      s => `${fmtMiles(s.car_miles || 0)} mi`);
    const deliveryCol   = col(byDelivery,   s => `${(s.hub_outbound || 0) + (s.local_deliveries || 0)} jobs`);
    const interchangeCol = col(byInterchange, s => `${s.interchange || 0} jobs`);

    // Role labels from most recent completed session (if any)
    let roleSection = '';
    const lastSession = storage.getLastCompletedSession(interaction.guild.id);
    if (lastSession) {
        const sessionStats = storage.getSessionStats(lastSession.id);
        if (sessionStats.length > 0) {
            const roleLines = [];
            for (const ss of sessionStats) {
                const member = await interaction.guild.members.fetch(ss.user_id)
                    .catch(() => null);
                if (!member) continue;
                const label = getRoleLabel(ss);
                if (label !== 'Crew') roleLines.push(`**${member.displayName}** — ${label}`);
            }
            if (roleLines.length > 0) {
                roleSection = roleLines.join(' | ');
            }
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('📊 GRDN Career Stats')
        .setColor(0x2b2d31)
        .addFields(
            { name: '🚂 Car-Miles',     value: milesCol,       inline: true },
            { name: '🎯 Deliveries',    value: deliveryCol,    inline: true },
            { name: '🔄 Interchange',   value: interchangeCol, inline: true },
        )
        .setTimestamp()
        .setFooter({ text: `${rows.length} crew tracked • /leaderboard for hours view` });

    if (roleSection) {
        embed.addFields({ name: '🏅 Last session roles', value: roleSection, inline: false });
    }

    return interaction.editReply({ embeds: [embed] });
}

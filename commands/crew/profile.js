// commands/crew/profile.js
// Full crew card — profile info, hours breakdown, ops attended.
// Replaces both the old /profile and /hours commands.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage  = require('../../database/storage');
const { getRoleLabel } = require('../../utils/statsHelper');

function fmt(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
}

function pct(part, total) {
    const n = total > 0 ? Math.round(part / total * 100) : 0;
    return `(${String(n).padStart(3)}%)`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View full crew profile, hours breakdown, and ops history.')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to look up (defaults to yourself)')
        ),

    async execute(interaction) {
        const target = interaction.options.getUser('user') ?? interaction.user;
        const record = storage.getCrewRaw(target.id);

        if (!record) {
            return interaction.reply({
                content: `❌ ${target.username} is not registered.`,
                flags: 64
            });
        }

        const h           = storage.getUserHours(target.id);
        const opsAttended = storage.getOpsAttended(target.id);
        const lifetime    = storage.getUserLifetimeStats(target.id);

        const operational = h.road_crew + h.dispatch + h.shunting;
        const grandTotal  = operational + h.bonus;

        // ─── hours table ───────────────────────────────────────────────────────
        // Monospaced: label (12) | time (7 right-aligned) | pct (6)
        const L = 12, T = 7;
        const row = (label, mins) =>
            `${label.padEnd(L)}${fmt(mins).padStart(T)}  ${pct(mins, operational)}`;

        const hoursLines = [
            row('Road Crew',   h.road_crew),
            row('Controller',  h.dispatch),
            row('Yard Crew',   h.shunting),
            '─'.repeat(28),
            `${'Total'.padEnd(L)}${fmt(grandTotal).padStart(T)}`,
        ];
        if (h.bonus > 0) hoursLines.push(`(incl. ${fmt(h.bonus)} founding bonus)`);

        const hoursBlock = '```\n' + hoursLines.join('\n') + '\n```';

        // ─── career stats ──────────────────────────────────────────────────────
        const hasMiles = lifetime && (lifetime.car_miles || 0) > 0;
        const hasJobs  = lifetime && (lifetime.jobs_completed || 0) > 0;
        const hasStats = hasMiles || hasJobs;

        const milesStr = hasMiles
            ? `${(lifetime.car_miles).toFixed(1)} km`
            : '—';
        const jobsStr  = hasJobs
            ? `${lifetime.jobs_completed}`
            : '—';

        // Role label from the most recent completed session this user participated in
        let roleLabel = null;
        const lastSession = storage.getLastCompletedSession(interaction.guild.id);
        if (lastSession) {
            const sessionStats = storage.getSessionStats(lastSession.id);
            const myStats = sessionStats.find(s => s.user_id === target.id);
            if (myStats) {
                const label = getRoleLabel(myStats);
                if (label && label !== 'Crew') roleLabel = label;
            }
        }

        const embed = new EmbedBuilder()
            .setTitle(`📘 ${record.preferred_name}`)
            .setColor(0x2b2d31)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '👤 User',         value: `${target}`,                 inline: true },
                { name: '🛠️ Type',         value: record.type || '—',          inline: true },
                { name: '🚆 Train',         value: record.train_number || '—',  inline: true },
                { name: '🔧 Loco',          value: record.loco_type   || '—',  inline: true },
                { name: '📅 Ops Attended',  value: `${opsAttended}`,            inline: true },
                { name: '🛤️ Km Driven',     value: milesStr,                    inline: true },
                { name: '✅ Jobs Done',      value: jobsStr,                     inline: true },
                ...(roleLabel ? [{ name: '🏅 Last Role', value: roleLabel, inline: true }] : []),
                { name: '⏱️ Hours',         value: hoursBlock,                  inline: false },
            )
            .setFooter({ text: 'GRDN Crew System' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};

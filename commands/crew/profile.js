// commands/crew/profile.js
// Full crew card — profile info, hours breakdown, ops attended.
// Replaces both the old /profile and /hours commands.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../../database/storage');

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

        const operational = h.road_crew + h.dispatch + h.shunting + h.trainmaster;
        const grandTotal  = operational + h.bonus;

        // ─── hours table ───────────────────────────────────────────────────────
        // Monospaced: label (12) | time (7 right-aligned) | pct (6)
        const L = 12, T = 7;
        const row = (label, mins) =>
            `${label.padEnd(L)}${fmt(mins).padStart(T)}  ${pct(mins, operational)}`;

        const hoursLines = [
            row('Road Crew',   h.road_crew),
            row('Dispatch',    h.dispatch),
            row('Yard Crew',   h.shunting),
            row('TrainMaster', h.trainmaster),
            '─'.repeat(28),
            `${'Total'.padEnd(L)}${fmt(grandTotal).padStart(T)}`,
        ];
        if (h.bonus > 0) hoursLines.push(`(incl. ${fmt(h.bonus)} founding bonus)`);

        // ─── future fields ─────────────────────────────────────────────────────
        // When these are tracked, add them to hoursLines or a new embed section:
        //   Company Revenue    $X,XXX
        //   Jobs Completed     NNN
        //   Avg Session Length Xh XXm
        // ───────────────────────────────────────────────────────────────────────

        const hoursBlock = '```\n' + hoursLines.join('\n') + '\n```';

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
                // Future inline fields go here (Revenue, Jobs Completed, etc.)
                { name: '⏱️ Hours',         value: hoursBlock,                  inline: false },
            )
            .setFooter({ text: 'GRDN Crew System' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};

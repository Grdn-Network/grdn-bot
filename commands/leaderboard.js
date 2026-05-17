// commands/leaderboard.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../storage');

function fmt(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Top crew members by total operations hours.'),

    async execute(interaction) {
        await interaction.deferReply();

        const crew = storage.getAllCrew(interaction.guild.id);
        if (crew.length === 0) {
            return interaction.editReply('❌ No crew registered yet.');
        }

        const entries = [];

        for (const row of crew) {
            const member = await interaction.guild.members.fetch(row.userId).catch(() => null);
            if (!member) continue;

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
            .setFooter({ text: 'Top 10 by total hours' })
            .setTimestamp();

        return interaction.editReply({ embeds: [embed] });
    }
};

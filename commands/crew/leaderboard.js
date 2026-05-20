// commands/crew/leaderboard.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../../database/storage');

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
            // err.code 10007 = Unknown Member (definitively not in server)
            // Any other error (rate limit, network, etc.) → undefined → skip but don't prune
            const member = await interaction.guild.members.fetch(row.userId)
                .catch(err => err.code === 10007 ? null : undefined);
            if (member === null) {
                storage.removeCrew(row.userId); // confirmed left — soft-remove
                continue;
            }
            if (member === undefined) continue; // fetch error — skip display, keep record

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

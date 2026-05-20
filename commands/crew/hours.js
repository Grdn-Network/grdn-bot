// commands/crew/hours.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../../database/storage');

function fmt(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hours')
        .setDescription('View operations hours for a crew member.')
        .addUserOption(opt =>
            opt.setName('user').setDescription('User to look up (defaults to yourself)')
        ),

    async execute(interaction) {
        const target = interaction.options.getUser('user') ?? interaction.user;
        const record = storage.getCrewRaw(target.id);
        const h = storage.getUserHours(target.id);

        const operationalTotal = h.road_crew + h.dispatch + h.shunting + h.trainmaster;
        const grandTotal = operationalTotal + h.bonus;
        const hasBonus = h.bonus > 0;

        const p = (n) => `(${String(operationalTotal > 0 ? Math.round(n / operationalTotal * 100) : 0).padStart(3)}%)`;
        const row = (label, mins) =>
            `${label.padEnd(12)}${fmt(mins).padStart(7)}  ${p(mins)}`;

        const name = record?.preferred_name ?? target.username;
        const statsBlock = [
            row('Road Crew',   h.road_crew),
            row('Dispatch',    h.dispatch),
            row('Yard Crew',   h.shunting),
            row('TrainMaster', h.trainmaster),
            '',
            `${'Total'.padEnd(12)}${fmt(grandTotal).padStart(7)}`,
            hasBonus ? `includes ${fmt(h.bonus)} founding bonus` : null,
        ].filter(l => l !== null).join('\n');

        const lines = `\`\`\`\n${statsBlock}\n\`\`\``;

        const footerText = operationalTotal === 0
            ? 'No ops logged yet — get on a train!'
            : 'GRDN Operations';

        const embed = new EmbedBuilder()
            .setTitle('📋 Operations Hours')
            .setColor(0x2b2d31)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .setDescription(`**${name}**\n\n${lines}`)
            .setTimestamp()
            .setFooter({ text: footerText });

        return interaction.reply({ embeds: [embed] });
    }
};

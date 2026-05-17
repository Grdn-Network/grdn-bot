// commands/hours.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../storage');

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

        const pct = (n) => `(${operationalTotal > 0 ? Math.round(n / operationalTotal * 100) : 0}%)`;

        const name = record?.preferred_name ?? target.username;
        const lines = [
            `🚂 Road Crew — ${fmt(h.road_crew)} *${pct(h.road_crew)}*`,
            `📡 Dispatch — ${fmt(h.dispatch)} *${pct(h.dispatch)}*`,
            `🚧 Yard Crew — ${fmt(h.shunting)} *${pct(h.shunting)}*`,
            `🎖️ TrainMaster — ${fmt(h.trainmaster)} *${pct(h.trainmaster)}*`,
            ``,
            `📊 Total — **${fmt(grandTotal)}**`,
            hasBonus ? `*includes ${fmt(h.bonus)} founding bonus*` : null,
        ].filter(l => l !== null).join('\n');

        const footerText = operationalTotal === 0
            ? 'No ops logged yet — get on a train!'
            : 'GRDN Operations';

        const embed = new EmbedBuilder()
            .setTitle('📋 Operations Hours')
            .setColor(0x2b2d31)
            .setDescription(`**${name}**\n\n${lines}`)
            .setTimestamp()
            .setFooter({ text: footerText });

        return interaction.reply({ embeds: [embed] });
    }
};

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

        const operationalTotal = h.road_crew + h.dispatch + h.shunting + h.yardmaster + h.trainmaster;
        const grandTotal = operationalTotal + h.bonus;
        const hasBonus = h.bonus > 0;

        const embed = new EmbedBuilder()
            .setTitle('📊 Operations Hours')
            .setColor(0x2b2d31)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .setDescription(`**${record?.preferred_name ?? target.username}**`)
            .addFields(
                { name: '🚂 Road Crew',   value: fmt(h.road_crew),   inline: true },
                { name: '📡 Dispatch',    value: fmt(h.dispatch),    inline: true },
                { name: '🔧 Shunting',    value: fmt(h.shunting),    inline: true },
                { name: '🏗️ Yard / Logi', value: fmt(h.yardmaster),  inline: true },
                { name: '🎖️ TrainMaster', value: fmt(h.trainmaster), inline: true },
                {
                    name: '⏱️ Total',
                    value: `**${fmt(grandTotal)}**` + (hasBonus ? `\n*includes ${fmt(h.bonus)} founding bonus*` : ''),
                    inline: false
                }
            )
            .setTimestamp()
            .setFooter({ text: hasBonus && operationalTotal === 0 ? 'No ops logged yet — get on a train!' : 'GRDN Operations' });

        return interaction.reply({ embeds: [embed] });
    }
};

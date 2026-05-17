// commands/profile.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../storage');

function fmt(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
}

const categoryMap = {
    'TrainMaster': 'trainmaster',
    'Dispatcher':  'dispatch',
    'Yard Crew':   'shunting',
    'Road Crew':   'road_crew',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View a crew profile.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to look up (defaults to yourself)')
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

        const h = storage.getUserHours(target.id);
        const grandTotal = h.road_crew + h.dispatch + h.shunting + h.trainmaster + h.bonus;
        const roleKey = categoryMap[record.type];
        const roleHours = roleKey ? h[roleKey] : 0;

        const embed = new EmbedBuilder()
            .setTitle(`📘 ${record.preferred_name}`)
            .setColor(0x2b2d31)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '👤 User',           value: `${target}`,                    inline: true },
                { name: '🛠️ Type',           value: record.type,                    inline: true },
                { name: '🚆 Train Number',   value: record.train_number || '—',     inline: true },
                { name: '⏱️ Total Hours',    value: fmt(grandTotal),                inline: true },
                { name: `📊 ${record.type} Hours`, value: fmt(roleHours),           inline: true }
            )
            .setFooter({ text: 'GRDN Crew System' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};

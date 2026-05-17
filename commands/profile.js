// commands/profile.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View the registration profile of a user.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose profile you want to view')
                .setRequired(true)
        ),

    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const record = storage.getCrewRaw(target.id);

        if (!record) {
            return interaction.reply({
                content: `❌ ${target.username} is not registered.`
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`📘 Profile: ${record.preferred_name}`)
            .setColor(0x2b2d31)
            .setThumbnail(target.displayAvatarURL({ dynamic: true }))
            .addFields(
                { name: '👤 User', value: `${target}`, inline: false },
                { name: '🛠️ Type', value: record.type, inline: true },
                { name: '🚆 Train Number', value: record.train_number || '—', inline: true },
                { name: '🏷️ Preferred Name', value: record.preferred_name, inline: true }
            )
            .setFooter({ text: 'Registration System' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed] });
    }
};

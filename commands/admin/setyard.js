// commands/admin/setyard.js
const { SlashCommandBuilder } = require('discord.js');
const { STAFF_ROLES, YARD_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setyard')
        .setDescription('Set the yard name for the yard channel.')
        .addStringOption(opt =>
            opt.setName('name')
                .setDescription('Yard prefix (e.g. "MF" → "MF Yard")')
                .setRequired(true)
        ),

    async execute(interaction) {
        const hasPermission = STAFF_ROLES.some(role => interaction.member.roles.cache.has(role));
        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const name = interaction.options.getString('name').trim();
        const newName = `${name} Yard`;

        const channel = interaction.guild.channels.cache.get(YARD_CHANNEL_ID);
        if (!channel) {
            return interaction.reply({ content: '❌ Yard channel not found.', flags: 64 });
        }

        try {
            await channel.setName(newName);
            return interaction.reply({
                content: `✅ Yard channel renamed to **${newName}**.`,
                flags: 64
            });
        } catch (err) {
            return interaction.reply({
                content: `❌ Failed to rename channel: ${err.message}`,
                flags: 64
            });
        }
    }
};
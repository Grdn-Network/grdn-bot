// commands/admin/say.js
const { SlashCommandBuilder } = require('discord.js');
const { ADMIN_ROLE } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Send a message as the bot.')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The message to send')
                .setRequired(true)
        )
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to send the message in')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const msg = interaction.options.getString('message');
        const channel = interaction.options.getChannel('channel');

        await channel.send(msg);

        return interaction.reply({
            content: '✅ Message sent.',
            flags: 64
        });
    }
};
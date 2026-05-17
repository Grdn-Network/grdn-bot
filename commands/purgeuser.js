// commands/purgeuser.js
const { SlashCommandBuilder } = require('discord.js');
const { ADMIN_ROLE } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purgeuser')
        .setDescription('Delete ALL messages from a user and then ban them.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to purge and ban')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const target = interaction.options.getUser('target');
        const guild = interaction.guild;

        await interaction.reply({
            content: `🔄 Purging all messages from **${target.tag}**...`,
            flags: 64
        });

        let deletedCount = 0;

        for (const [id, channel] of guild.channels.cache) {
            if (!channel.isTextBased()) continue;
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                const userMessages = messages.filter(msg => msg.author?.id === target.id);
                for (const msg of userMessages.values()) {
                    await msg.delete().catch(() => {});
                    deletedCount++;
                }
            } catch {
                // Ignore channels bot can't access
            }
        }

        await guild.members.ban(target.id, {
            reason: `Purged and banned by ${interaction.user.tag}`
        });

        interaction.client.emit('purgeUser', {
            moderator: interaction.user,
            target,
            deletedCount
        });

        await interaction.followUp({
            content: `✅ Deleted **${deletedCount}** messages and banned **${target.tag}**.`,
            flags: 64
        });
    }
};
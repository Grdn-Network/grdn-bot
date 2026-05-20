// commands/admin/purgeuser.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../../database/storage');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purgeuser')
        .setDescription('Delete recent messages from a user and then ban them.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The user to purge and ban')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, ADMIN_ROLE)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const target = interaction.options.getUser('target');
        const guild = interaction.guild;

        await interaction.reply({
            content: `🔄 Purging recent messages from **${target.tag}**...`,
            flags: 64
        });

        let deletedCount = 0;

        for (const [, channel] of guild.channels.cache) {
            if (!channel.isTextBased()) continue;
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                const userMessages = messages.filter(msg => msg.author?.id === target.id);
                for (const msg of userMessages.values()) {
                    await msg.delete().catch(() => {});
                    deletedCount++;
                }
            } catch {
                // Skip channels the bot cannot access
            }
        }

        await guild.members.ban(target.id, {
            reason: `Purged and banned by ${interaction.user.tag}`
        });

        // Remove from crew database so they don't linger in the train board
        storage.removeCrew(target.id);

        interaction.client.emit('purgeUser', {
            moderator: interaction.user,
            target,
            deletedCount
        });

        await interaction.followUp({
            content: `✅ Deleted **${deletedCount}** messages, banned **${target.tag}**, and removed their crew registration.`,
            flags: 64
        });
    }
};

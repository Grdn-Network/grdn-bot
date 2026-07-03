// commands/admin/purgeuser.js
//
//   /purgeuser user:@user [reason]
//     Deletes the user's recent messages across all channels, then bans them
//     and removes their crew registration. Admin only.

const { SlashCommandBuilder } = require('discord.js');
const storage = require('../../database/storage');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purgeuser')
        .setDescription("Purge a user's recent messages, then ban them.")
        .addUserOption(opt =>
            opt.setName('user')
               .setDescription('User to purge and ban')
               .setRequired(true)
        )
        .addStringOption(opt =>
            opt.setName('reason')
               .setDescription('Optional reason (shown in the ban and audit log)')
               .setRequired(false)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, ADMIN_ROLE)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: 64,
            });
        }

        const target = interaction.options.getUser('user');
        const guild = interaction.guild;
        const reason =
            interaction.options.getString('reason') ||
            `Purged and banned by ${interaction.user.tag}`;

        await interaction.reply({
            content: `Purging messages from **${target.username}**...`,
            flags: 64,
        });

        let deletedCount = 0;

        for (const [, channel] of guild.channels.cache) {
            if (!channel.isTextBased()) continue;
            try {
                const messages = await channel.messages.fetch({ limit: 100 });
                const targets = messages.filter(msg => msg.author?.id === target.id);
                for (const msg of targets.values()) {
                    await msg.delete().catch(() => {});
                    deletedCount++;
                }
            } catch {
                // Skip channels the bot cannot access
            }
        }

        await guild.members.ban(target.id, { reason });

        storage.removeCrew(target.id);

        interaction.client.emit('purgeUser', {
            moderator: interaction.user,
            target,
            deletedCount,
        });

        return interaction.editReply({
            content:
                `Banned **${target.username}**.\n` +
                `Messages deleted: **${deletedCount}**\n` +
                `Crew registration removed.`,
        });
    },
};

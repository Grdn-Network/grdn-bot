// modals/scamPurgeModal.js
// Handles the reason modal opened by the scam-alert Purge button: runs the
// purge + ban with the admin's reason, records forensics, and resolves the alert.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasAnyRole } = require('../utils/permissions');
const { purgeAndBanUser } = require('../utils/purge');
const { ADMIN_ROLE, DVMP_COMMAND_ROLE, SCAM_ALERT_CHANNEL } = require('../config');

module.exports = {
    matches: (customId) => customId.startsWith('scam_purge_modal:'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, DVMP_COMMAND_ROLE])) {
            return interaction.reply({ content: '❌ Admins only.', flags: 64 });
        }

        const [, userId, alertMsgId] = interaction.customId.split(':');
        const reason = interaction.fields.getTextInputValue('reason');

        await interaction.deferReply({ flags: 64 });

        const target = await interaction.client.users.fetch(userId).catch(() => null);

        const { deletedCount, channelsAffected, purgeId } = await purgeAndBanUser({
            guild: interaction.guild,
            targetId: userId,
            targetTag: target ? (target.tag ?? target.username) : userId,
            moderator: interaction.user,
            reason,
        });

        interaction.client.emit('purgeUser', {
            moderator: interaction.user,
            target: target ?? { id: userId, tag: userId, toString: () => `<@${userId}>` },
            deletedCount,
            channelsAffected,
            purgeId,
        });

        // Resolve the original scam alert: disable its buttons
        try {
            const alertCh = interaction.client.channels.cache.get(SCAM_ALERT_CHANNEL);
            const alertMsg = alertCh ? await alertCh.messages.fetch(alertMsgId).catch(() => null) : null;
            if (alertMsg) {
                const disabled = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('scam_resolved')
                        .setLabel(`🧹 Purged & banned by ${interaction.user.username}`)
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(true)
                );
                await alertMsg.edit({ components: [disabled] }).catch(() => {});
            }
        } catch {
            // best effort
        }

        await interaction.editReply({
            content:
                `Purged and banned **${target?.username ?? userId}**. ` +
                `${deletedCount} message${deletedCount !== 1 ? 's' : ''} across ${channelsAffected} channel${channelsAffected !== 1 ? 's' : ''}. ` +
                `Review with \`/purged id:${purgeId}\`.`,
        });
    },
};

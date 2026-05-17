// buttons/xferApprove.js
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    matches: (customId) => customId.startsWith('xfer_approve_'),

    async execute(interaction) {
        const parts = interaction.customId.split('_');
        // customId format: xfer_approve_<operatorId>_<receiverId>_<requesterId>
        const receiverId = parts[3];
        const requesterId = parts[4];

        if (interaction.user.id !== receiverId) {
            return interaction.reply({
                content: '❌ Only the assigned receiver can approve this transfer.',
                flags: 64
            });
        }

        const updatedRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(interaction.customId)
                .setLabel(`Approved by ${interaction.user.username}`)
                .setStyle(ButtonStyle.Success)
                .setDisabled(true)
        );

        await interaction.update({ components: [updatedRow] });

        return interaction.followUp({
            content: `<@${requesterId}> your request has been approved.`,
            allowedMentions: { users: [requesterId] }
        });
    }
};

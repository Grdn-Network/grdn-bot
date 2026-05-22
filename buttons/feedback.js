// buttons/feedback.js
// Handles the "Share Feedback" button sent to members when they leave.
// Works in DMs — supportsDM: true.
// customId format: feedback_btn:{guildId}:{userId}

const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');

module.exports = {
    matches: (id) => id.startsWith('feedback_btn:'),
    supportsDM: true,

    async execute(interaction) {
        const parts   = interaction.customId.split(':');
        const guildId = parts[1];
        const userId  = parts[2];

        const modal = new ModalBuilder()
            .setCustomId(`feedback_modal:${guildId}:${userId}`)
            .setTitle('GRDN Network — Feedback');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason')
                    .setLabel('What made you decide to leave?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Anything at all helps...')
                    .setRequired(false)
                    .setMaxLength(1000)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('suggestions')
                    .setLabel('Any suggestions for improvement?')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Things we could do better...')
                    .setRequired(false)
                    .setMaxLength(1000)
            )
        );

        await interaction.showModal(modal);
    },
};

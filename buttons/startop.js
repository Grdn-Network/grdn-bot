// buttons/startop.js
// "Start Official Operation" button on the dispatch embed.
// Shows a session-type picker before actually opening the session.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE, DISPATCH_QUAL_ROLE } = require('../config');

module.exports = {
    customId: 'startop_btn',

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE, DISPATCH_QUAL_ROLE])) {
            return interaction.reply({
                content: '❌ Only admins and hosts can start an operation.',
                flags: 64,
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('startop:official')
                .setLabel('Official')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('startop:unofficial')
                .setLabel('Unofficial')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('startop:stress_test')
                .setLabel('Stress Test')
                .setStyle(ButtonStyle.Secondary),
        );

        return interaction.reply({
            content: '**What type of session is this?**',
            components: [row],
            flags: 64,
        });
    },
};

// buttons/startop.js
// "Start Operation" button on the dispatch embed. Confirms opening an official
// ops session. Unofficial and stress test were retired in #39.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE } = require('../config');

module.exports = {
    customId: 'startop_btn',

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE])) {
            return interaction.reply({
                content: '❌ You do not have permission to start an operation.',
                flags: 64,
            });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('startop:official')
                .setLabel('Start Operation')
                .setStyle(ButtonStyle.Success),
        );

        return interaction.reply({
            content: '**Start an official ops session?**',
            components: [row],
            flags: 64,
        });
    },
};

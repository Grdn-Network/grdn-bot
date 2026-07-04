// buttons/startop.js
// "Start Operation" button on the dispatch embed.
// Shows a session-type picker. Members may start an Unofficial session;
// Official and Stress Test are shown only to admins, hosts, and dispatch.

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE, DISPATCH_QUAL_ROLE, MEMBER_ROLE } = require('../config');

module.exports = {
    customId: 'startop_btn',

    async execute(interaction) {
        const canOfficial = hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE, DISPATCH_QUAL_ROLE]);
        const canUnofficial = canOfficial || hasAnyRole(interaction.member, MEMBER_ROLE);

        if (!canUnofficial) {
            return interaction.reply({
                content: '❌ You do not have permission to start an operation.',
                flags: 64,
            });
        }

        const buttons = [
            new ButtonBuilder()
                .setCustomId('startop:unofficial')
                .setLabel('Unofficial')
                .setStyle(ButtonStyle.Secondary),
        ];

        if (canOfficial) {
            buttons.unshift(
                new ButtonBuilder()
                    .setCustomId('startop:official')
                    .setLabel('Official')
                    .setStyle(ButtonStyle.Success),
            );
            buttons.push(
                new ButtonBuilder()
                    .setCustomId('startop:stress_test')
                    .setLabel('Stress Test')
                    .setStyle(ButtonStyle.Secondary),
            );
        }

        const row = new ActionRowBuilder().addComponents(...buttons);

        return interaction.reply({
            content: canOfficial
                ? '**What type of session is this?**'
                : '**Start an unofficial session?** Official and Stress Test need host or dispatch.',
            components: [row],
            flags: 64,
        });
    },
};

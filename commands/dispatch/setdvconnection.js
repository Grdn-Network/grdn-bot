// commands/dispatch/setdvconnection.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../../database/storage');
const { hasAnyRole } = require('../../utils/permissions');
const { STAFF_ROLES } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setdvconnection')
        .setDescription('Set the Derail Valley mod connection URL.')
        .addStringOption(opt =>
            opt.setName('url')
                .setDescription('Full URL to the mod (e.g. https://guardian.connect.grdnnetwork.com or http://1.2.3.4:7230)')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const url = interaction.options.getString('url').trim().replace(/\/$/, '');

        if (!/^https?:\/\/.+/i.test(url)) {
            return interaction.reply({
                content: '❌ Invalid URL. Must start with `http://` or `https://`.',
                flags: 64
            });
        }

        // Block loopback
        if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0)/i.test(url)) {
            return interaction.reply({
                content: '❌ That address is not allowed.',
                flags: 64
            });
        }

        storage.setDvUrl(url);

        return interaction.reply({
            content: `✅ DV connection set to **${url}**`,
            flags: 64
        });
    }
};

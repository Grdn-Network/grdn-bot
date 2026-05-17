// commands/setdvconnection.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../storage');
const { hasAnyRole } = require('../utils/permissions');
const { STAFF_ROLES } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setdvconnection')
        .setDescription('Set the Derail Valley mod host and port.')
        .addStringOption(opt =>
            opt.setName('host')
                .setDescription('The host IP or domain (e.g. 192.168.1.50)')
                .setRequired(true)
        )
        .addIntegerOption(opt =>
            opt.setName('port')
                .setDescription('The port the mod is listening on (e.g. 7230)')
                .setRequired(true)
                .setMinValue(1024)
                .setMaxValue(65535)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const host = interaction.options.getString('host').trim();
        const port = interaction.options.getInteger('port');

        // Basic host validation — reject obviously internal/loopback addresses
        const blocked = /^(localhost|127\.|0\.0\.0\.0|::1)/i.test(host);
        if (blocked) {
            return interaction.reply({
                content: '❌ That host address is not allowed.',
                flags: 64
            });
        }

        storage.setDvSettings(host, port);

        return interaction.reply({
            content: `✅ DV connection set to **${host}:${port}**.`,
            flags: 64
        });
    }
};

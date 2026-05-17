// commands/setdvconnection.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const { STAFF_ROLES } = require('../config');

db.prepare(`
    CREATE TABLE IF NOT EXISTS dv_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        dv_host TEXT,
        dv_port INTEGER
    )
`).run();

db.prepare(`
    INSERT OR IGNORE INTO dv_settings (id, dv_host, dv_port)
    VALUES (1, NULL, NULL)
`).run();

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
        const hasPermission = STAFF_ROLES.some(r => interaction.member.roles.cache.has(r));
        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const host = interaction.options.getString('host').trim();
        const port = interaction.options.getInteger('port');

        db.prepare(`UPDATE dv_settings SET dv_host = ?, dv_port = ? WHERE id = 1`).run(host, port);

        return interaction.reply({
            content: `✅ DV connection set to **${host}:${port}**.`,
            flags: 64
        });
    }
};
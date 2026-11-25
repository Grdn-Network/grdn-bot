// commands/dispatch/synctest.js
// BETA test harness for the mod auto-sync. Simulates a GRDNConnect scan using
// the current mods (plus two synthetic entries so categories and url
// normalization are visible), then applies it to the Auto Sync preset. Admin
// only, and only works while MOD_SYNC_BETA is on. Lets us test the bot half
// before the Connect sender exists.

const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/db');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, MOD_SYNC_BETA, SYNC_PRESET_NAME } = require('../../config');
const { applyScan } = require('../../utils/modSync');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('synctest')
        .setDescription('BETA: simulate a Connect mod scan into the Auto Sync preset (admin).'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE])) {
            return interaction.reply({ content: '❌ Admins only.', flags: 64 });
        }
        if (!MOD_SYNC_BETA) {
            return interaction.reply({
                content: '❌ Mod auto-sync beta is off. Set `MOD_SYNC_BETA: true` in config and restart to test.',
                flags: 64,
            });
        }

        // Fake scan = current live mods (paired by name as the id) plus two
        // synthetic entries: one host-only with a github repo URL (to show the
        // /releases normalization) and one client with no URL (to show the gap).
        const live = db.prepare(`SELECT name, url, version, category FROM mods ORDER BY sort_order, id`).all();
        const scan = live.map(m => ({
            id: m.name, name: m.name, version: m.version, url: m.url, category: m.category,
        }));
        scan.push(
            { id: 'GRDN.SyncTest.Host',   name: 'Sync Test (Host Only)', version: '1.0.0', url: 'https://github.com/Grdn-Network/grdnConnect', category: 'host' },
            { id: 'GRDN.SyncTest.Client', name: 'Sync Test (Client)',    version: '1.0.0', url: '',                                            category: 'optional' },
        );

        try {
            const s = applyScan(scan);
            const c = s.counts;
            return interaction.reply({
                content:
                    `✅ Simulated scan applied to **${s.preset}** (${s.total} mods).\n` +
                    `Required: ${c.required || 0}  ·  Client/Optional: ${c.optional || 0}  ·  Host: ${c.host || 0}\n` +
                    `Preview with \`/viewmods preset:${SYNC_PRESET_NAME}\`. Re-run after a \`/mod category\` on that preset to confirm moves persist.`,
                flags: 64,
            });
        } catch (err) {
            return interaction.reply({ content: `❌ Sync test failed: ${err.message}`, flags: 64 });
        }
    },
};

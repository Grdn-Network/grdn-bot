// commands/resetnames.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../storage');
const { ADMIN_ROLE, HOST_ROLE } = require('../config');
const db = require('../database/db');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetnames')
        .setDescription('Reset all user nicknames to their registered Preferred Name.'),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE) && !interaction.member.roles.cache.has(HOST_ROLE)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        await interaction.reply({
            content: '🔄 Resetting all nicknames to Preferred Names…',
            flags: 64
        });

        const { reset, failed } = await module.exports.resetLogic(interaction);

        return interaction.followUp({
            content: `✅ Nickname reset complete.\n• Reset: **${reset}**\n• Failed: **${failed}**`,
            flags: 64
        });
    },

    // Silent version called by buttons
    async executeSilent(interaction) {
        await module.exports.resetLogic(interaction);
    },

    async resetLogic(interaction) {
        const guild = interaction.guild;
        const crew = storage.getAllCrew(guild.id);

        let reset = 0;
        let failed = 0;

        for (const row of crew) {
            try {
                const member = await guild.members.fetch(row.userId).catch(() => null);
                if (!member) { failed++; continue; }

                await member.setNickname(row.preferredName).catch(() => { failed++; });

                db.prepare(`
                    UPDATE registrations SET train_number = '' WHERE user_id = ?
                `).run(row.userId);

                reset++;
            } catch {
                failed++;
            }
        }

        return { reset, failed };
    }
};
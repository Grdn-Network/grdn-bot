// commands/resetnames.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../storage');
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetnames')
        .setDescription('Reset all user nicknames to their Preferred Name and clear train numbers.'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE])) {
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

    async resetLogic(interaction) {
        const guild = interaction.guild;
        const crew = storage.getAllCrew(guild.id);

        let reset = 0;
        let failed = 0;

        for (const row of crew) {
            try {
                const member = await guild.members.fetch(row.userId).catch(() => null);
                if (!member) { failed++; continue; }

                const ok = await member.setNickname(row.preferredName).then(() => true).catch(() => false);
                if (ok) reset++; else failed++;
            } catch {
                failed++;
            }
        }

        // Bulk-clear all train numbers after nickname sync
        storage.clearAllTrainNumbers();

        return { reset, failed };
    }
};

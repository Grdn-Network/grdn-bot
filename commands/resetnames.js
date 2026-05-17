// commands/resetnames.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../storage');
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE } = require('../config');
const { deleteAllCrewVCs } = require('../logging/crewVCManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resetnames')
        .setDescription('Close the ops session and reset all nicknames to Preferred Name.'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE])) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        await interaction.reply({ content: '🔄 Closing ops session and resetting nicknames…', flags: 64 });

        const { reset, failed, sessionClosed } = await module.exports.resetLogic(interaction);

        return interaction.followUp({
            content:
                `✅ Reset complete.\n` +
                `• Nicknames reset: **${reset}** | Failed: **${failed}**\n` +
                `• Ops session: **${sessionClosed ? 'closed — hours saved' : 'no active session'}**`,
            flags: 64
        });
    },

    async resetLogic(interaction) {
        const guild = interaction.guild;
        const now = Date.now();

        // Close ops session and write hours before clearing train numbers
        const sessionId = storage.closeSession(guild.id, interaction.user.id, now);

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

        storage.clearAllTrainNumbers();
        storage.clearAllAssignments(guild.id);
        await deleteAllCrewVCs(guild.client, guild.id);

        return { reset, failed, sessionClosed: sessionId !== null };
    }
};

// commands/syncnames.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../storage');
const { buildNickname } = require('../utils/nickname');
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, DISPATCH_QUAL_ROLE } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('syncnames')
        .setDescription('Sync all registered nicknames and open an official ops session.'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, DISPATCH_QUAL_ROLE])) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        await interaction.reply({ content: '🔄 Syncing nicknames and opening ops session…', flags: 64 });

        const guild = interaction.guild;
        const now = Date.now();

        // Open a new ops session — enrolls all crew who have an active role + train number
        const sessionId = storage.openSession(guild.id, interaction.user.id, now);
        const crew = storage.getAllCrew(guild.id);

        let updated = 0;
        let failed = 0;
        let enrolled = 0;

        for (const row of crew) {
            try {
                const member = await guild.members.fetch(row.userId).catch(() => null);
                if (!member) { failed++; continue; }

                const ok = await member.setNickname(
                    buildNickname(row.type, row.trainNumber, row.preferredName)
                ).then(() => true).catch(() => false);

                if (ok) updated++; else failed++;

                // Only enroll in ops session if they're currently in a voice channel
                if (member.voice.channel) {
                    const category = storage.classifyCategory(row.type, row.trainNumber);
                    if (category) {
                        storage.openOpsEntry(row.userId, guild.id, sessionId, category, now);
                        enrolled++;
                    }
                }
            } catch {
                failed++;
            }
        }

        return interaction.followUp({
            content:
                `✅ Sync complete. Ops session open.\n` +
                `• Nicknames updated: **${updated}** | Failed: **${failed}**\n` +
                `• Crew enrolled in session: **${enrolled}**`,
            flags: 64
        });
    }
};

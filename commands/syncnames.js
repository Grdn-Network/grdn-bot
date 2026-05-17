// commands/syncnames.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../storage');
const { buildNickname } = require('../utils/nickname');
const { ADMIN_ROLE, DISPATCH_QUAL_ROLE } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('syncnames')
        .setDescription('Update all registered users\' nicknames based on their registration info.'),

    async execute(interaction) {
        const hasPermission = 
            interaction.member.roles.cache.has(ADMIN_ROLE) ||
            interaction.member.roles.cache.has(DISPATCH_QUAL_ROLE);

        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        await interaction.reply({
            content: '🔄 Updating all nicknames…',
            flags: 64
        });

        const guild = interaction.guild;
        const crew = storage.getAllCrew(guild.id);

        let updated = 0;
        let failed = 0;

        for (const row of crew) {
            try {
                const member = await guild.members.fetch(row.userId).catch(() => null);
                if (!member) { failed++; continue; }

                await member.setNickname(
                    buildNickname(row.type, row.trainNumber, row.preferredName)
                ).catch(() => { failed++; });

                updated++;
            } catch {
                failed++;
            }
        }

        return interaction.followUp({
            content: `✅ Nickname sync complete.\n• Updated: **${updated}**\n• Failed: **${failed}**`,
            flags: 64
        });
    }
};
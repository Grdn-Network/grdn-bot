// commands/ops/jobs.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fetch = require('node-fetch');
const storage = require('../../database/storage');
const { hasAnyRole } = require('../../utils/permissions');
const { STAFF_ROLES } = require('../../config');

const FETCH_TIMEOUT_MS = 5000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jobs')
        .setDescription('List all active Derail Valley jobs.'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const baseUrl = storage.getDvBaseUrl();
        if (!baseUrl) {
            return interaction.reply({
                content: '❌ DV connection not configured. Ask a staff member to run `/setdvconnection`.',
                flags: 64
            });
        }

        await interaction.deferReply();

        try {
            const response = await fetch(
                `${baseUrl}/jobs`,
                { timeout: FETCH_TIMEOUT_MS }
            );

            if (!response.ok) {
                return interaction.editReply('⚠️ The Derail Valley mod responded with an error.');
            }

            const jobs = await response.json();

            if (!jobs.length) {
                return interaction.editReply('📋 No active jobs found.');
            }

            const embed = new EmbedBuilder()
                .setTitle('📋 Active Derail Valley Jobs')
                .setColor(0x2b2d31)
                .setTimestamp();

            for (const job of jobs.slice(0, 25)) {
                embed.addFields({
                    name: `${job.id} — ${job.type}`,
                    value: `**State:** ${job.state}\n**From:** ${job.departure}\n**To:** ${job.destination}`,
                    inline: true
                });
            }

            if (jobs.length > 25) {
                embed.setFooter({ text: `Showing 25 of ${jobs.length} jobs` });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (err) {
            console.error('[GRDNConnect] Error fetching jobs:', err);
            await interaction.editReply('⚠️ Could not reach the Derail Valley mod. Is the game running?');
        }
    }
};

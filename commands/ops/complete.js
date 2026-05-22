// commands/ops/complete.js
// /complete jobid: — complete a Derail Valley job via GRDNConnect. Staff only.

const { SlashCommandBuilder } = require('discord.js');
const fetch   = require('node-fetch');
const storage = require('../../database/storage');
const { hasAnyRole } = require('../../utils/permissions');
const { STAFF_ROLES } = require('../../config');

const FETCH_TIMEOUT_MS = 5000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('complete')
        .setDescription('Complete a Derail Valley job by job ID. (Staff only)')
        .addStringOption(opt =>
            opt.setName('jobid')
               .setDescription('Job ID to complete (e.g. HB-SU-27)')
               .setRequired(true)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
        }

        const baseUrl = storage.getDvBaseUrl();
        if (!baseUrl)
            return interaction.reply({
                content: '❌ DV connection not configured. Ask a staff member to set it up.',
                flags: 64,
            });

        const jobId = interaction.options.getString('jobid');
        await interaction.deferReply();

        try {
            const response = await fetch(`${baseUrl}/complete-job`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ jobId }),
                timeout: FETCH_TIMEOUT_MS,
            });

            let result;
            try { result = await response.json(); } catch { result = null; }

            if (!result)
                return interaction.editReply('⚠️ The Derail Valley mod returned an unexpected response. Is the game running?');

            if (result.ok) {
                return interaction.editReply(`✅ Job **${jobId}** completed. The crew will receive payment in-game.`);
            } else if (response.status === 404) {
                return interaction.editReply(`⚠️ Job **${jobId}** could not be completed — not finished yet or not found.`);
            } else {
                return interaction.editReply(`❌ Could not complete **${jobId}**: ${result.error ?? 'Unknown error'}`);
            }
        } catch (err) {
            console.error('[GRDNConnect] complete-job error:', err);
            return interaction.editReply('⚠️ Could not reach the Derail Valley mod. Is the game running and the mod enabled?');
        }
    },
};

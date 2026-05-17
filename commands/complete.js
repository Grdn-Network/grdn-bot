// commands/complete.js
const { SlashCommandBuilder } = require('discord.js');
const fetch = require('node-fetch');
const storage = require('../storage');
const { hasAnyRole } = require('../utils/permissions');
const { STAFF_ROLES } = require('../config');

const FETCH_TIMEOUT_MS = 5000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('complete')
        .setDescription('Complete a Derail Valley job by job ID.')
        .addStringOption(opt =>
            opt.setName('jobid')
                .setDescription('The job ID to complete (e.g. HB-SU-27)')
                .setRequired(true)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const settings = storage.getDvSettings();
        if (!settings?.dv_host || !settings?.dv_port) {
            return interaction.reply({
                content: '❌ DV host/port not configured. Ask a staff member to run `/setdvconnection`.',
                flags: 64
            });
        }

        const jobId = interaction.options.getString('jobid');
        await interaction.deferReply();

        try {
            const response = await fetch(
                `http://${settings.dv_host}:${settings.dv_port}/complete-job`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jobId }),
                    timeout: FETCH_TIMEOUT_MS
                }
            );

            let result;
            try { result = await response.json(); } catch { result = null; }

            if (!result) {
                return interaction.editReply('⚠️ The Derail Valley mod returned an unexpected response. Is the game running?');
            }

            if (result.ok) {
                await interaction.editReply(`✅ Job **${jobId}** has been completed. The crew will receive payment in-game.`);
            } else if (response.status === 404) {
                await interaction.editReply(`⚠️ Job **${jobId}** could not be completed — it may not be finished yet or wasn't found.`);
            } else {
                await interaction.editReply(`❌ Could not complete job **${jobId}**: ${result.error ?? 'Unknown error'}`);
            }
        } catch (err) {
            console.error('[GRDNConnect] Error contacting DV mod:', err);
            await interaction.editReply('⚠️ Could not reach the Derail Valley mod. Is the game running and the mod enabled?');
        }
    }
};

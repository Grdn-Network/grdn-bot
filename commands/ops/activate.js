// commands/ops/activate.js
// /activate [jobid] — start/activate a Derail Valley job via GRDNConnect.
// Defaults to the job on the caller's assigned crew train. Available to all crew.
// Pairs with the mod's /activate-job endpoint (grdnConnect#19 / #5 slice 1).

const { SlashCommandBuilder } = require('discord.js');
const fetch   = require('node-fetch');
const storage = require('../../database/storage');
const { OPS_CHAT_CHANNEL_ID } = require('../../config');
const { requireChannel } = require('../../utils/commandChannel');

const FETCH_TIMEOUT_MS = 5000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activate')
        .setDescription('Start a Derail Valley job (defaults to your assigned train).')
        .addStringOption(opt =>
            opt.setName('jobid')
               .setDescription('Job ID (optional; defaults to the job on your assigned train)')
               .setRequired(false)
        ),

    async execute(interaction) {
        if (!await requireChannel(interaction, OPS_CHAT_CHANNEL_ID)) return;

        const baseUrl = storage.getDvBaseUrl();
        if (!baseUrl)
            return interaction.reply({
                content: '❌ DV connection not configured. Ask a staff member to set it up.',
                flags: 64,
            });

        const jobId = interaction.options.getString('jobid');

        // No job ID: default to the job on the caller's assigned crew train.
        let trainNumber = null;
        if (!jobId) {
            const crew = storage.getCrewRaw(interaction.user.id);
            trainNumber = crew?.train_number?.trim() || null;
            if (!trainNumber)
                return interaction.reply({
                    content: '❌ No job ID given and you have no assigned train. Set one with `/setcrew`, or pass `jobid`.',
                    flags: 64,
                });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const response = await fetch(`${baseUrl}/activate-job`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(jobId ? { jobId } : { trainNumber }),
                timeout: FETCH_TIMEOUT_MS,
            });

            let result;
            try { result = await response.json(); } catch { result = null; }

            if (!result)
                return interaction.editReply('⚠️ The Derail Valley mod returned an unexpected response. Is the game running?');

            if (result.ok) {
                await interaction.deleteReply();
                const startedId = result.jobId || jobId;
                return interaction.followUp(`✅ Job **${startedId}** started.`);
            }

            const label  = jobId || (trainNumber ? `train ${trainNumber}` : 'the job');
            const detail = result.error ? `\n> ${result.error}` : '';
            return interaction.editReply(`⚠️ Could not start **${label}**.${detail}`);
        } catch (err) {
            console.error('[GRDNConnect] activate-job error:', err);
            return interaction.editReply('⚠️ Could not reach the Derail Valley mod. Is the game running and the mod enabled?');
        }
    },
};

// commands/ops/complete.js
// /complete jobid: — complete a Derail Valley job via GRDNConnect.
// Available to all crew. Failures are shown only to the user who ran the command.

const { SlashCommandBuilder } = require('discord.js');
const fetch   = require('node-fetch');
const storage = require('../../database/storage');
const { classifyLeg } = require('../../utils/statsHelper');

const FETCH_TIMEOUT_MS = 5000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('complete')
        .setDescription('Complete a Derail Valley job by job ID.')
        .addStringOption(opt =>
            opt.setName('jobid')
               .setDescription('Job ID to complete (e.g. HB-SU-27)')
               .setRequired(true)
        ),

    async execute(interaction) {
        const baseUrl = storage.getDvBaseUrl();
        if (!baseUrl)
            return interaction.reply({
                content: '❌ DV connection not configured. Ask a staff member to set it up.',
                flags: 64,
            });

        const jobId = interaction.options.getString('jobid');

        // Defer ephemeral — failures stay hidden. Success deletes this and sends a
        // public follow-up so the channel sees the completed job.
        await interaction.deferReply({ ephemeral: true });

        const fail = async (msg) => {
            return interaction.editReply(msg);          // ephemeral — only visible to caller
        };

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
                return fail('⚠️ The Derail Valley mod returned an unexpected response. Is the game running?');

            if (result.ok) {
                // Record job attribution for stats tracking
                try {
                    const session = storage.getActiveSession(interaction.guild.id);
                    if (session) {
                        const hubs    = storage.getHubStations();
                        const legType = classifyLeg(result.departure, result.destination, hubs);
                        storage.recordJobCompletion({
                            sessionId:   session.id,
                            userId:      interaction.user.id,
                            jobId:       result.jobId,
                            jobType:     result.jobType    || null,
                            departure:   result.departure  || null,
                            destination: result.destination || null,
                            carCount:    result.carCount   || 0,
                            cargo:       result.cargo      || null,
                            wage:        result.wage       || 0,
                            legType,
                        });
                        console.log(`[Complete] ${result.jobId} attributed to ${interaction.user.id} (${legType})`);
                    }
                } catch (err) {
                    console.error('[Complete] Stats attribution error:', err.message);
                }

                // Delete the ephemeral defer, then post a public success message.
                await interaction.deleteReply();
                return interaction.followUp(`✅ Job **${jobId}** completed. Payment has been made.`);
            } else {
                const detail = result.error ? `\n> ${result.error}` : '';
                return fail(`⚠️ Could not complete **${jobId}**.${detail}`);
            }
        } catch (err) {
            console.error('[GRDNConnect] complete-job error:', err);
            return fail('⚠️ Could not reach the Derail Valley mod. Is the game running and the mod enabled?');
        }
    },
};

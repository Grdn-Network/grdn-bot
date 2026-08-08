// commands/ops/complete.js
// /complete jobid: — complete a Derail Valley job via GRDNConnect.
// Available to all crew. Failures are shown only to the user who ran the command.

const { SlashCommandBuilder } = require('discord.js');
const fetch   = require('node-fetch');
const storage = require('../../database/storage');
const { classifyLeg } = require('../../utils/statsHelper');
const { OPS_CHAT_CHANNEL_ID } = require('../../config');
const { requireChannel } = require('../../utils/commandChannel');

const FETCH_TIMEOUT_MS = 5000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('complete')
        .setDescription('Complete a Derail Valley job (defaults to your assigned train).')
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
                body:    JSON.stringify(jobId ? { jobId } : { trainNumber }),
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
                const doneId = result.jobId || jobId;
                return interaction.followUp(`✅ Job **${doneId}** completed. Payment has been made.`);
            } else {
                const label  = jobId || (trainNumber ? `train ${trainNumber}` : 'the job');
                const detail = result.error ? `\n> ${result.error}` : '';
                return fail(`⚠️ Could not complete **${label}**.${detail}`);
            }
        } catch (err) {
            console.error('[GRDNConnect] complete-job error:', err);
            return fail('⚠️ Could not reach the Derail Valley mod. Is the game running and the mod enabled?');
        }
    },
};

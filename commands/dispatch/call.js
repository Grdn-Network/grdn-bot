// commands/dispatch/call.js
// /call train: — dispatch pages a train crew.
//
// Two-layer notification:
//   1. Immediate text ping in the current channel (Discord notification).
//   2. Bot joins the crew's current VC and plays an audio alert, then leaves.
//      Requires @discordjs/voice + ffmpeg on the VPS. If the library isn't
//      installed the text ping still fires; the voice step fails silently.
//
// Staff only (Dispatch Qual, Admin, Host, DVMP Command).

const { SlashCommandBuilder } = require('discord.js');
const { hasAnyRole }  = require('../../utils/permissions');
const { STAFF_ROLES } = require('../../config');
const storage = require('../../database/storage');

// voiceAlert is optional — if @discordjs/voice isn't installed the text ping
// still works and this just logs a warning.
let alertTrain;
try {
    ({ alertTrain } = require('../../utils/voiceAlert'));
} catch {
    alertTrain = null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('call')
        .setDescription('Page a train crew to contact dispatch.')
        .addStringOption(opt =>
            opt.setName('train')
               .setDescription('Train number to page (e.g. 038)')
               .setRequired(true)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64,
            });
        }

        const train = interaction.options.getString('train').trim();
        const crew  = storage.getAllCrew(interaction.guild.id)
            .filter(c => String(c.trainNumber) === String(train));

        if (crew.length === 0) {
            return interaction.reply({
                content: `⚠️ No crew registered to train **${train}**.`,
                flags: 64,
            });
        }

        // ── 1. Immediate text ping ────────────────────────────────────────────
        const mentions = crew.map(c => `<@${c.userId}>`).join(' ');
        await interaction.reply({
            content: `📻 ${mentions} — **Train ${train}**, contact dispatch.`,
        });

        // ── 2. Voice alert — join their VC and play TTS (fire and forget) ─────
        if (alertTrain) {
            alertTrain(
                interaction.guild,
                train,
                `Train ${train}, contact dispatch`
            ).catch(err => {
                console.error('[call] Voice alert failed:', err.message);
            });
        }
    },
};

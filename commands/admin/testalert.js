// commands/admin/testalert.js
// /testalert [type] — staff command to audition the clip stitcher.
//
// Join a voice channel, then run this. The bot joins, plays the stitched
// alert for the selected defect type using train "034" as a sample, then leaves.
//
// REPLACING PLACEHOLDER CLIPS
// ────────────────────────────
// Clips live in audio/clips/. Drop in new .wav files with the same names
// and the next /testalert immediately uses them — no restart needed.
//
// ADDING YOUR OWN RECORDINGS
// ────────────────────────────
// Record each phrase as a separate WAV, name it to match the clip inventory
// in utils/voiceAlert.js, and drop it in audio/clips/.

const { SlashCommandBuilder } = require('discord.js');
const { hasAnyRole } = require('../../utils/permissions');
const { STAFF_ROLES } = require('../../config');
const path = require('path');
const fs   = require('fs');

// Sample detail values for each defect type
const SAMPLE_DETAIL = {
    hotbox:       'rear truck',
    derailment:   null,
    airhose:      null,
    dragging:     null,
    consistcheck: '24 45',   // "24 cars, speed 45"
    call:         null,
};

// Map /testalert type names to voiceAlert defect type strings
const TYPE_MAP = {
    hotbox:       'Hot Box',
    derailment:   'Derailment',
    airhose:      'Air Hose Defect',
    dragging:     'Dragging Equipment',
    consistcheck: 'Consist Check',
    call:         'call',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testalert')
        .setDescription('Audition the defect detector clip stitcher — join a VC first.')
        .addStringOption(o => o
            .setName('type')
            .setDescription('Which alert to play (default: hotbox)')
            .setRequired(false)
            .addChoices(
                { name: 'Hot Box',        value: 'hotbox'       },
                { name: 'Derailment',     value: 'derailment'   },
                { name: 'Air Hose',       value: 'airhose'      },
                { name: 'Dragging Equip', value: 'dragging'     },
                { name: 'Consist Check',  value: 'consistcheck' },
                { name: '/call style',    value: 'call'         },
            )
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
            return interaction.reply({ content: '❌ Staff only.', flags: 64 });
        }

        const voiceChannel = interaction.member.voice?.channel;
        if (!voiceChannel) {
            return interaction.reply({
                content: '❌ You need to be in a voice channel first.',
                flags: 64,
            });
        }

        const type       = interaction.options.getString('type') ?? 'hotbox';
        const defectType = TYPE_MAP[type];
        const detail     = SAMPLE_DETAIL[type];

        await interaction.deferReply({ flags: 64 });

        let voiceAlert;
        try {
            voiceAlert = require('../../utils/voiceAlert');
        } catch (err) {
            return interaction.editReply(
                `❌ voiceAlert unavailable — make sure \`@discordjs/voice\` is installed.\n\`\`\`${err.message}\`\`\``
            );
        }

        // Show which clips will be stitched
        let clips;
        try {
            clips = voiceAlert.buildClipSequence('034', defectType, detail);
        } catch (err) {
            return interaction.editReply(`❌ ${err.message}`);
        }

        // Check for any missing clips up front and report clearly
        const clipsDir = voiceAlert.CLIPS_DIR;
        const missing  = clips.filter(n => !fs.existsSync(path.join(clipsDir, `${n}.wav`)));
        if (missing.length > 0) {
            return interaction.editReply(
                `❌ Missing clip files:\n\`\`\`${missing.map(n => n + '.wav').join('\n')}\`\`\`\n` +
                `Drop them into \`audio/clips/\` and try again.`
            );
        }

        try {
            await voiceAlert.playInChannel(voiceChannel, clips);
            return interaction.editReply(
                `✅ Played **${type}** alert.\n` +
                `Clips stitched: \`${clips.join(' → ')}\`\n\n` +
                `To use real recordings, drop \`.wav\` files into \`audio/clips/\` — no restart needed.`
            );
        } catch (err) {
            const msg = err.message ?? '';
            let hint = '';
            if (msg.includes('STEP1_CONNECT')) {
                hint = '\n**Voice connection failed** — the VPS cannot reach Discord\'s voice servers via UDP.\nCheck the hosting provider\'s external firewall and allow outbound UDP traffic.';
            } else if (msg.includes('ffmpeg') || msg.includes('STEP2')) {
                hint = '\nMake sure `ffmpeg` is installed: `winget install Gyan.FFmpeg`';
            } else if (msg.includes('STEP4_PLAYBACK')) {
                hint = '\nPlayback timed out — the audio resource may be malformed.';
            }
            return interaction.editReply(`❌ Playback failed.\n\`\`\`${msg}\`\`\`${hint}`);
        }
    },
};

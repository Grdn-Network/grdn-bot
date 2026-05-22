// commands/admin/testalert.js
// /testalert [type] [engine] — staff command to audition TTS voices.
//
// Run this while sitting in a voice channel. The bot joins, plays the sample,
// then leaves. Run it several times with engine:random to hear the 70/30 mix.
//
// QUICK SETUP CHECKLIST
// ──────────────────────
//  espeak-ng (free, recommended):
//    VPS: apt install espeak-ng
//    Test: VOICE_ENGINE=espeak node -e "require('./utils/voiceAlert').alertChannel(...)"
//
//  gtts (already installed):
//    VPS: npm install gtts          ← probably already done
//    Test: VOICE_ENGINE=gtts  ...
//
//  Amazon Polly:
//    VPS: npm install @aws-sdk/client-polly
//    .env: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
//
//  OpenAI TTS:
//    VPS: npm install openai
//    .env: OPENAI_API_KEY

const { SlashCommandBuilder } = require('discord.js');
const { hasAnyRole } = require('../../utils/permissions');
const { STAFF_ROLES } = require('../../config');

// Sample messages for each defect type — same format as real DefectMonitor output
const SAMPLES = {
    hotbox:       'Attention. Train, zero three four. G R D N detector. Hot box detected. Rear truck. Reduce speed and inspect. End of message.',
    derailment:   'Emergency. Train, zero three four. G R D N detector. Derailment detected. Stop immediately and contact dispatch. End of message.',
    airhose:      'Attention. Train, zero three four. G R D N detector. Air hose defect. Check brake line and reduce speed. End of message.',
    dragging:     'Attention. Train, zero three four. G R D N detector. Dragging equipment. Stop train and inspect consist. End of message.',
    consistcheck: 'Train, zero three four. G R D N detector. No defects detected. Twenty four cars. Speed, forty five. End of message.',
    call:         'Train zero three four, contact dispatch.',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('testalert')
        .setDescription('Audition TTS voice engines — join a VC first, then run this.')
        .addStringOption(o => o
            .setName('type')
            .setDescription('Which sample to play (default: hotbox)')
            .setRequired(false)
            .addChoices(
                { name: 'Hot Box',        value: 'hotbox'       },
                { name: 'Derailment',     value: 'derailment'   },
                { name: 'Air Hose',       value: 'airhose'      },
                { name: 'Dragging Equip', value: 'dragging'     },
                { name: 'Consist Check',  value: 'consistcheck' },
                { name: '/call style',    value: 'call'         },
            )
        )
        .addStringOption(o => o
            .setName('engine')
            .setDescription('Pin a specific TTS engine (default: random weighted)')
            .setRequired(false)
            .addChoices(
                { name: 'Random (70% espeak / 30% gtts)',        value: 'random'  },
                { name: 'espeak-ng — robotic, defect-detector',  value: 'espeak'  },
                { name: 'gtts — Google TTS, natural voice',      value: 'gtts'    },
                { name: 'polly — Amazon Polly Standard',         value: 'polly'   },
                { name: 'openai — OpenAI TTS (onyx voice)',      value: 'openai'  },
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

        const type   = interaction.options.getString('type')   ?? 'hotbox';
        const engine = interaction.options.getString('engine') ?? 'random';
        const text   = SAMPLES[type];

        await interaction.deferReply({ flags: 64 });

        let voiceAlert;
        try {
            voiceAlert = require('../../utils/voiceAlert');
        } catch (err) {
            return interaction.editReply(
                `❌ voiceAlert unavailable — make sure \`@discordjs/voice\` is installed.\n\`\`\`${err.message}\`\`\``
            );
        }

        // Resolve engine object (or null for random)
        let engineOverride = null;
        if (engine !== 'random') {
            engineOverride = voiceAlert.VOICE_WEIGHTS.find(e => e.name === engine);
            if (!engineOverride) {
                // Engine listed in choices but not in VOICE_WEIGHTS (e.g. polly/openai not yet configured)
                engineOverride = { name: engine, weight: 0, options: {} };
            }
        }

        try {
            await voiceAlert.playInChannel(voiceChannel, text, engineOverride);
            const engineUsed = engineOverride?.name ?? 'random';
            return interaction.editReply(
                `✅ Played **${type}** sample via **${engineUsed}**.\n` +
                `> *${text}*\n\n` +
                `Run again with a different \`engine:\` to compare. ` +
                `Set \`VOICE_ENGINE=espeak\` in \`.env\` to pin an engine for all alerts.`
            );
        } catch (err) {
            return interaction.editReply(
                `❌ Playback failed with engine **${engineOverride?.name ?? 'random'}**.\n` +
                `\`\`\`${err.message}\`\`\`\n` +
                `Check the VPS: \`apt install espeak-ng\` or verify your API keys.`
            );
        }
    },
};

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, SETUP_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Post the getting-started embed in #setup'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE])) {
            return interaction.reply({
                content: '❌ Only admins can post the setup embed.',
                flags: 64,
            });
        }

        const channel = interaction.guild.channels.cache.get(SETUP_CHANNEL_ID);
        if (!channel) {
            return interaction.reply({
                content: '❌ Could not find the setup channel.',
                flags: 64,
            });
        }

        const webhook = await channel.createWebhook({
            name: 'GRDN Ops',
            avatar: 'https://raw.githubusercontent.com/Grdn-Network/grdn-bot/main/assets/logo.png',
        });

        const embed = new EmbedBuilder()
            .setTitle('Welcome to GRDN Ops')
            .setColor(0x2b2d31)
            .setDescription('Here\'s how to get started.')
            .addFields(
                {
                    name: 'Operations are event-based',
                    value: 'Check the pinned announcement at the top of the server for the current event, then use #ops-info for server connection details and mod info.',
                },
                {
                    name: 'When you join',
                    value: 'Find a locomotive anywhere on the map. Set your train number using `/setcrew` in Discord — you\'ll need a Preferred Name. After that you can use the in-game comms radio.\n\nJump into Ops Radio East and let the controller know where you are and what you\'re doing. Generally you\'ll want to snag a train, then contact dispatch via `/setcrew` or the radio.\n\nIf nobody is controlling your area, you\'re in Dark Territory — grab a job and go, just watch your surroundings.',
                },
                {
                    name: 'First time using GRDNConnect?',
                    value: 'Load into the game and try to use the radio. A message will appear in #ops-chat — click the button to link your Steam and Discord accounts. You only do this once.',
                },
                {
                    name: 'Not sure what to do? Ask.',
                    value: 'Controllers expect questions and will guide you.',
                },
                {
                    name: 'Mods',
                    value: 'Found in #ops-info. For unofficial operations they may be posted in #ops-chat instead.',
                },
                {
                    name: 'Comms',
                    value: 'For communication structure, examples, and specifics — a read of the Core tab in the SOP is advised, but you\'ll pick most of it up just by listening for a few seconds in the operation.',
                },
                {
                    name: 'Full SOP',
                    value: '[Read it here](https://www.grdnnetwork.com/grdn/sop) — go deeper on anything.',
                },
            )
            .setFooter({ text: 'Most of what you need you\'ll pick up by playing.' });

        await webhook.send({ embeds: [embed] });
        await webhook.delete();

        await interaction.reply({
            content: `Setup embed posted in <#${SETUP_CHANNEL_ID}>.`,
            flags: 64,
        });
    }
};

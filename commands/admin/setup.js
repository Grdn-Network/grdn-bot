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
            .setTitle('Welcome to GRDN OPS - here\'s how to get started.')
            .setColor(0x2b2d31)
            .addFields(
                {
                    name: 'Operations are event-based.',
                    value: 'Check the pinned announcement at the top of the server for the current event, then use #ops-info for server connection details and mod info.',
                },
                {
                    name: 'When you join:',
                    value: '(Generally)\nFind a locomotive anywhere on the map.\nSet your train number using `/setcrew` in Discord, you need a "Preferred Name". Afterwards you can use the in game comms radio!\n\nJump into Ops Radio East and let the controller know where you are and what you\'re doing.\n\nGenerally you will want to snag a train, use `/setcrew` or radio and contact dispatch.\n\nIf nobody is controlling your area, you\'re in Dark Territory — grab a job and go, just watch your surroundings.',
                },
                {
                    name: 'First time using GRDNConnect?',
                    value: 'Load into the game and try to use the radio. A message will appear in #ops-chat, click the button to link your Steam and Discord accounts. You only do this once.',
                },
                {
                    name: 'Not sure what to do? Ask.',
                    value: 'Controllers expect questions and will guide you.',
                },
                {
                    name: 'MODS',
                    value: 'They can be found in #ops-info unless playing unofficial operations, they may be found in the #ops-chat',
                },
                {
                    name: 'Comms',
                    value: 'For information on Communication structure, examples, and other specifics... a read on Core Tab in the SOP is highly advised, but you should pick this up by listening for a few seconds in the operation.',
                },
                {
                    name: 'Full SOP',
                    value: '[Located here](https://www.grdnnetwork.com/grdn/sop) if you want to go deeper on anything.\n\nMost of what you need you\'ll pick up by playing. Once you earn Member after your first op, Core in the SOP is worth a read — it covers everything crew members run into every operation. The rest of the SOP is there when you want it. None of it is required to be read per-say.',
                },
            );

        await webhook.send({ embeds: [embed] });
        await webhook.delete();

        await interaction.reply({
            content: `Setup embed posted in <#${SETUP_CHANNEL_ID}>.`,
            flags: 64,
        });
    }
};

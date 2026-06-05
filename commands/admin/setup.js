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
            .setColor(0x7B2FBE)
            .setThumbnail('https://raw.githubusercontent.com/Grdn-Network/grdn-bot/main/assets/logo.png')
            .addFields(
                {
                    name: '🗓️ New here? Start with the server tabs.',
                    value: 'At the top of the server you\'ll find **Events** — that\'s where upcoming operations are listed. Click the server name to find **Channels & Roles** where you can see what\'s available and grab your roles.',
                },
                {
                    name: 'Operations are event-based.',
                    value: 'Check **Events** or the pinned announcement for the current operation. <#1477811143019069543> has server connection details and mod info when an op is running.',
                },
                {
                    name: 'When you join:',
                    value: '(Generally)\nFind a locomotive anywhere on the map.\nSet your train number using `/setcrew` in Discord — you need a "Preferred Name". Afterwards you can use the in game comms radio!\n\nJump into Ops Radio East and let the controller know where you are and what you\'re doing.\n\nGenerally you will want to snag a train, use `/setcrew` or radio and contact dispatch.\n\nIf nobody is controlling your area, you\'re in Dark Territory — grab a job and go, just watch your surroundings.',
                },
                {
                    name: 'First time using GRDNConnect?',
                    value: 'Load into the game and try to use the radio. A message will appear in <#1498270262632910868>, click the button to link your Steam and Discord accounts. You only do this once.',
                },
                {
                    name: 'Not sure what to do? Ask.',
                    value: 'Controllers expect questions and will guide you.',
                },
                {
                    name: 'MODS',
                    value: 'Found in <#1477811143019069543>. For unofficial operations they may be posted in <#1498270262632910868> instead.',
                },
                {
                    name: 'Comms',
                    value: 'For information on communication structure, examples, and other specifics — a read on the Core tab in the SOP is highly advised, but you should pick this up by listening for a few seconds in the operation.',
                },
                {
                    name: 'Full SOP',
                    value: '[Located here](https://www.grdnnetwork.com/grdn/sop) if you want to go deeper on anything.\n\n<@&1474628430149718141> Most of what you need you\'ll pick up by playing. Once you earn <@&1474628279213228204> after your first op, Core in the SOP is worth a read — it covers everything crew members run into every operation. The rest is there when you want it. None of it is required to be read per-say.',
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

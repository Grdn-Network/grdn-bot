const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, SETUP_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Post the getting-started embed in #setup'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE])) {
            return interaction.reply({
                content: '❌ Only admins can post the welcome embed.',
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
            avatar: 'https://cdn.discordapp.com/attachments/1476419181271322784/1476425743440285697/GRDN_NET_STD_WHITE_BLK_BCKG2.png?ex=69a1141f&is=699fc29f&hm=c9cac75f14ebb2013dae3c765fcaeaeede143be4ea7b0f7d3b7bf2e51b679025&',
        });

        const embed = new EmbedBuilder()
            .setTitle('Welcome to GRDN Ops — Here\'s how to get started.')
            .setColor(0x2b2d31)
            .setDescription(
`**Operations are event-based.**
Check the pinned announcement at the top of the server for the current event, then use #ops-info for server connection details and mod info.

**When you join:**
Find a locomotive anywhere on the map. Set your train number using \`/setcrew\` in Discord — you'll need a Preferred Name. After that you can use the in-game comms radio.

Jump into Ops Radio East and let the controller know where you are and what you're doing. Generally you'll want to snag a train, then use \`/setcrew\` or the radio to contact dispatch.

If nobody is controlling your area, you're in Dark Territory — grab a job and go, just watch your surroundings.

**First time using GRDNConnect?**
Load into the game and try to use the radio. A message will appear in #ops-chat — click the button to link your Steam and Discord accounts. You only do this once.

**Not sure what to do? Ask.**
Controllers expect questions and will guide you.

**Mods**
Found in #ops-info. For unofficial operations they may be posted in #ops-chat instead.

**Comms**
For communication structure, examples, and specifics — a read of the Core tab in the SOP is advised, but you'll pick most of it up by listening for a few seconds in the operation.

[Full SOP](https://www.grdnnetwork.com/grdn/sop) — go deeper on anything.

**For newcomers:** Most of what you need you'll pick up by playing. Once you earn Member after your first op, Core in the SOP is worth a read — it covers everything crew members run into every operation. The rest is there when you want it. None of it is required reading.`
            );

        await webhook.send({ embeds: [embed] });
        await webhook.delete();

        await interaction.reply({ content: `Welcome embed posted in <#${SETUP_CHANNEL_ID}>.`, flags: 64 });
    }
};

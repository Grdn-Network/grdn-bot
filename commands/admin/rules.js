const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rules')
        .setDescription('Post the GRDN Ops rules using a webhook embed'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE])) {
            return interaction.reply({
                content: '❌ Only admins can post the rules.',
                flags: 64,
            });
        }

        const channel = interaction.channel;

        // Create webhook
        const webhook = await channel.createWebhook({
            name: 'GRDN Ops',
            avatar: 'https://cdn.discordapp.com/attachments/1476419181271322784/1476425743440285697/GRDN_NET_STD_WHITE_BLK_BCKG2.png?ex=69a1141f&is=699fc29f&hm=c9cac75f14ebb2013dae3c765fcaeaeede143be4ea7b0f7d3b7bf2e51b679025&' // optional — you can add an image URL here
        });

        const embed = new EmbedBuilder()
            .setTitle('Rules')
            .setColor(0x2b2d31)
            .setDescription(
`1. **Check out <#1474625317359452415>.** That’s where the basics live (setup, roles, how we run ops).

2. **Don’t be a problem.** Treat people like humans. If you’re here to stir drama, troll, or ruin ops, this isn’t the place.

3. **No hate / harassment.** Racism, transphobia, homophobia, targeted slurs, or dogpiling someone isn’t “just a joke” here.

4. **Banter is fine — read the room.** People can joke and speak their mind, but if someone says “chill” or “stop,” drop it.

5. **Keep arguments contained.** Don’t derail the whole server. Take it to DMs or cool off.

6. **No doxxing / threats / weird stuff.** No personal info, no threats, no gore, no NSFW.

7. **Ops nights: don’t grief.** No intentional crashes, no messing with other crews’ trains/consists, and follow dispatch/shunter calls.

8. **No spam/scams.** No random ads, no sketchy links.

9. **Moderation:** We keep it chill, but we’ll warn/kick/ban if needed. Mods have final call.

10. **Have fun — don’t ruin it for others.** That’s the whole point.`
            )
            .setFooter({ text: 'Last updated' })
            .setTimestamp();

        // Send embed through webhook
        await webhook.send({
            embeds: [embed]
        });

        // Acknowledge the command
        await interaction.reply({ content: 'Rules posted.', flags: 64 });

        // Optional: delete webhook after posting
        await webhook.delete();
    }
};

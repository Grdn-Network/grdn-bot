// modals/feedback.js
// Handles feedback form submission from ex-members.
// Works in DMs — supportsDM: true.
// customId format: feedback_modal:{guildId}:{userId}

const { EmbedBuilder } = require('discord.js');
const { ADMIN_CHANNEL_ID } = require('../config');

module.exports = {
    matches: (id) => id.startsWith('feedback_modal:'),
    supportsDM: true,

    async execute(interaction) {
        const parts   = interaction.customId.split(':');
        const guildId = parts[1];
        const userId  = parts[2];

        const reason      = interaction.fields.getTextInputValue('reason').trim()      || null;
        const suggestions = interaction.fields.getTextInputValue('suggestions').trim() || null;

        // Acknowledge immediately so the modal closes
        await interaction.reply({
            content: `Thanks for taking the time — it genuinely helps. You're always welcome back.`,
            flags: 64,
        });

        // Nothing filled in — no point posting to admin channel
        if (!reason && !suggestions) return;

        try {
            const guild   = await interaction.client.guilds.fetch(guildId);
            const channel = await guild.channels.fetch(ADMIN_CHANNEL_ID);

            const embed = new EmbedBuilder()
                .setTitle('📝 Exit Feedback')
                .setColor(0xffa500)
                .addFields(
                    { name: 'User',    value: `<@${userId}> \`${interaction.user.tag}\``, inline: true },
                    { name: 'Replied', value: `<t:${Math.floor(Date.now() / 1000)}:R>`,  inline: true },
                )
                .setTimestamp();

            if (reason)      embed.addFields({ name: 'Why they left',  value: reason });
            if (suggestions) embed.addFields({ name: 'Suggestions',    value: suggestions });

            await channel.send({ embeds: [embed] });
        } catch (err) {
            console.error('[feedback modal] Failed to post to admin channel:', err.message);
        }
    },
};

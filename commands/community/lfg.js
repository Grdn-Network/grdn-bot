// commands/community/lfg.js
// The only sanctioned way to ping @lfg. The @lfg role is locked in Discord so
// no normal user can mention it directly; the bot fires the ping here, gated by
// a per-user cooldown and a channel restriction. Users type their own post,
// then run /lfg to alert people. See grdn-bot issue #3.

const { SlashCommandBuilder } = require('discord.js');
const { LFG_ROLE, LFG_CHANNEL_ID, LFG_COOLDOWN_MS } = require('../../config');

// Per-user cooldown. In-memory is fine: it is a soft anti-spam limit, and a
// restart at worst lets someone re-ping once.
const cooldowns = new Map(); // userId -> last-used timestamp (ms)

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lfg')
        .setDescription('Ping @lfg to let people know you are looking for group.'),

    async execute(interaction) {
        // Must be used in the LFG channel
        if (interaction.channelId !== LFG_CHANNEL_ID) {
            return interaction.reply({
                content: `Please use /lfg in <#${LFG_CHANNEL_ID}>.`,
                flags: 64,
            });
        }

        // Cooldown
        const now = Date.now();
        const last = cooldowns.get(interaction.user.id) ?? 0;
        const remaining = LFG_COOLDOWN_MS - (now - last);
        if (remaining > 0) {
            const mins = Math.ceil(remaining / 60000);
            return interaction.reply({
                content: `You can use /lfg again in ${mins} min.`,
                flags: 64,
            });
        }

        // Fire the ping on their behalf. allowedMentions restricts it to the
        // @lfg role only, so no @everyone/@here can be smuggled in.
        const name = interaction.member?.displayName ?? interaction.user.username;
        await interaction.channel.send({
            content: `<@&${LFG_ROLE}> **${name}** is looking for group.`,
            allowedMentions: { roles: [LFG_ROLE], users: [] },
        });

        cooldowns.set(interaction.user.id, now);

        return interaction.reply({
            content: 'Your LFG ping has been posted.',
            flags: 64,
        });
    },
};

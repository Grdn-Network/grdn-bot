// commands/dispatch/operembed.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/db');
const { buildDispatchEmbed, buildDispatchComponents } = require('../../utils/dispatchEmbed');
const { ADMIN_ROLE, HOST_ROLE, DISPATCH_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('operembed')
        .setDescription('Post or restore the Operations embed.'),

    async execute(interaction) {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE) && !interaction.member.roles.cache.has(HOST_ROLE)) {
            return interaction.reply({ content: '❌ Only admins and hosts can post the embed.', flags: 64 });
        }

        const channel = interaction.guild.channels.cache.get(DISPATCH_CHANNEL_ID);
        if (!channel) {
            return interaction.reply({ content: '❌ Dispatch channel not found.', flags: 64 });
        }

        // If an embed already exists and is still alive, refuse to post a duplicate
        const existing = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
        if (existing?.message_id) {
            const existingMsg = await channel.messages.fetch(existing.message_id).catch(() => null);
            if (existingMsg) {
                return interaction.reply({
                    content: '❌ An Operations embed already exists. Use `/editembed` to update a field.',
                    flags: 64
                });
            }
        }

        const msg = await channel.send({
            embeds: [buildDispatchEmbed()],
            components: buildDispatchComponents()
        });

        db.prepare(`DELETE FROM dispatch_embed`).run();
        db.prepare(`INSERT INTO dispatch_embed (id, message_id) VALUES (1, ?)`).run(msg.id);

        return interaction.reply({ content: '✅ Operations embed posted.', flags: 64 });
    }
};

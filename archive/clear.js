// commands/admin/clear.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/db');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, DISPATCH_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clears all messages in the dispatch channel except pinned and the permanent embed.'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, ADMIN_ROLE)) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
        }

        const channel = interaction.guild.channels.cache.get(DISPATCH_CHANNEL_ID);
        if (!channel) {
            return interaction.reply({ content: '❌ Channel not found.', flags: 64 });
        }

        const row = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
        const permanentId = row ? row.message_id : null;

        const messages = await channel.messages.fetch({ limit: 100 });
        const toDelete = messages.filter(msg => !msg.pinned && msg.id !== permanentId);

        if (toDelete.size === 0) {
            return interaction.reply({ content: 'Nothing to delete.', flags: 64 });
        }

        await channel.bulkDelete(toDelete, true);

        return interaction.reply({ content: `🧹 Cleared ${toDelete.size} messages.`, flags: 64 });
    }
};
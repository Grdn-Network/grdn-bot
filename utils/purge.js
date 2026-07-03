// utils/purge.js
// Shared "purge + ban" routine used by both /purgeuser ban and the
// scam-review "Purge User" button, so there's a single source of truth.

const storage = require('../database/storage');

/**
 * Delete a user's recent messages across all text channels, ban them, and
 * remove their crew registration.
 * @param {import('discord.js').Guild} guild
 * @param {string} targetId
 * @param {string} reason
 * @returns {Promise<{ deletedCount: number }>}
 */
async function purgeAndBanUser(guild, targetId, reason) {
    let deletedCount = 0;

    for (const [, channel] of guild.channels.cache) {
        if (!channel.isTextBased?.()) continue;
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const targets = messages.filter(msg => msg.author?.id === targetId);
            for (const msg of targets.values()) {
                await msg.delete().catch(() => {});
                deletedCount++;
            }
        } catch {
            // Skip channels the bot cannot access
        }
    }

    await guild.members.ban(targetId, { reason }).catch(() => {});
    storage.removeCrew(targetId);

    return { deletedCount };
}

module.exports = { purgeAndBanUser };

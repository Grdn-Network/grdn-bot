// utils/purge.js
// Purge + ban routine used by the scam-review Purge button (via its reason
// modal). Records forensics before deleting each message so the purge is
// reviewable later with /purged.

const storage = require('../database/storage');
const { startPurge, capturePurgedMessage, finishPurge } = require('./purgeForensics');

/**
 * @returns {Promise<{ deletedCount: number, channelsAffected: number, purgeId: number }>}
 */
async function purgeAndBanUser({ guild, targetId, targetTag, moderator, reason }) {
    const purgeId = await startPurge({
        guild,
        target: { id: targetId, tag: targetTag },
        moderator,
        reason,
    });

    let deletedCount = 0;
    const channels = new Set();

    for (const [, channel] of guild.channels.cache) {
        if (!channel.isTextBased?.()) continue;
        try {
            const messages = await channel.messages.fetch({ limit: 100 });
            const targets = messages.filter(msg => msg.author?.id === targetId);
            for (const msg of targets.values()) {
                await capturePurgedMessage(purgeId, msg);
                await msg.delete().catch(() => {});
                deletedCount++;
                channels.add(channel.id);
            }
        } catch {
            // Skip channels the bot cannot access
        }
    }

    await guild.members.ban(targetId, { reason }).catch(() => {});
    storage.removeCrew(targetId);

    finishPurge(purgeId, { deletedCount, channelsAffected: channels.size });
    return { deletedCount, channelsAffected: channels.size, purgeId };
}

module.exports = { purgeAndBanUser };

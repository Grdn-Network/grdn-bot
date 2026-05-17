// logging/logHelper.js
// Central helper for all log embeds.
// Swallows send errors so a rate-limit or permission issue
// never becomes an unhandledRejection that kills the bot.

/**
 * Send an embed to the log channel. Fire-and-forget, never throws.
 * @param {import('discord.js').Client} client
 * @param {string} channelId
 * @param {import('discord.js').EmbedBuilder} embed
 */
function sendLog(client, channelId, embed) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;
    channel.send({ embeds: [embed] }).catch(err =>
        console.error('[Logging] Failed to send embed:', err.message)
    );
}

/**
 * Truncate a string to fit inside a Discord embed field (max 1024 chars).
 * @param {string|null|undefined} text
 * @param {number} [max=1024]
 */
function truncate(text, max = 1024) {
    const str = text || '*empty*';
    return str.length > max ? str.slice(0, max - 3) + '...' : str;
}

module.exports = { sendLog, truncate };

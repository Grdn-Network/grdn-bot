// logging/purgeActions.js
const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');

module.exports = (client) => {
    client.on('purgeUser', (data) => {
        const { moderator, target, deletedCount } = data;

        const embed = new EmbedBuilder()
            .setTitle("🧹 User Purged & Banned")
            .setColor(0xff0000)
            .addFields(
                { name: "Moderator", value: `${moderator}` },
                { name: "Target User", value: `${target}` },
                { name: "Messages Deleted", value: `${deletedCount}` }
            )
            .setTimestamp();

        const logChannel = client.channels.cache.get(config.logChannel);
        if (logChannel) logChannel.send({ embeds: [embed] });
    });
};
// logging/purgeAction.js
const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

module.exports = (client) => {
    client.on('purgeUser', (data) => {
        const { moderator, target, deletedCount, channelsAffected, purgeId } = data;

        const embed = new EmbedBuilder()
            .setTitle('🧹 User Purged & Banned')
            .setColor(0xff0000)
            .addFields(
                { name: 'Moderator', value: `${moderator} (${moderator.tag})`, inline: true },
                { name: 'Target', value: `${target} (${target.tag})`, inline: true },
                { name: 'Messages Deleted', value: `${deletedCount}`, inline: true }
            );

        if (channelsAffected !== undefined) {
            embed.addFields({ name: 'Channels Affected', value: `${channelsAffected}`, inline: true });
        }
        if (purgeId !== undefined) {
            embed.addFields({ name: 'Review', value: `\`/purged id:${purgeId}\``, inline: false });
        }

        embed.setTimestamp();
        sendLog(client, config.logChannel, embed);
    });
};

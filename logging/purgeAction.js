// logging/purgeAction.js
const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

module.exports = (client) => {
    client.on('purgeUser', (data) => {
        const { moderator, target, deletedCount } = data;

        const embed = new EmbedBuilder()
            .setTitle('🧹 User Purged & Banned')
            .setColor(0xff0000)
            .addFields(
                { name: 'Moderator', value: `${moderator} (${moderator.tag})`, inline: true },
                { name: 'Target', value: `${target} (${target.tag})`, inline: true },
                { name: 'Messages Deleted', value: `${deletedCount}`, inline: true }
            )
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });
};

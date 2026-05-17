const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

module.exports = (client) => {
    client.on('webhookUpdate', channel => {
        const embed = new EmbedBuilder()
            .setTitle('🪝 Webhook Changed')
            .setColor(0x00aaff)
            .addFields({ name: 'Channel', value: `${channel} (${channel.name})` })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });
};

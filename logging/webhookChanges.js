const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');

module.exports = (client) => {
    client.on('webhookUpdate', channel => {
        const embed = new EmbedBuilder()
            .setTitle("🪝 Webhook Updated")
            .setColor(0x00aaff)
            .addFields({ name: "Channel", value: `${channel}` })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });
};
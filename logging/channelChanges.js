const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');

module.exports = (client) => {
    client.on('channelCreate', channel => {
        const embed = new EmbedBuilder()
            .setTitle("📁 Channel Created")
            .setColor(0x55ff55)
            .addFields({ name: "Channel", value: `${channel}` })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });

    client.on('channelDelete', channel => {
        const embed = new EmbedBuilder()
            .setTitle("🗑️ Channel Deleted")
            .setColor(0xff5555)
            .addFields({ name: "Channel", value: channel.name })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });
};
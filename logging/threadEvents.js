const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');

module.exports = (client) => {
    client.on('threadCreate', thread => {
        const embed = new EmbedBuilder()
            .setTitle("🧵 Thread Created")
            .setColor(0x55ff55)
            .addFields({ name: "Thread", value: `${thread}` })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });

    client.on('threadDelete', thread => {
        const embed = new EmbedBuilder()
            .setTitle("🧵 Thread Deleted")
            .setColor(0xff5555)
            .addFields({ name: "Thread", value: thread.name })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });
};
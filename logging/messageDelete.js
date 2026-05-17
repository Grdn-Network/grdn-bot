const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');

module.exports = (client) => {
    client.on('messageDelete', message => {
        if (!message.guild || !message.author) return;

        const embed = new EmbedBuilder()
            .setTitle("🗑️ Message Deleted")
            .setColor(0xff5555)
            .addFields(
                { name: "Author", value: `${message.author}` },
                { name: "Channel", value: `${message.channel}` },
                { name: "Content", value: message.content || "*No content*" }
            )
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });
};
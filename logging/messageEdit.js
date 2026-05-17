const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');

module.exports = (client) => {
    client.on('messageUpdate', (oldMsg, newMsg) => {
        if (!newMsg.guild || !newMsg.author) return;
        if (oldMsg.content === newMsg.content) return;

        const embed = new EmbedBuilder()
            .setTitle("✏️ Message Edited")
            .setColor(0xffcc00)
            .addFields(
                { name: "Author", value: `${newMsg.author}` },
                { name: "Channel", value: `${newMsg.channel}` },
                { name: "Before", value: oldMsg.content || "*No content*" },
                { name: "After", value: newMsg.content || "*No content*" }
            )
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });
};
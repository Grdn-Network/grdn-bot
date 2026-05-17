const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog, truncate } = require('./logHelper');

module.exports = (client) => {
    client.on('messageUpdate', (oldMsg, newMsg) => {
        if (!newMsg.guild || !newMsg.author || newMsg.author.bot) return;
        if (oldMsg.content === newMsg.content) return;

        const embed = new EmbedBuilder()
            .setTitle('✏️ Message Edited')
            .setColor(0xffcc00)
            .addFields(
                { name: 'Author', value: `${newMsg.author} (${newMsg.author.tag})`, inline: true },
                { name: 'Channel', value: `${newMsg.channel}`, inline: true },
                { name: 'Before', value: truncate(oldMsg.content) },
                { name: 'After', value: truncate(newMsg.content) }
            )
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });
};

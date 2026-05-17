const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog, truncate } = require('./logHelper');

module.exports = (client) => {
    client.on('messageDelete', message => {
        if (!message.guild || !message.author || message.author.bot) return;

        const embed = new EmbedBuilder()
            .setTitle('🗑️ Message Deleted')
            .setColor(0xff5555)
            .addFields(
                { name: 'Author', value: `${message.author} (${message.author.tag})`, inline: true },
                { name: 'Channel', value: `${message.channel}`, inline: true },
                { name: 'Content', value: truncate(message.content) }
            )
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });
};

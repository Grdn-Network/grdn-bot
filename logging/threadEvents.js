const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

module.exports = (client) => {
    client.on('threadCreate', thread => {
        const embed = new EmbedBuilder()
            .setTitle('🧵 Thread Created')
            .setColor(0x55ff55)
            .addFields(
                { name: 'Thread', value: `${thread} (${thread.name})`, inline: true },
                { name: 'Parent', value: `${thread.parent ?? 'Unknown'}`, inline: true }
            )
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });

    client.on('threadDelete', thread => {
        const embed = new EmbedBuilder()
            .setTitle('🧵 Thread Deleted')
            .setColor(0xff5555)
            .addFields({ name: 'Thread', value: thread.name })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });
};

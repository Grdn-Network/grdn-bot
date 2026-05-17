const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

module.exports = (client) => {
    client.on('channelCreate', channel => {
        const embed = new EmbedBuilder()
            .setTitle('📁 Channel Created')
            .setColor(0x55ff55)
            .addFields({ name: 'Channel', value: `${channel} (${channel.name})` })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });

    client.on('channelDelete', channel => {
        const embed = new EmbedBuilder()
            .setTitle('🗑️ Channel Deleted')
            .setColor(0xff5555)
            .addFields({ name: 'Channel', value: channel.name })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });

    client.on('channelUpdate', (oldChannel, newChannel) => {
        const changes = [];
        if (oldChannel.name !== newChannel.name)
            changes.push(`**Name:** ${oldChannel.name} → ${newChannel.name}`);
        if (oldChannel.topic !== newChannel.topic)
            changes.push(`**Topic changed**`);
        if (oldChannel.nsfw !== newChannel.nsfw)
            changes.push(`**NSFW:** ${oldChannel.nsfw} → ${newChannel.nsfw}`);

        if (changes.length === 0) return;

        const embed = new EmbedBuilder()
            .setTitle('🔧 Channel Updated')
            .setColor(0x00aaff)
            .addFields(
                { name: 'Channel', value: `${newChannel}`, inline: true },
                { name: 'Changes', value: changes.join('\n') }
            )
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });
};

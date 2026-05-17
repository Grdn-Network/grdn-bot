const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

module.exports = (client) => {
    client.on('userRegistered', (data) => {
        const { user, type, trainNumber, preferredName } = data;

        const embed = new EmbedBuilder()
            .setTitle('📝 Crew Registered / Updated')
            .setColor(0x00ff99)
            .addFields(
                { name: 'User', value: `${user}`, inline: true },
                { name: 'Type', value: type, inline: true },
                { name: 'Train #', value: trainNumber || '—', inline: true },
                { name: 'Preferred Name', value: preferredName, inline: true }
            )
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });
};

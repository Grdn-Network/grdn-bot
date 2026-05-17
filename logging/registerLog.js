const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');

module.exports = (client) => {
    client.on('userRegistered', (data) => {
        const { user, type, trainNumber, preferredName } = data;

        const embed = new EmbedBuilder()
            .setTitle("📝 New Registration")
            .setColor(0x00ff99)
            .addFields(
                { name: "User", value: `${user}` },
                { name: "Type", value: type },
                { name: "Train Number", value: trainNumber },
                { name: "Preferred Name", value: preferredName }
            )
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });
};
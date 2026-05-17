const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');

module.exports = (client) => {
    client.on('guildUpdate', (oldGuild, newGuild) => {
        const embed = new EmbedBuilder()
            .setTitle("⚙️ Server Settings Updated")
            .setColor(0x00aaff)
            .addFields(
                { name: "Old Name", value: oldGuild.name },
                { name: "New Name", value: newGuild.name }
            )
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });
};
const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');

module.exports = (client) => {
    client.on('roleCreate', role => {
        const embed = new EmbedBuilder()
            .setTitle("➕ Role Created")
            .setColor(0x55ff55)
            .addFields({ name: "Role", value: role.name })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });

    client.on('roleDelete', role => {
        const embed = new EmbedBuilder()
            .setTitle("➖ Role Deleted")
            .setColor(0xff5555)
            .addFields({ name: "Role", value: role.name })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });

    client.on('roleUpdate', (oldRole, newRole) => {
        const embed = new EmbedBuilder()
            .setTitle("🔧 Role Updated")
            .setColor(0x00aaff)
            .addFields(
                { name: "Old Name", value: oldRole.name },
                { name: "New Name", value: newRole.name }
            )
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });
};
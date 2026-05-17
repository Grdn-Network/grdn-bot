const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');

module.exports = (client) => {
    client.on('emojiCreate', emoji => {
        const embed = new EmbedBuilder()
            .setTitle("😃 Emoji Created")
            .setColor(0x55ff55)
            .addFields({ name: "Emoji", value: `${emoji}` })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });

    client.on('emojiDelete', emoji => {
        const embed = new EmbedBuilder()
            .setTitle("❌ Emoji Deleted")
            .setColor(0xff5555)
            .addFields({ name: "Emoji", value: emoji.name })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });

    client.on('stickerCreate', sticker => {
        const embed = new EmbedBuilder()
            .setTitle("🏷️ Sticker Created")
            .setColor(0x55ff55)
            .addFields({ name: "Sticker", value: sticker.name })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });

    client.on('stickerDelete', sticker => {
        const embed = new EmbedBuilder()
            .setTitle("❌ Sticker Deleted")
            .setColor(0xff5555)
            .addFields({ name: "Sticker", value: sticker.name })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });
};
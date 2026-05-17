const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

module.exports = (client) => {
    client.on('emojiCreate', emoji => {
        const embed = new EmbedBuilder()
            .setTitle('😃 Emoji Created')
            .setColor(0x55ff55)
            .addFields({ name: 'Emoji', value: `${emoji} \`:${emoji.name}:\`` })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });

    client.on('emojiDelete', emoji => {
        const embed = new EmbedBuilder()
            .setTitle('❌ Emoji Deleted')
            .setColor(0xff5555)
            .addFields({ name: 'Emoji', value: `:${emoji.name}:` })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });

    client.on('stickerCreate', sticker => {
        const embed = new EmbedBuilder()
            .setTitle('🏷️ Sticker Created')
            .setColor(0x55ff55)
            .addFields({ name: 'Sticker', value: sticker.name })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });

    client.on('stickerDelete', sticker => {
        const embed = new EmbedBuilder()
            .setTitle('❌ Sticker Deleted')
            .setColor(0xff5555)
            .addFields({ name: 'Sticker', value: sticker.name })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });
};

const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

module.exports = (client) => {
    client.on('guildUpdate', (oldGuild, newGuild) => {
        const changes = [];
        if (oldGuild.name !== newGuild.name)
            changes.push(`**Name:** ${oldGuild.name} → ${newGuild.name}`);
        if (oldGuild.description !== newGuild.description)
            changes.push('**Description changed**');
        if (oldGuild.verificationLevel !== newGuild.verificationLevel)
            changes.push(`**Verification level:** ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
        if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter)
            changes.push(`**Explicit content filter changed**`);

        if (changes.length === 0) return;

        const embed = new EmbedBuilder()
            .setTitle('⚙️ Server Updated')
            .setColor(0x00aaff)
            .addFields({ name: 'Changes', value: changes.join('\n') })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });
};

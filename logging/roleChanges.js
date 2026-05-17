const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

module.exports = (client) => {
    client.on('roleCreate', role => {
        const embed = new EmbedBuilder()
            .setTitle('➕ Role Created')
            .setColor(0x55ff55)
            .addFields({ name: 'Role', value: `${role} (${role.name})` })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });

    client.on('roleDelete', role => {
        const embed = new EmbedBuilder()
            .setTitle('➖ Role Deleted')
            .setColor(0xff5555)
            .addFields({ name: 'Role', value: role.name })
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });

    client.on('roleUpdate', (oldRole, newRole) => {
        const changes = [];
        if (oldRole.name !== newRole.name)
            changes.push(`**Name:** ${oldRole.name} → ${newRole.name}`);
        if (oldRole.color !== newRole.color)
            changes.push(`**Color:** #${oldRole.color.toString(16).padStart(6, '0')} → #${newRole.color.toString(16).padStart(6, '0')}`);
        if (oldRole.hoist !== newRole.hoist)
            changes.push(`**Hoisted:** ${oldRole.hoist} → ${newRole.hoist}`);
        if (oldRole.mentionable !== newRole.mentionable)
            changes.push(`**Mentionable:** ${oldRole.mentionable} → ${newRole.mentionable}`);
        if (oldRole.permissions.bitfield !== newRole.permissions.bitfield)
            changes.push('**Permissions changed**');

        if (changes.length === 0) return;

        const embed = new EmbedBuilder()
            .setTitle('🔧 Role Updated')
            .setColor(0x00aaff)
            .addFields(
                { name: 'Role', value: `${newRole} (${newRole.name})`, inline: true },
                { name: 'Changes', value: changes.join('\n') }
            )
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });
};

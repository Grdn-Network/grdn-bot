// logging/voiceActivity.js
// Tracks voice channel joins, leaves, moves, and server mute/deafen actions.
// Self-mute/deafen are intentionally excluded to reduce noise.
const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');

module.exports = (client) => {
    client.on('voiceStateUpdate', (oldState, newState) => {
        try {
            const user = newState.member?.user ?? oldState.member?.user;
            if (!user || user.bot) return;

            const oldChannel = oldState.channel;
            const newChannel = newState.channel;

            // Joined a voice channel
            if (!oldChannel && newChannel) {
                const embed = new EmbedBuilder()
                    .setTitle('🔊 Joined Voice')
                    .setColor(0x55ff55)
                    .addFields(
                        { name: 'User', value: `${user} (${user.tag})`, inline: true },
                        { name: 'Channel', value: newChannel.name, inline: true }
                    )
                    .setTimestamp();
                sendLog(client, config.logChannel, embed);
                return;
            }

            // Left a voice channel
            if (oldChannel && !newChannel) {
                const embed = new EmbedBuilder()
                    .setTitle('🔇 Left Voice')
                    .setColor(0xff5555)
                    .addFields(
                        { name: 'User', value: `${user} (${user.tag})`, inline: true },
                        { name: 'Channel', value: oldChannel.name, inline: true }
                    )
                    .setTimestamp();
                sendLog(client, config.logChannel, embed);
                return;
            }

            // Moved between channels
            if (oldChannel && newChannel && oldChannel.id !== newChannel.id) {
                const embed = new EmbedBuilder()
                    .setTitle('↔️ Moved Voice Channel')
                    .setColor(0xffaa00)
                    .addFields(
                        { name: 'User', value: `${user} (${user.tag})`, inline: true },
                        { name: 'From', value: oldChannel.name, inline: true },
                        { name: 'To', value: newChannel.name, inline: true }
                    )
                    .setTimestamp();
                sendLog(client, config.logChannel, embed);
                return;
            }

            // Server mute/unmute (moderator action)
            if (oldState.serverMute !== newState.serverMute) {
                const embed = new EmbedBuilder()
                    .setTitle(newState.serverMute ? '🔇 Server Muted' : '🔊 Server Unmuted')
                    .setColor(newState.serverMute ? 0xff5555 : 0x55ff55)
                    .addFields(
                        { name: 'User', value: `${user} (${user.tag})`, inline: true },
                        { name: 'Channel', value: newChannel?.name ?? oldChannel?.name ?? 'Unknown', inline: true }
                    )
                    .setTimestamp();
                sendLog(client, config.logChannel, embed);
                return;
            }

            // Server deafen/undeafen (moderator action)
            if (oldState.serverDeaf !== newState.serverDeaf) {
                const embed = new EmbedBuilder()
                    .setTitle(newState.serverDeaf ? '🔕 Server Deafened' : '🔔 Server Undeafened')
                    .setColor(newState.serverDeaf ? 0xff5555 : 0x55ff55)
                    .addFields(
                        { name: 'User', value: `${user} (${user.tag})`, inline: true },
                        { name: 'Channel', value: newChannel?.name ?? oldChannel?.name ?? 'Unknown', inline: true }
                    )
                    .setTimestamp();
                sendLog(client, config.logChannel, embed);
            }
        } catch (err) {
            console.error('[voiceActivity] Error:', err);
        }
    });
};

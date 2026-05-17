const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const { sendLog } = require('./logHelper');
const storage = require('../storage');
const { updateTrainBoard } = require('../trainBoard');
const { TRAIN_BOARD_CHANNEL_ID } = require('../config');

module.exports = (client) => {
    client.on('guildMemberAdd', member => {
        const embed = new EmbedBuilder()
            .setTitle('👋 Member Joined')
            .setColor(0x55ff55)
            .addFields(
                { name: 'User', value: `${member.user} (${member.user.tag})`, inline: true },
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true }
            )
            .setTimestamp();

        sendLog(client, config.logChannel, embed);
    });

    client.on('guildMemberRemove', async member => {
        const embed = new EmbedBuilder()
            .setTitle('🚪 Member Left')
            .setColor(0xff5555)
            .addFields(
                { name: 'User', value: `${member.user} (${member.user.tag})`, inline: true },
                { name: 'Joined', value: member.joinedTimestamp
                    ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
                    : 'Unknown', inline: true }
            )
            .setTimestamp();

        sendLog(client, config.logChannel, embed);

        // Clean up crew data so they don't linger on the train board
        try {
            const crew = storage.getCrewRaw(member.id);
            if (!crew) return;

            if (crew.train_number) {
                storage.deleteAssignment(member.guild.id, crew.train_number);
            }
            storage.deleteCrew(member.id);

            await updateTrainBoard(client, member.guild.id, TRAIN_BOARD_CHANNEL_ID)
                .catch(err => console.error('[TrainBoard] Update failed on member leave:', err));
        } catch (err) {
            console.error('[memberChanges] Error cleaning up crew on leave:', err);
        }
    });

    client.on('guildMemberUpdate', (oldMember, newMember) => {
        try {
            const oldRoles = oldMember.roles.cache.map(r => r.id);
            const newRoles = newMember.roles.cache.map(r => r.id);

            const added = newRoles.filter(r => !oldRoles.includes(r));
            const removed = oldRoles.filter(r => !newRoles.includes(r));
            const nickChanged = oldMember.nickname !== newMember.nickname;

            if (added.length === 0 && removed.length === 0 && !nickChanged) return;

            const fields = [
                { name: 'User', value: `${newMember.user} (${newMember.user.tag})`, inline: true }
            ];

            if (nickChanged) {
                fields.push({
                    name: 'Nickname',
                    value: `${oldMember.nickname ?? '*none*'} → ${newMember.nickname ?? '*none*'}`,
                    inline: false
                });
            }

            if (added.length > 0) {
                fields.push({ name: 'Roles Added', value: added.map(r => `<@&${r}>`).join(', '), inline: false });
            }
            if (removed.length > 0) {
                fields.push({ name: 'Roles Removed', value: removed.map(r => `<@&${r}>`).join(', '), inline: false });
            }

            const embed = new EmbedBuilder()
                .setTitle('📋 Member Updated')
                .setColor(0x00aaff)
                .addFields(...fields)
                .setTimestamp();

            sendLog(client, config.logChannel, embed);
        } catch (err) {
            console.error('[memberChanges] guildMemberUpdate error:', err);
        }
    });
};

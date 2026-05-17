const { EmbedBuilder } = require('discord.js');
const config = require('../config/logging.json');
const storage = require('../storage');
const { updateTrainBoard } = require('../trainBoard');
const { TRAIN_BOARD_CHANNEL_ID } = require('../config');

module.exports = (client) => {
    client.on('guildMemberAdd', member => {
        const embed = new EmbedBuilder()
            .setTitle('👋 Member Joined')
            .setColor(0x55ff55)
            .addFields({ name: 'User', value: `${member.user}` })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });

    client.on('guildMemberRemove', async member => {
        const embed = new EmbedBuilder()
            .setTitle('🚪 Member Left')
            .setColor(0xff5555)
            .addFields({ name: 'User', value: `${member.user}` })
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });

        // Clean up crew data so they don't linger on the train board
        const crew = storage.getCrewRaw(member.id);
        if (!crew) return;

        if (crew.train_number) {
            storage.deleteAssignment(member.guild.id, crew.train_number);
        }
        storage.deleteCrew(member.id);

        await updateTrainBoard(client, member.guild.id, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] Update failed on member leave:', err));
    });

    client.on('guildMemberUpdate', (oldMember, newMember) => {
        const oldRoles = oldMember.roles.cache.map(r => r.id);
        const newRoles = newMember.roles.cache.map(r => r.id);

        const added = newRoles.filter(r => !oldRoles.includes(r));
        const removed = oldRoles.filter(r => !newRoles.includes(r));

        if (added.length === 0 && removed.length === 0) return;

        const embed = new EmbedBuilder()
            .setTitle('🎭 Member Role Updated')
            .setColor(0x00aaff)
            .addFields(
                { name: 'User', value: `${newMember.user}` },
                { name: 'Added', value: added.map(r => `<@&${r}>`).join(', ') || 'None' },
                { name: 'Removed', value: removed.map(r => `<@&${r}>`).join(', ') || 'None' }
            )
            .setTimestamp();

        client.channels.cache.get(config.logChannel)?.send({ embeds: [embed] });
    });
};

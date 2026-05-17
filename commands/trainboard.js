// commands/trainboard.js

const { SlashCommandBuilder } = require('discord.js');
const storage = require('../storage');
const { updateTrainBoard } = require('../trainBoard');
const { TRAIN_BOARD_CHANNEL_ID, STAFF_ROLES } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trainboard')
        .setDescription('Force-send a NEW Train Board message.'),

    async execute(interaction) {
        const hasPermission = STAFF_ROLES.some(role => interaction.member.roles.cache.has(role));
        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const guildId = interaction.guild.id;

        await interaction.reply({
            content: '📨 Sending new Train Board…',
            flags: 64
        });

        storage.setTrainBoardMessageId(guildId, null);

        await updateTrainBoard(interaction.client, guildId, TRAIN_BOARD_CHANNEL_ID);

        await interaction.editReply('✅ New Train Board sent.');
    }
};

// commands/ops/unassign.js
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('../../database/storage');
const { updateTrainBoard } = require('../../utils/trainBoard');
const { TRAIN_BOARD_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unassign')
        .setDescription('Remove the assignment for a specific train number.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(opt =>
            opt.setName('train').setDescription('Train number to unassign').setRequired(true)
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const train = interaction.options.getString('train');

        const existing = storage.getAssignmentByTrain(guildId, train);
        if (!existing) {
            return interaction.reply({
                content: `❌ Train **${train}** has no assignment to remove.`,
                flags: 64
            });
        }

        storage.setAssignment(guildId, train, {
            dep: '—', des: '—', trk: '—', job: '—', rmk: '—',
            timestamp: Date.now()
        });

        await interaction.reply({
            content: `🗑️ Assignment for train **${train}** has been cleared.`,
            flags: 64
        });

        await updateTrainBoard(interaction.client, guildId, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] Update failed:', err));
    }
};
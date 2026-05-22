// commands/ops/unassign.js
// /unassign train: — clear the assignment for a train. Staff only.

const { SlashCommandBuilder } = require('discord.js');
const storage = require('../../database/storage');
const { hasAnyRole } = require('../../utils/permissions');
const { updateTrainBoard } = require('../../utils/trainBoard');
const { STAFF_ROLES, TRAIN_BOARD_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unassign')
        .setDescription('Clear the assignment for a train. (Staff only)')
        .addStringOption(opt =>
            opt.setName('train')
               .setDescription('Train number to clear')
               .setRequired(true)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
        }

        const guildId  = interaction.guild.id;
        const train    = interaction.options.getString('train');
        const existing = storage.getAssignmentByTrain(guildId, train);

        if (!existing)
            return interaction.reply({ content: `❌ Train **${train}** has no assignment to remove.`, flags: 64 });

        storage.setAssignment(guildId, train, {
            dep: '—', des: '—', trk: '—', job: '—', rmk: '—', timestamp: Date.now(),
        });

        await interaction.reply({ content: `🗑️ Assignment for train **${train}** cleared.`, flags: 64 });

        await updateTrainBoard(interaction.client, guildId, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] unassign update failed:', err));
    },
};

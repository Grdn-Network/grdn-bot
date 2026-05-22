// commands/ops/trainboard.js
// Deprecated alias for /session action:board
// Still functional — posts a fresh Train Board — but nudges users to the new command.

const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const storage = require('../../database/storage');
const { updateTrainBoard } = require('../../utils/trainBoard');
const { hasAnyRole } = require('../../utils/permissions');
const { STAFF_ROLES, TRAIN_BOARD_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trainboard')
        .setDescription('→ Use /session action:board instead.')
        .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers), // hides from regular members

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
            return interaction.reply({ content: '❌ You do not have permission to use this command.', flags: 64 });
        }

        await interaction.reply({
            content: '📨 Sending new Train Board…\n\n> 💡 This command has moved — use `/session` → `action: Board` going forward.',
            flags: 64,
        });

        storage.setTrainBoardMessageId(interaction.guild.id, null);

        await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] trainboard alias refresh failed:', err));

        return interaction.editReply({
            content: '✅ New Train Board sent.\n\n> 💡 This command has moved — use `/session` → `action: Board` going forward.',
        });
    },
};

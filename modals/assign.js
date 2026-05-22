// modals/assign.js
// Handles the modal submitted by /assign.
// customId format: assign_modal:{guildId}:{train}

const storage = require('../database/storage');
const { updateTrainBoard } = require('../utils/trainBoard');
const { TRAIN_BOARD_CHANNEL_ID } = require('../config');

module.exports = {
    // Dynamic customId — use matches() instead of a fixed customId string
    matches: (id) => id.startsWith('assign_modal:'),

    async execute(interaction) {
        const parts  = interaction.customId.split(':');
        const guildId = parts[1];
        const train   = parts.slice(2).join(':'); // train numbers won't have colons, but safe either way

        const dep = interaction.fields.getTextInputValue('dep').trim() || '—';
        const des = interaction.fields.getTextInputValue('des').trim() || '—';
        const trk = interaction.fields.getTextInputValue('trk').trim() || '—';
        const job = interaction.fields.getTextInputValue('job').trim() || '—';
        const rmk = interaction.fields.getTextInputValue('rmk').trim() || '—';

        storage.setAssignment(guildId, train, { dep, des, trk, job, rmk, timestamp: Date.now() });

        await interaction.reply({
            content:
                `✅ Assignment saved for train **${train}**:\n` +
                `DEP : ${dep}\nDES : ${des}\nTRK : ${trk}\nJOB : ${job}\nRMK : ${rmk}`,
            flags: 64,
        });

        await updateTrainBoard(interaction.client, guildId, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] assign modal update failed:', err));
    },
};

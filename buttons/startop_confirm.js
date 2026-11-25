// buttons/startop_confirm.js
// Confirms the Start Operation button and opens an official ops session.
// Unofficial and stress test were retired in #39.

const { handleStart, canStartSession } = require('../commands/ops/session');

module.exports = {
    matches: (id) => id.startsWith('startop:'),

    async execute(interaction) {
        if (!canStartSession(interaction.member)) {
            return interaction.reply({
                content: '❌ Only admins and hosts can start an ops session.',
                flags: 64,
            });
        }

        return handleStart(interaction);
    },
};

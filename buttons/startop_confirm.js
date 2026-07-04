// buttons/startop_confirm.js
// Handles the session-type choice buttons shown by startop.js.
// Custom IDs: startop:official | startop:unofficial | startop:stress_test
// Unofficial is open to any member; official and stress test need host/dispatch.

const { handleStart, canStartSession } = require('../commands/ops/session');

module.exports = {
    matches: (id) => id.startsWith('startop:'),

    async execute(interaction) {
        const sessionType = interaction.customId.split(':')[1]; // official | unofficial | stress_test

        if (!canStartSession(interaction.member, sessionType)) {
            const label = { official: 'official', stress_test: 'stress test', unofficial: 'unofficial' }[sessionType] ?? sessionType;
            return interaction.reply({
                content: `❌ Only admins, hosts, and dispatch-qualified members can start ${label} sessions.`,
                flags: 64,
            });
        }

        return handleStart(interaction, sessionType);
    },
};

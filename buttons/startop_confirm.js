// buttons/startop_confirm.js
// Handles the session-type choice buttons shown by startop.js.
// Custom IDs: startop:official | startop:unofficial | startop:stress_test

const { handleStart } = require('../commands/ops/session');
const { hasAnyRole }  = require('../utils/permissions');
const { ADMIN_ROLE, DISPATCH_QUAL_ROLE } = require('../config');

module.exports = {
    matches: (id) => id.startsWith('startop:'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, DISPATCH_QUAL_ROLE])) {
            return interaction.reply({
                content: '❌ Only admins and dispatch-qualified staff can start an operation.',
                flags: 64,
            });
        }

        const sessionType = interaction.customId.split(':')[1]; // 'official' | 'unofficial' | 'stress_test'
        return handleStart(interaction, sessionType);
    },
};

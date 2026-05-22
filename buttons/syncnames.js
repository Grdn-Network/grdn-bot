// buttons/syncnames.js
// "Start Official Operation" button on the dispatch embed.
// Delegates to the same handler as /ops start.

const { handleStart } = require('../commands/ops/ops');
const { hasAnyRole }  = require('../utils/permissions');
const { ADMIN_ROLE, DISPATCH_QUAL_ROLE } = require('../config');

module.exports = {
    customId: 'syncnames_btn',

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, DISPATCH_QUAL_ROLE])) {
            return interaction.reply({
                content: '❌ Only admins and dispatch-qualified staff can start an operation.',
                flags: 64,
            });
        }
        return handleStart(interaction);
    },
};

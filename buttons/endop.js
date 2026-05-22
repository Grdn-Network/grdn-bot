// buttons/endop.js
// "End Official Operation" button on the dispatch embed.
// Delegates to the same handler as /ops end.

const { handleEnd } = require('../commands/ops/ops');
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE } = require('../config');

module.exports = {
    customId: 'endop_btn',

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE])) {
            return interaction.reply({
                content: '❌ Only admins and hosts can end an operation.',
                flags: 64,
            });
        }
        return handleEnd(interaction);
    },
};

// buttons/purgedNav.js
// Prev/Next navigation for the /purged forensic viewer.

const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, DVMP_COMMAND_ROLE } = require('../config');
const { buildPurgePage } = require('../utils/purgedView');

module.exports = {
    matches: (customId) => customId.startsWith('purged_nav:'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, DVMP_COMMAND_ROLE])) {
            return interaction.reply({ content: '❌ Admins only.', flags: 64 });
        }

        const [, purgeId, index] = interaction.customId.split(':');
        const page = buildPurgePage(Number(purgeId), Number(index));
        if (!page) {
            return interaction.reply({ content: 'This purge is no longer available.', flags: 64 });
        }

        // Defer the component update first (the new page may upload an image),
        // then edit. attachments: [] clears the previous page's image.
        await interaction.deferUpdate();
        await interaction.editReply({ ...page, attachments: [] });
    },
};

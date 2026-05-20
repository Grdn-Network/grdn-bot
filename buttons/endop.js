// buttons/endop.js
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE } = require('../config');

module.exports = {
    customId: 'endop_btn',

    async execute(interaction) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !hasAnyRole(member, [ADMIN_ROLE, HOST_ROLE])) {
            return interaction.reply({ content: '❌ Only admins can end the operation.', flags: 64 });
        }
        const cmd = interaction.client.commands.get('endop');
        if (!cmd) return interaction.reply({ content: '❌ Command not found.', flags: 64 });
        return cmd.execute(interaction);
    }
};

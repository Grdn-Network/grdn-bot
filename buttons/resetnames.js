// buttons/resetnames.js
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE } = require('../config');

module.exports = {
    customId: 'resetnames_btn',

    async execute(interaction) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !hasAnyRole(member, [ADMIN_ROLE, HOST_ROLE])) {
            return interaction.reply({ content: '❌ Only admins can reset names.', flags: 64 });
        }
        const cmd = interaction.client.commands.get('resetnames');
        if (!cmd) return interaction.reply({ content: '❌ Command not found.', flags: 64 });
        return cmd.execute(interaction);
    }
};

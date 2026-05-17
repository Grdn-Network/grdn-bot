// buttons/syncnames.js
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, DISPATCH_QUAL_ROLE } = require('../config');

module.exports = {
    customId: 'syncnames_btn',

    async execute(interaction) {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !hasAnyRole(member, [ADMIN_ROLE, DISPATCH_QUAL_ROLE])) {
            return interaction.reply({ content: '❌ Only admins can sync names.', flags: 64 });
        }
        const cmd = interaction.client.commands.get('syncnames');
        if (!cmd) return interaction.reply({ content: '❌ Command not found.', flags: 64 });
        return cmd.execute(interaction);
    }
};

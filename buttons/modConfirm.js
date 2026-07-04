// buttons/modConfirm.js
// Confirm/Cancel for a pending /mod change. On confirm it applies the change to
// the live mods and re-saves the active preset.

const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE } = require('../config');
const modPending = require('../utils/modPending');
const { applyMod, refreshOpsEmbed, buildModListReply } = require('../utils/modOps');

module.exports = {
    matches: (customId) => customId.startsWith('mod_confirm:') || customId.startsWith('mod_cancel:'),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE])) {
            return interaction.reply({ content: '❌ Only admins and hosts can manage mods.', flags: 64 });
        }

        const [action, id] = interaction.customId.split(':');
        const entry = modPending.take(id);

        if (!entry) {
            return interaction.update({ content: 'This confirmation expired. Run the command again.', components: [] });
        }
        if (entry.userId !== interaction.user.id) {
            return interaction.reply({ content: '❌ Only the person who ran the command can confirm it.', flags: 64 });
        }

        if (action === 'mod_cancel') {
            return interaction.update({ content: 'Cancelled. No changes made.', components: [] });
        }

        await interaction.deferUpdate();
        const active = applyMod(entry.payload);
        await refreshOpsEmbed(interaction);

        const verbDone = entry.payload.action === 'add' ? 'Added/updated'
            : entry.payload.action === 'edit' ? 'Edited' : 'Removed';
        let msg = buildModListReply(verbDone, entry.payload.name);
        if (active) msg += `\n\nPreset **${active.name}** was also updated.`;

        return interaction.editReply({ content: msg, components: [] });
    },
};

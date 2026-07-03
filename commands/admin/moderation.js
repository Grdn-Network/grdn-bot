// commands/admin/moderation.js
// Live on/off toggle for the anti-scam scanner. Stored in the DB so it takes
// effect immediately with no restart. Admin only.

const { SlashCommandBuilder } = require('discord.js');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, SCAM_MODERATION_ENABLED } = require('../../config');
const storage = require('../../database/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('moderation')
        .setDescription('Turn the anti-scam scanner on or off, or check its status.')
        .addStringOption(opt =>
            opt.setName('action')
               .setDescription('What to do')
               .setRequired(true)
               .addChoices(
                   { name: 'on', value: 'on' },
                   { name: 'off', value: 'off' },
                   { name: 'status', value: 'status' },
               )
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, ADMIN_ROLE)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: 64,
            });
        }

        const action = interaction.options.getString('action');

        if (action === 'status') {
            const v = storage.isModerationEnabled();
            const on = v === null ? SCAM_MODERATION_ENABLED : v;
            return interaction.reply({
                content: `Anti-scam scanner is currently **${on ? 'ON' : 'OFF'}**.`,
                flags: 64,
            });
        }

        const on = action === 'on';
        storage.setModerationEnabled(on);
        return interaction.reply({
            content: `Anti-scam scanner is now **${on ? 'ON' : 'OFF'}**.`,
            flags: 64,
        });
    },
};

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
        .setDescription('Turn the anti-scam scanner on or off (no restart needed).')
        .addSubcommand(s => s.setName('on').setDescription('Enable the scanner'))
        .addSubcommand(s => s.setName('off').setDescription('Disable the scanner'))
        .addSubcommand(s => s.setName('status').setDescription('Show whether the scanner is on')),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, ADMIN_ROLE)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: 64,
            });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === 'status') {
            const v = storage.isModerationEnabled();
            const on = v === null ? SCAM_MODERATION_ENABLED : v;
            return interaction.reply({
                content: `Anti-scam scanner is currently **${on ? 'ON' : 'OFF'}**.`,
                flags: 64,
            });
        }

        const on = sub === 'on';
        storage.setModerationEnabled(on);
        return interaction.reply({
            content: `Anti-scam scanner is now **${on ? 'ON' : 'OFF'}**.`,
            flags: 64,
        });
    },
};

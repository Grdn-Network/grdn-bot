// commands/removecrew.js
const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const storage = require('../storage');
const { hasAnyRole } = require('../utils/permissions');
const { ADMIN_ROLE } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removecrew')
        .setDescription('Remove a crew member from the system without banning them.')
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('The crew member to remove')
                .setRequired(true)
        )
        .addBooleanOption(opt =>
            opt.setName('keephours')
                .setDescription('Keep their logged hours on record (default: yes)')
                .setRequired(false)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE])) {
            return interaction.reply({ content: '❌ Admins only.', flags: 64 });
        }

        const target = interaction.options.getUser('user');
        const keepHours = interaction.options.getBoolean('keephours') ?? true;

        const existing = storage.getCrewRaw(target.id);
        if (!existing) {
            return interaction.reply({
                content: `❌ **${target.username}** is not registered in the crew system.`,
                flags: 64
            });
        }

        // Remove from registrations
        storage.deleteCrew(target.id);

        // Optionally wipe their hours
        if (!keepHours) {
            db.prepare(`DELETE FROM ops_log WHERE user_id = ?`).run(target.id);
        }

        // Reset their nickname if possible
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);
        if (member) {
            await member.setNickname(null).catch(() => {});
        }

        return interaction.reply({
            content:
                `✅ Removed **${target.username}** from the crew system.\n` +
                `• Hours: ${keepHours ? 'kept on record' : 'wiped'}\n` +
                `• Nickname: ${member ? 'reset' : 'could not reset (not in server)'}`,
            flags: 64
        });
    }
};

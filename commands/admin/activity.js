// commands/admin/activity.js
// Reads the central activity log: who ran what, and with which arguments.
// Admin only, and always ephemeral, so the log stays private.
// See grdn-bot issue #13.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE } = require('../../config');
const activityLog = require('../../utils/activityLog');

const DESCRIPTION_LIMIT = 4096;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('activity')
        .setDescription('Look up who ran what.')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('Only show actions by this person')
        )
        .addStringOption(o =>
            o.setName('command')
                .setDescription('Only show entries whose name matches (e.g. setyard)')
        )
        .addIntegerOption(o =>
            o.setName('limit')
                .setDescription('How many entries to show (1-25, default 15)')
                .setMinValue(1)
                .setMaxValue(25)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE])) {
            return interaction.reply({
                content: '❌ Only admins can use this command.',
                flags: 64
            });
        }

        const user  = interaction.options.getUser('user');
        const name  = interaction.options.getString('command');
        const limit = interaction.options.getInteger('limit') ?? 15;

        const rows = activityLog.query({ userId: user?.id, name, limit });
        if (!rows.length) {
            return interaction.reply({ content: 'No matching activity found.', flags: 64 });
        }

        const lines = rows.map(r => {
            const when = `<t:${Math.floor(r.ts / 1000)}:R>`;
            const what = r.kind === 'command' ? `\`/${r.name}\`` : `\`${r.name}\``;
            let line = `${when} <@${r.user_id}> ${what}`;
            if (r.detail)     line += ` \`${r.detail}\``;
            if (r.channel_id) line += ` in <#${r.channel_id}>`;
            if (r.status !== 'ok') line += ` ⚠️ ${r.status}`;
            return line;
        });

        // Keep the description under Discord's 4096-char limit.
        let desc = '';
        let shown = 0;
        for (const line of lines) {
            const piece = shown === 0 ? line : `\n${line}`;
            if (desc.length + piece.length > DESCRIPTION_LIMIT - 80) break;
            desc += piece;
            shown++;
        }
        if (shown < lines.length) desc += `\n_+${lines.length - shown} more not shown._`;

        const filters = [
            user ? `user ${user.tag}` : null,
            name ? `name matching "${name}"` : null,
        ].filter(Boolean).join(', ');

        const embed = new EmbedBuilder()
            .setTitle('Activity log')
            .setColor(0x2b2d31)
            .setDescription(desc)
            .setFooter({ text: filters ? `Filters: ${filters}` : `Most recent ${shown}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};

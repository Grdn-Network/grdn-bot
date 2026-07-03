// commands/admin/purged.js
// Review what a purge/ban removed. Loads a purge and flips through the deleted
// messages with Prev/Next buttons. Admin only. Ephemeral so the review is private.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, DVMP_COMMAND_ROLE } = require('../../config');
const storage = require('../../database/storage');
const { buildPurgePage } = require('../../utils/purgedView');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('purged')
        .setDescription('Review the messages removed by a purge/ban.')
        .addUserOption(opt =>
            opt.setName('user')
               .setDescription("Show this user's most recent purge")
               .setRequired(false)
        )
        .addIntegerOption(opt =>
            opt.setName('id')
               .setDescription('Show a specific purge by its number')
               .setRequired(false)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, DVMP_COMMAND_ROLE])) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                flags: 64,
            });
        }

        // Defer (ephemeral): building a page may upload a saved image.
        await interaction.deferReply({ flags: 64 });

        const idOpt = interaction.options.getInteger('id');
        const userOpt = interaction.options.getUser('user');

        let purgeId;

        if (idOpt) {
            purgeId = idOpt;
        } else if (userOpt) {
            const p = storage.getLatestPurgeForUser(userOpt.id);
            if (!p) {
                return interaction.editReply({ content: `No purge on record for **${userOpt.username}**.` });
            }
            purgeId = p.id;
        } else {
            // No target given: list recent purges to pick from
            const recent = storage.listRecentPurges(10);
            if (!recent.length) {
                return interaction.editReply({ content: 'No purges on record yet.' });
            }
            const embed = new EmbedBuilder()
                .setTitle('Recent purges')
                .setColor(0xff5555)
                .setDescription(
                    recent.map(p =>
                        `**#${p.id}** ${p.target_tag || p.target_id} · ${p.deleted_count} msg · ${p.channels_affected} ch · <t:${Math.floor(p.created_at / 1000)}:R>`
                    ).join('\n')
                )
                .setFooter({ text: 'Open one with /purged id:<number>' });
            return interaction.editReply({ embeds: [embed] });
        }

        const page = buildPurgePage(purgeId, 0);
        if (!page) {
            return interaction.editReply({ content: `No purge found with id **${purgeId}**.` });
        }

        return interaction.editReply(page);
    },
};

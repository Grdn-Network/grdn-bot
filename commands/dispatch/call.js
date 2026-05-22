// commands/dispatch/call.js
// /call train: — dispatch pages a train crew.
// Bot joins the crew's current VC, plays "Train X, contact dispatch", then leaves.
// Staff only.

const { SlashCommandBuilder } = require('discord.js');
const { alertTrain }  = require('../../utils/voiceAlert');
const { hasAnyRole }  = require('../../utils/permissions');
const { STAFF_ROLES } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('call')
        .setDescription('Page a train crew to contact dispatch.')
        .addStringOption(opt =>
            opt.setName('train')
               .setDescription('Train number to page (e.g. 038)')
               .setRequired(true)
        ),

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, STAFF_ROLES)) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64,
            });
        }

        const train = interaction.options.getString('train').trim();
        await interaction.deferReply({ flags: 64 });

        const result = await alertTrain(
            interaction.guild,
            train,
            `Train ${train}, contact dispatch`
        );

        if (result.success) {
            return interaction.editReply(`✅ Paged train **${train}**.`);
        } else {
            return interaction.editReply(`⚠️ ${result.reason}.`);
        }
    },
};

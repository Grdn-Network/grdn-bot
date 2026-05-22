// commands/dispatch/call.js
// /call train: — dispatch pages a train crew.
// Pings registered crew members in the current channel so Discord notifies them.
// Staff only (Dispatch Qual, Admin, Host, DVMP Command).

const { SlashCommandBuilder } = require('discord.js');
const { hasAnyRole } = require('../../utils/permissions');
const { STAFF_ROLES } = require('../../config');
const storage = require('../../database/storage');

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
        const crew  = storage.getAllCrew(interaction.guild.id)
            .filter(c => String(c.trainNumber) === String(train));

        if (crew.length === 0) {
            return interaction.reply({
                content: `⚠️ No crew registered to train **${train}**.`,
                flags: 64,
            });
        }

        const mentions = crew.map(c => `<@${c.userId}>`).join(' ');

        // Visible message — the @mention triggers Discord's normal notification
        await interaction.reply({
            content: `📻 ${mentions} — **Train ${train}**, contact dispatch.`,
        });
    },
};

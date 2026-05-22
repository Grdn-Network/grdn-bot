// commands/ops/assign.js
// /assign [train:] — opens a modal pre-filled with the current assignment.
//   Staff:     must supply train: explicitly
//   Non-staff: uses their registered train number

const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const storage = require('../../database/storage');
const { STAFF_ROLES } = require('../../config');

// Blank out the default '—' placeholder so the modal feels clean
function toField(val) {
    return (!val || val === '—') ? '' : val;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('assign')
        .setDescription('Set operational info for a train.')
        .addStringOption(opt =>
            opt.setName('train')
               .setDescription('Train number (staff only — leave blank to use your registered train)')
        ),

    async execute(interaction) {
        const guildId        = interaction.guild.id;
        const isStaff        = STAFF_ROLES.some(r => interaction.member.roles.cache.has(r));
        const requestedTrain = interaction.options.getString('train');

        // ── Resolve train number ──────────────────────────────────────────────
        let train;
        if (isStaff) {
            if (!requestedTrain)
                return interaction.reply({ content: '❌ Please specify a train number.', flags: 64 });
            train = requestedTrain;
        } else {
            const crew = storage.getCrewByUserId(guildId, interaction.user.id);
            if (!crew?.trainNumber)
                return interaction.reply({
                    content: "❌ You don't have a train registered. Ask staff to register you first.",
                    flags: 64,
                });
            if (requestedTrain && requestedTrain !== crew.trainNumber)
                return interaction.reply({
                    content: `❌ You can only update your own train (**${crew.trainNumber}**).`,
                    flags: 64,
                });
            train = crew.trainNumber;
        }

        // ── Pre-fill from existing assignment ─────────────────────────────────
        const existing = storage.getAssignmentByTrain(guildId, train) || {};

        // ── Build modal ───────────────────────────────────────────────────────
        const modal = new ModalBuilder()
            .setCustomId(`assign_modal:${guildId}:${train}`)
            .setTitle(`Train ${train} — Assignment`);

        const make = (id, label, placeholder, val) =>
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId(id)
                    .setLabel(label)
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(placeholder)
                    .setValue(toField(val))
                    .setRequired(false)
            );

        modal.addComponents(
            make('dep', 'Departing Station', 'e.g. Harbor',    existing.dep),
            make('des', 'Destination',       'e.g. Steel Mill', existing.des),
            make('trk', 'Arrival Track',     'e.g. A2',        existing.trk),
            make('job', 'Job Code',          'e.g. HB-SU-27',  existing.job),
            make('rmk', 'Remarks',           'Any notes…',     existing.rmk),
        );

        await interaction.showModal(modal);
    },
};

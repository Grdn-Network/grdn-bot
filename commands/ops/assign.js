// commands/ops/assign.js
// /assign — set operational info for a train.
//   Staff:    must supply train: explicitly
//   Non-staff: uses their registered train number (cannot specify another)

const { SlashCommandBuilder } = require('discord.js');
const storage = require('../../database/storage');
const { updateTrainBoard } = require('../../utils/trainBoard');
const { STAFF_ROLES, TRAIN_BOARD_CHANNEL_ID } = require('../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('assign')
        .setDescription('Set operational info for a train.')
        .addStringOption(opt =>
            opt.setName('train')
               .setDescription('Train number (staff only — leave blank to use your registered train)')
        )
        .addStringOption(opt => opt.setName('dep').setDescription('Departing station'))
        .addStringOption(opt => opt.setName('des').setDescription('Destination station'))
        .addStringOption(opt => opt.setName('trk').setDescription('Arrival track'))
        .addStringOption(opt => opt.setName('job').setDescription('Job code'))
        .addStringOption(opt => opt.setName('rmk').setDescription('Remarks / notes')),

    async execute(interaction) {
        const guildId        = interaction.guild.id;
        const isStaff        = STAFF_ROLES.some(r => interaction.member.roles.cache.has(r));
        const requestedTrain = interaction.options.getString('train');

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

        const existing = storage.getAssignmentByTrain(guildId, train) || {};
        const dep = interaction.options.getString('dep') ?? existing.dep ?? '—';
        const des = interaction.options.getString('des') ?? existing.des ?? '—';
        const trk = interaction.options.getString('trk') ?? existing.trk ?? '—';
        const job = interaction.options.getString('job') ?? existing.job ?? '—';
        const rmk = interaction.options.getString('rmk') ?? existing.rmk ?? '—';

        storage.setAssignment(guildId, train, { dep, des, trk, job, rmk, timestamp: Date.now() });

        await interaction.reply({
            content:
                `Assignment saved for train **${train}**:\n` +
                `DEP : ${dep}\nDES : ${des}\nTRK : ${trk}\nJOB : ${job}\nRMK : ${rmk}`,
            flags: 64,
        });

        await updateTrainBoard(interaction.client, guildId, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] assign update failed:', err));
    },
};

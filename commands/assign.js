// commands/assign.js

const { SlashCommandBuilder } = require('discord.js');
const storage = require('../storage');
const { updateTrainBoard } = require('../trainBoard');
const { TRAIN_BOARD_CHANNEL_ID, STAFF_ROLES } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('assign')
        .setDescription('Assign operational info to a train number.')
        .addStringOption(opt =>
            opt.setName('train').setDescription('Train number (staff only — leave blank to use your registered train)').setRequired(false)
        )
        .addStringOption(opt =>
            opt.setName('dep').setDescription('Departing station')
        )
        .addStringOption(opt =>
            opt.setName('des').setDescription('Destination station')
        )
        .addStringOption(opt =>
            opt.setName('trk').setDescription('Arrival track')
        )
        .addStringOption(opt =>
            opt.setName('job').setDescription('Job code')
        )
        .addStringOption(opt =>
            opt.setName('rmk').setDescription('Remarks / notes')
        ),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const isStaff = STAFF_ROLES.some(role => interaction.member.roles.cache.has(role));
        const requestedTrain = interaction.options.getString('train');

        let train;

        if (isStaff) {
            // Staff can specify any train, but must provide one
            if (!requestedTrain) {
                return interaction.reply({
                    content: '❌ Please specify a train number.',
                    flags: 64
                });
            }
            train = requestedTrain;
        } else {
            // Non-staff: look up their registered train
            const crew = storage.getCrewByUserId(guildId, interaction.user.id);
            if (!crew || !crew.trainNumber) {
                return interaction.reply({
                    content: '❌ You don\'t have a train registered to you. Ask staff to register you first.',
                    flags: 64
                });
            }
            // Non-staff cannot specify a different train
            if (requestedTrain && requestedTrain !== crew.trainNumber) {
                return interaction.reply({
                    content: `❌ You can only update your own train (**${crew.trainNumber}**).`,
                    flags: 64
                });
            }
            train = crew.trainNumber;
        }

        // Load existing assignment (if any) for partial update
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
                `DEP : ${dep}\n` +
                `DES : ${des}\n` +
                `TRK : ${trk}\n` +
                `JOB : ${job}\n` +
                `RMK : ${rmk}`,
            flags: 64
        });

        await updateTrainBoard(interaction.client, guildId, TRAIN_BOARD_CHANNEL_ID);
    }
};

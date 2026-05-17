// commands/setcrew.js

const { SlashCommandBuilder } = require('discord.js');
const db = require('../database/db');
const { updateTrainBoard } = require('../trainBoard');
const { buildNickname } = require('../utils/nickname');
const { TRAIN_BOARD_CHANNEL_ID, STAFF_ROLES } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setcrew')
        .setDescription('Create or edit a crew profile.')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Staff only: edit another user')
        )
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Crew type')
                .addChoices(
                    { name: 'Dispatcher', value: 'Dispatcher' },
                    { name: 'Shunter', value: 'Shunter' },
                    { name: 'Road Crew', value: 'Road Crew' }
                )
        )
        .addStringOption(option =>
            option.setName('train_number')
                .setDescription('Train number')
        )
        .addStringOption(option =>
            option.setName('preferred_name')
                .setDescription('Preferred name')
        ),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const member = interaction.member;

        // Determine which user's profile to edit
        let userIdToEdit;
        if (targetUser) {
            const hasPermission = STAFF_ROLES.some(role => member.roles.cache.has(role));
            if (!hasPermission) {
                return interaction.reply({
                    content: "❌ You do not have permission to edit another user's profile.",
                    flags: 64
                });
            }
            userIdToEdit = targetUser.id;
        } else {
            userIdToEdit = interaction.user.id;
        }

        const type = interaction.options.getString('type');
        const trainNumber = interaction.options.getString('train_number');
        const preferredName = interaction.options.getString('preferred_name');

        // Fetch existing profile
        const existing = db.prepare(`SELECT * FROM registrations WHERE user_id = ?`).get(userIdToEdit);

        if (!existing) {
            // New profile — all fields required
            const missing = [];
            if (!type) missing.push('type');
            if (!trainNumber) missing.push('train_number');
            if (!preferredName) missing.push('preferred_name');

            if (missing.length > 0) {
                return interaction.reply({
                    content: `❌ Missing required fields to create a profile: **${missing.join(', ')}**`,
                    flags: 64
                });
            }

            if (type === 'Road Crew' && !/^\d{3}$/.test(trainNumber)) {
                return interaction.reply({
                    content: '❌ Road Crew train numbers must be exactly **3 digits** (e.g., 001, 120, 999).',
                    flags: 64
                });
            }

            db.prepare(`
                INSERT INTO registrations (user_id, type, train_number, preferred_name)
                VALUES (?, ?, ?, ?)
            `).run(userIdToEdit, type, trainNumber, preferredName);

            const guildMember = await interaction.guild.members.fetch(userIdToEdit).catch(() => null);
            if (guildMember) {
                await guildMember.setNickname(buildNickname(type, trainNumber, preferredName)).catch(() => {});
            }

            await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID);

            return interaction.reply({
                content: `✅ Profile created for <@${userIdToEdit}>.`,
                flags: 64
            });
        }

        // Existing profile — merge with provided values
        const newType = type || existing.type;
        const newTrain = trainNumber || existing.train_number;
        const newPreferred = preferredName || existing.preferred_name;

        if (newType === 'Road Crew' && !/^\d{3}$/.test(newTrain)) {
            return interaction.reply({
                content: '❌ Road Crew train numbers must be exactly **3 digits** (e.g., 001, 120, 999).',
                flags: 64
            });
        }

        db.prepare(`
            UPDATE registrations
            SET type = ?, train_number = ?, preferred_name = ?
            WHERE user_id = ?
        `).run(newType, newTrain, newPreferred, userIdToEdit);

        const guildMember = await interaction.guild.members.fetch(userIdToEdit).catch(() => null);
        if (guildMember) {
            await guildMember.setNickname(buildNickname(newType, newTrain, newPreferred)).catch(() => {});
        }

        await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID);

        return interaction.reply({
            content: `✅ Profile updated and nickname synced for <@${userIdToEdit}>.`,
            flags: 64
        });
    }
};

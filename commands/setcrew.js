// commands/setcrew.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../storage');
const { updateTrainBoard } = require('../trainBoard');
const { buildNickname } = require('../utils/nickname');
const { hasAnyRole } = require('../utils/permissions');
const { TRAIN_BOARD_CHANNEL_ID, STAFF_ROLES } = require('../config');

function enrollIfSessionActive(userId, guildId, type, trainNumber) {
    const session = storage.getActiveSession(guildId);
    if (!session) return;
    const category = storage.classifyCategory(type, trainNumber);
    if (category) storage.openOpsEntry(userId, guildId, session.id, category, Date.now());
}

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

        let userIdToEdit;
        if (targetUser) {
            if (!hasAnyRole(member, STAFF_ROLES)) {
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

        const existing = storage.getCrewRaw(userIdToEdit);

        if (!existing) {
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

            storage.upsertCrew(userIdToEdit, type, trainNumber, preferredName);
            enrollIfSessionActive(userIdToEdit, interaction.guild.id, type, trainNumber);

            const guildMember = await interaction.guild.members.fetch(userIdToEdit).catch(() => null);
            if (guildMember) {
                await guildMember.setNickname(buildNickname(type, trainNumber, preferredName)).catch(() => {});
            }

            await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
                .catch(err => console.error('[TrainBoard] Update failed:', err));

            return interaction.reply({
                content: `✅ Profile created for <@${userIdToEdit}>.`,
                flags: 64
            });
        }

        const newType = type || existing.type;
        const newTrain = trainNumber || existing.train_number;
        const newPreferred = preferredName || existing.preferred_name;

        if (newType === 'Road Crew' && !/^\d{3}$/.test(newTrain)) {
            return interaction.reply({
                content: '❌ Road Crew train numbers must be exactly **3 digits** (e.g., 001, 120, 999).',
                flags: 64
            });
        }

        storage.upsertCrew(userIdToEdit, newType, newTrain, newPreferred);
        enrollIfSessionActive(userIdToEdit, interaction.guild.id, newType, newTrain);

        const guildMember = await interaction.guild.members.fetch(userIdToEdit).catch(() => null);
        if (guildMember) {
            await guildMember.setNickname(buildNickname(newType, newTrain, newPreferred)).catch(() => {});
        }

        await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] Update failed:', err));

        return interaction.reply({
            content: `✅ Profile updated and nickname synced for <@${userIdToEdit}>.`,
            flags: 64
        });
    }
};

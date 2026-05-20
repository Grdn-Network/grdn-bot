// commands/crew/setcrew.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../../database/storage');
const { updateTrainBoard } = require('../../utils/trainBoard');
const { buildNickname } = require('../../utils/nickname');
const { hasAnyRole } = require('../../utils/permissions');
const { TRAIN_BOARD_CHANNEL_ID, STAFF_ROLES, TRAINMASTER_ROLE } = require('../../config');

/**
 * Called when /setcrew runs during an active ops session.
 * Adds the user to session_crew (the official opt-in list) regardless of VC status.
 * If they're already in a VC, also opens an ops_log entry to start the hours clock.
 * If they join a VC later, opsVoiceTracker will see them in session_crew and start it then.
 */
function enrollIfSessionActive(userId, guildId, type, trainNumber, isInVC) {
    const session = storage.getActiveSession(guildId);
    if (!session) return;
    const category = storage.classifyCategory(type, trainNumber);
    if (!category) return; // no valid type or train number — don't enroll
    storage.addToSessionCrew(session.id, userId); // opt in regardless of VC status
    if (isInVC) storage.openOpsEntry(userId, guildId, session.id, category, Date.now());
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
                    { name: 'TrainMaster', value: 'TrainMaster' },
                    { name: 'Dispatcher',  value: 'Dispatcher'  },
                    { name: 'Yard Crew',   value: 'Yard Crew'   },
                    { name: 'Road Crew',   value: 'Road Crew'   }
                )
        )
        .addStringOption(option =>
            option.setName('train_number')
                .setDescription('Train number (e.g. 001)')
        )
        .addStringOption(option =>
            option.setName('loco_type')
                .setDescription('Locomotive type — used to match your loco in the game')
                .addChoices(
                    { name: 'DE2',     value: 'DE2'     },
                    { name: 'DE6',     value: 'DE6'     },
                    { name: 'DH4',     value: 'DH4'     },
                    { name: 'DM3',     value: 'DM3'     },
                    { name: 'S060',    value: 'S060'    },
                    { name: 'S282',    value: 'S282'    },
                    { name: 'BE2',     value: 'BE2'     },
                    { name: 'Handcar', value: 'Handcar' }
                )
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
        const locoType = interaction.options.getString('loco_type');
        const preferredName = interaction.options.getString('preferred_name');

        // Roles that don't operate trains — loco_type makes no sense for them
        const NON_TRAIN_TYPES = ['Dispatcher', 'TrainMaster'];

        // TrainMaster type requires that role (or staff setting it for someone else)
        if (type === 'TrainMaster' && !targetUser && !hasAnyRole(member, [TRAINMASTER_ROLE, ...STAFF_ROLES])) {
            return interaction.reply({
                content: '❌ You do not have the TrainMaster role.',
                flags: 64
            });
        }

        // Reject loco_type for non-train roles
        if (locoType && type && NON_TRAIN_TYPES.includes(type)) {
            return interaction.reply({
                content: `❌ **${type}** does not operate a locomotive — \`loco_type\` is not applicable.`,
                flags: 64
            });
        }

        const existing = storage.getCrewRaw(userIdToEdit);

        if (!existing) {
            // preferred_name is always required
            if (!preferredName) {
                return interaction.reply({
                    content: '❌ `preferred_name` is required to create a profile.',
                    flags: 64
                });
            }

            // During an active session, type, train_number, and loco_type (for train roles) are required
            if (storage.getActiveSession(interaction.guild.id)) {
                const missing = [];
                if (!type) missing.push('type');
                if (!trainNumber) missing.push('train_number');
                if (type && !NON_TRAIN_TYPES.includes(type) && !locoType) missing.push('loco_type');
                if (missing.length > 0) {
                    return interaction.reply({
                        content:
                            `❌ An official ops session is active. Also required: **${missing.join(', ')}**\n` +
                            `Example: \`/setcrew preferred_name:Dommie type:Road Crew train_number:001 loco_type:DE2\``,
                        flags: 64
                    });
                }
            }

            // Validate Road Crew number format only when a number is provided
            if (type === 'Road Crew' && trainNumber && !/^\d{3}$/.test(trainNumber)) {
                return interaction.reply({
                    content: '❌ Road Crew train numbers must be exactly **3 digits** (e.g., 001, 120, 999).',
                    flags: 64
                });
            }

            // Wipe loco_type for non-train roles — it has no meaning there
            const resolvedLocoType = NON_TRAIN_TYPES.includes(type) ? null : (locoType ?? null);
            storage.upsertCrew(userIdToEdit, type ?? null, trainNumber ?? '', preferredName, resolvedLocoType);

            await interaction.deferReply({ ephemeral: true });

            const guildMember = await interaction.guild.members.fetch(userIdToEdit).catch(() => null);
            let ownerNote = '';
            if (guildMember) {
                const targetNick = buildNickname(type, trainNumber, preferredName);
                await guildMember.setNickname(targetNick).catch(() => {});
                const inVC = !!guildMember.voice.channel;
                enrollIfSessionActive(userIdToEdit, interaction.guild.id, type, trainNumber, inVC);
                if (guildMember.id === interaction.guild.ownerId && userIdToEdit === interaction.user.id) {
                    ownerNote = `\n⚠️ Discord doesn't allow bots to rename the server owner. Set your nickname manually: \`${targetNick}\``;
                }
            }

            await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
                .catch(err => console.error('[TrainBoard] Update failed:', err));

            return interaction.editReply({ content: `✅ Profile created for <@${userIdToEdit}>.${ownerNote}` });
        }

        const newType      = type        || existing.type;
        const newTrain     = trainNumber || existing.train_number;
        const newPreferred = preferredName || existing.preferred_name;

        // Wipe loco_type when switching to a non-train role (or keep/update it otherwise)
        const newLocoType = NON_TRAIN_TYPES.includes(newType)
            ? null
            : (locoType ?? existing.loco_type ?? null);

        // During an active session, train-operating crew must have both train_number and loco_type
        if (storage.getActiveSession(interaction.guild.id)) {
            const missing = [];
            if (!newTrain?.trim()) missing.push('train_number');
            if (!NON_TRAIN_TYPES.includes(newType) && !newLocoType) missing.push('loco_type');
            if (missing.length > 0) {
                return interaction.reply({
                    content:
                        `⚠️ An official ops session is active. Missing: **${missing.join(', ')}**\n` +
                        `Example: \`/setcrew train_number:001 loco_type:DE2\``,
                    flags: 64
                });
            }
        }

        if (newType === 'Road Crew' && newTrain && !/^\d{3}$/.test(newTrain)) {
            return interaction.reply({
                content: '❌ Road Crew train numbers must be exactly **3 digits** (e.g., 001, 120, 999).',
                flags: 64
            });
        }

        storage.upsertCrew(userIdToEdit, newType, newTrain, newPreferred, newLocoType);

        await interaction.deferReply({ ephemeral: true });

        const guildMember = await interaction.guild.members.fetch(userIdToEdit).catch(() => null);
        let ownerNote = '';
        if (guildMember) {
            const targetNick = buildNickname(newType, newTrain, newPreferred);
            await guildMember.setNickname(targetNick).catch(() => {});
            const inVC = !!guildMember.voice.channel;
            enrollIfSessionActive(userIdToEdit, interaction.guild.id, newType, newTrain, inVC);
            if (guildMember.id === interaction.guild.ownerId) {
                ownerNote = `\n⚠️ Discord doesn't allow bots to rename the server owner. Set your nickname manually: \`${targetNick}\``;
            }
        }

        await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] Update failed:', err));

        return interaction.editReply({ content: `✅ Profile updated and nickname synced for <@${userIdToEdit}>.${ownerNote}` });
    }
};

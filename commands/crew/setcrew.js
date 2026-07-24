// commands/crew/setcrew.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../../database/storage');
const { updateTrainBoard } = require('../../utils/trainBoard');
const { buildNickname } = require('../../utils/nickname');
const { hasAnyRole } = require('../../utils/permissions');
const { TRAIN_BOARD_CHANNEL_ID, STAFF_ROLES } = require('../../config');

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
    // Only official ops and stress tests accrue hours. Unofficial crew are still
    // tracked as participants so end-op nickname cleanup still covers them.
    if (isInVC && storage.sessionTracksHours(session)) {
        storage.openOpsEntry(userId, guildId, session.id, category, Date.now());
    }
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
                    { name: 'Controller', value: 'Controller' },
                    { name: 'Yard Crew',  value: 'Yard Crew'  },
                    { name: 'Road Crew',  value: 'Road Crew'  }
                )
        )
        .addStringOption(option =>
            option.setName('train_number')
                .setDescription('Train number (e.g. 001)')
        )
        .addStringOption(option =>
            option.setName('preferred_name')
                .setDescription('Preferred name')
        ),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user');
        const member = interaction.member;

        const pickedSelf   = !!targetUser && targetUser.id === interaction.user.id;
        const editingOther = !!targetUser && !pickedSelf;

        // Editing someone else's profile is a staff-only action. Picking yourself
        // is allowed for anyone (it just edits your own profile), so only block the
        // real staff action and say plainly why.
        if (editingOther && !hasAnyRole(member, STAFF_ROLES)) {
            return interaction.reply({
                content:
                    "❌ Choosing a **user** edits *that person's* profile, which is a staff-only action. " +
                    "To set up your own, run `/setcrew` without the `user` option.",
                flags: 64
            });
        }

        const userIdToEdit = editingOther ? targetUser.id : interaction.user.id;

        // If they picked themselves in the user option, it works, but let them know
        // afterward that it was not necessary. Sent as a separate hidden note.
        const sendSelfPickNote = async () => {
            if (!pickedSelf) return;
            await interaction.followUp({
                content: 'ℹ️ You did not need to choose yourself in the `user` option. Running `/setcrew` on its own edits your own profile.',
                flags: 64,
            }).catch(() => {});
        };

        const type = interaction.options.getString('type');
        const trainNumber = interaction.options.getString('train_number');
        const preferredName = interaction.options.getString('preferred_name');

        // Roles that don't operate trains. loco_type is wiped for them on save.
        const NON_TRAIN_TYPES = ['Controller'];

        const existing = storage.getCrewRaw(userIdToEdit);

        if (!existing) {
            // preferred_name is always required
            if (!preferredName) {
                return interaction.reply({
                    content: '❌ `preferred_name` is required to create a profile.',
                    flags: 64
                });
            }

            // During an active session, type and train_number are required.
            // loco_type is filled automatically when they board a loco in-game.
            if (storage.getActiveSession(interaction.guild.id)) {
                const missing = [];
                if (!type) missing.push('type');
                if (!trainNumber) missing.push('train_number');
                if (missing.length > 0) {
                    return interaction.reply({
                        content:
                            `❌ An official ops session is active. Also required: **${missing.join(', ')}**\n` +
                            `Example: \`/setcrew preferred_name:Dommie type:Road Crew train_number:001\``,
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

            // New profile: loco_type starts empty and is populated when they board
            // a loco in-game via GRDNConnect.
            storage.upsertCrew(userIdToEdit, type ?? null, trainNumber ?? '', preferredName, null);

            await interaction.deferReply({ ephemeral: true });

            const guildMember = await interaction.guild.members.fetch(userIdToEdit).catch(() => null);
            let ownerNote = '';
            if (guildMember) {
                const targetNick = buildNickname(type, trainNumber, preferredName);
                await guildMember.setNickname(targetNick).catch(() => {});
                const inVC = !!guildMember.voice.channel;
                enrollIfSessionActive(userIdToEdit, interaction.guild.id, type, trainNumber, inVC);

                // If the user is in a Crew VC, refresh the channel name with their new train number
                if (inVC && trainNumber) {
                    const vc = storage.getCrewVCByChannel(guildMember.voice.channel.id);
                    if (vc) {
                        await guildMember.voice.channel
                            .setName(`(${trainNumber}) | Crew ${vc.crew_number}`)
                            .catch(() => {});
                    }
                }

                if (guildMember.id === interaction.guild.ownerId && userIdToEdit === interaction.user.id) {
                    ownerNote = `\n⚠️ Discord doesn't allow bots to rename the server owner. Set your nickname manually: \`${targetNick}\``;
                }
            }

            await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
                .catch(err => console.error('[TrainBoard] Update failed:', err));

            interaction.client.emit('userRegistered', {
                user: targetUser ?? interaction.user,
                type: type ?? null,
                trainNumber: trainNumber ?? '',
                preferredName,
            });

            await interaction.editReply({ content: `✅ Profile created for <@${userIdToEdit}>.${ownerNote}` });
            await sendSelfPickNote();
            return;
        }

        const newType      = type        || existing.type;
        const newTrain     = trainNumber || existing.train_number;
        const newPreferred = preferredName || existing.preferred_name;

        // Wipe loco_type when switching to a non-train role; otherwise keep whatever
        // GRDNConnect recorded when they last boarded a loco.
        const newLocoType = NON_TRAIN_TYPES.includes(newType)
            ? null
            : (existing.loco_type ?? null);

        // During an active session, train-operating crew must have a train_number.
        // loco_type is filled automatically when they board a loco in-game.
        if (storage.getActiveSession(interaction.guild.id)) {
            const missing = [];
            if (!newTrain?.trim()) missing.push('train_number');
            if (missing.length > 0) {
                return interaction.reply({
                    content:
                        `⚠️ An official ops session is active. Missing: **${missing.join(', ')}**\n` +
                        `Example: \`/setcrew train_number:001\``,
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

            // If the user is in a Crew VC, refresh the channel name with their new train number
            if (inVC && newTrain) {
                const vc = storage.getCrewVCByChannel(guildMember.voice.channel.id);
                if (vc) {
                    await guildMember.voice.channel
                        .setName(`(${newTrain}) | Crew ${vc.crew_number}`)
                        .catch(() => {});
                }
            }

            if (guildMember.id === interaction.guild.ownerId) {
                ownerNote = `\n⚠️ Discord doesn't allow bots to rename the server owner. Set your nickname manually: \`${targetNick}\``;
            }
        }

        await updateTrainBoard(interaction.client, interaction.guild.id, TRAIN_BOARD_CHANNEL_ID)
            .catch(err => console.error('[TrainBoard] Update failed:', err));

        interaction.client.emit('userRegistered', {
            user: targetUser ?? interaction.user,
            type: newType,
            trainNumber: newTrain ?? '',
            preferredName: newPreferred,
        });

        await interaction.editReply({ content: `✅ Profile updated and nickname synced for <@${userIdToEdit}>.${ownerNote}` });
        await sendSelfPickNote();
        return;
    }
};

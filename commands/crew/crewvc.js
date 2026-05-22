// commands/crew/crewvc.js
//
// Smart crew VC command — context-aware:
//   • Already in a Crew VC → refresh the channel name with your train number
//   • Not in a Crew VC     → create a new one (and move you in if you're in any VC)

const { SlashCommandBuilder, ChannelType } = require('discord.js');
const storage = require('../../database/storage');
const { CREW_VC_CATEGORY_ID } = require('../../config');

const MAX_CREW_VCS = 10;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crewvc')
        .setDescription('Create a crew VC, or refresh its name if you\'re already in one.'),

    async execute(interaction) {
        const member       = interaction.member;
        const voiceChannel = member.voice.channel;

        // ── Already in a Crew VC → refresh the name ───────────────────────────
        if (voiceChannel) {
            const vc = storage.getCrewVCByChannel(voiceChannel.id);
            if (vc) {
                const crew = storage.getCrewRaw(interaction.user.id);
                if (!crew?.train_number) {
                    return interaction.reply({
                        content: '❌ You don\'t have a train number assigned. Use `/setcrew` first.',
                        flags: 64,
                    });
                }
                const newName = `(${crew.train_number}) | Crew ${vc.crew_number}`;
                await voiceChannel.setName(newName).catch(() => {});
                return interaction.reply({
                    content: `✅ Channel renamed to **${newName}**.`,
                    flags: 64,
                });
            }
        }

        // ── Not in a Crew VC → create one ─────────────────────────────────────
        const guildId  = interaction.guild.id;
        const existing = storage.getCrewVCs(guildId);

        if (existing.length >= MAX_CREW_VCS) {
            return interaction.reply({
                content: `❌ All ${MAX_CREW_VCS} crew channels are already active.`,
                flags: 64,
            });
        }

        // Find the lowest available crew number
        const usedNumbers = new Set(existing.map(r => r.crew_number));
        let crewNumber = null;
        for (let i = 1; i <= MAX_CREW_VCS; i++) {
            if (!usedNumbers.has(i)) { crewNumber = i; break; }
        }

        await interaction.deferReply({ ephemeral: true });

        const channel = await interaction.guild.channels.create({
            name: `Crew ${crewNumber}`,
            type: ChannelType.GuildVoice,
            parent: CREW_VC_CATEGORY_ID,
        });

        storage.addCrewVC(guildId, channel.id, crewNumber);

        // Auto-name with train number if the creator has one
        const crew = storage.getCrewRaw(interaction.user.id);
        if (crew?.train_number) {
            await channel.setName(`(${crew.train_number}) | Crew ${crewNumber}`).catch(() => {});
        }

        // Move creator in if they're already in any voice channel
        let moved = false;
        if (voiceChannel) {
            await member.voice.setChannel(channel).catch(() => {});
            moved = true;
        }

        return interaction.editReply({
            content:
                `✅ **Crew ${crewNumber}** created.` +
                (moved
                    ? ' You have been moved in.'
                    : '\n⚠️ Join a voice channel first to be moved in automatically next time.'),
        });
    },
};

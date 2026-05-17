// commands/crewvc.js
const { SlashCommandBuilder, ChannelType } = require('discord.js');
const storage = require('../storage');
const { CREW_VC_CATEGORY_ID } = require('../config');

const MAX_CREW_VCS = 10;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crewvc')
        .setDescription('Create a temporary crew voice channel (max 10).'),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const existing = storage.getCrewVCs(guildId);

        if (existing.length >= MAX_CREW_VCS) {
            return interaction.reply({
                content: `❌ All ${MAX_CREW_VCS} crew channels are already active.`,
                flags: 64
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

        // Auto-rename if the creator already has a train number
        const crew = storage.getCrewRaw(interaction.user.id);
        if (crew?.train_number) {
            await channel.setName(`(${crew.train_number}) | Crew ${crewNumber}`).catch(() => {});
        }

        // Move the creator in if they're already in voice (Discord requires this)
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        let moved = false;
        if (member?.voice.channel) {
            await member.voice.setChannel(channel).catch(() => {});
            moved = true;
        }

        return interaction.editReply({
            content: `✅ **Crew ${crewNumber}** created.` +
                (moved ? ' You have been moved in.' : '\n⚠️ Join a voice channel first to be moved in automatically next time.')
        });
    }
};

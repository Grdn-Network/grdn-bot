// commands/crewname.js
const { SlashCommandBuilder } = require('discord.js');
const storage = require('../storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crewname')
        .setDescription('Rename your crew VC to your assigned train number.'),

    async execute(interaction) {
        const member = interaction.member;
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({
                content: '❌ You must be in a voice channel to use this.',
                flags: 64
            });
        }

        const vc = storage.getCrewVCByChannel(voiceChannel.id);
        if (!vc) {
            return interaction.reply({
                content: '❌ You must be in a Crew VC to rename it.',
                flags: 64
            });
        }

        const crew = storage.getCrewRaw(interaction.user.id);
        if (!crew?.train_number) {
            return interaction.reply({
                content: '❌ You do not have a train number assigned. Use `/setcrew` first.',
                flags: 64
            });
        }

        const newName = `(${crew.train_number}) | Crew`;
        await voiceChannel.setName(newName).catch(() => {});

        return interaction.reply({
            content: `✅ Channel renamed to **${newName}**.`,
            flags: 64
        });
    }
};

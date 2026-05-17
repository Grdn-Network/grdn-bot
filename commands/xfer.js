// commands/xfer.js
const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const { XFER_ROLES } = require('../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('xfer')
        .setDescription('Request a communications transfer.')
        .addUserOption(option =>
            option.setName('receiver')
                .setDescription('Who you are requesting transfer TO')
                .setRequired(true)
        )
        .addUserOption(option =>
            option.setName('operator')
                .setDescription('Operator requesting transfer')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('destination_info')
                .setDescription('Destination Info (example: HB-FH-76)')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('departing_track')
                .setDescription('Departing track (example: HB-E3O)')
                .setRequired(true)
        ),

    async execute(interaction) {
        const hasPermission = XFER_ROLES.some(role => interaction.member.roles.cache.has(role));
        if (!hasPermission) {
            return interaction.reply({
                content: '❌ You do not have permission to use this command.',
                flags: 64
            });
        }

        const receiver = interaction.options.getUser('receiver');
        const operator = interaction.options.getUser('operator');
        const destinationInfo = interaction.options.getString('destination_info');
        const departingTrack = interaction.options.getString('departing_track');

        const embed = new EmbedBuilder()
            .setTitle('📡 Communications Transfer Request')
            .setColor(0x2b2d31)
            .addFields(
                { name: 'Operator', value: `${operator}`, inline: true },
                { name: 'Receiver', value: `${receiver}`, inline: true },
                { name: 'Destination Info', value: destinationInfo, inline: false },
                { name: 'Departing Track', value: departingTrack, inline: false }
            )
            .setFooter({ text: 'XFER Request' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`xfer_approve_${operator.id}_${receiver.id}_${interaction.user.id}`)
                .setLabel('Approve Transfer')
                .setStyle(ButtonStyle.Success)
        );

        await interaction.reply({
            content: `${receiver}`,
            embeds: [embed],
            components: [row],
            allowedMentions: { users: [receiver.id] }
        });
    }
};
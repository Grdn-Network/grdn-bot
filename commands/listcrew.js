// commands/listcrew.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('listcrew')
        .setDescription('List all registered crew members grouped by type.'),

    async execute(interaction) {
        const crew = storage.getAllCrew(interaction.guild.id);

        if (crew.length === 0) {
            return interaction.reply({ content: '❌ No crew members are registered yet.', flags: 64 });
        }

        const dispatchers = [];
        const shunters = [];
        const roadcrew = [];
        const unassigned = [];

        for (const row of crew) {
            const entry = `• <@${row.userId}>`;
            if (!row.type || row.type.trim() === '') {
                unassigned.push(entry);
                continue;
            }
            if (row.type === 'Dispatcher') dispatchers.push(entry);
            else if (row.type === 'Shunter') shunters.push(entry);
            else if (row.type === 'Road Crew') roadcrew.push(entry);
            else unassigned.push(entry);
        }

        const embed = new EmbedBuilder()
            .setTitle('🚆 Registered Crew Members')
            .setColor(0x2b2d31)
            .setTimestamp()
            .setFooter({ text: 'Crew Registration System' });

        function addFields(label, entries) {
            if (entries.length === 0) return;
            const chunks = [];
            let current = '';
            for (const entry of entries) {
                const line = current ? '\n' + entry : entry;
                if ((current + line).length > 1024) {
                    chunks.push(current);
                    current = entry;
                } else {
                    current += line;
                }
            }
            if (current) chunks.push(current);
            chunks.forEach((chunk, i) => {
                embed.addFields({
                    name: i === 0 ? label : `${label} (cont.)`,
                    value: chunk,
                    inline: false
                });
            });
        }

        addFields('🟦 Dispatchers', dispatchers);
        addFields('🟩 Shunters', shunters);
        addFields('🟨 Road Crew', roadcrew);
        addFields('⚪ Unassigned', unassigned);

        return interaction.reply({ embeds: [embed], flags: 64 });
    }
};
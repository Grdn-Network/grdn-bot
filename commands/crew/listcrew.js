// commands/crew/listcrew.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const storage = require('../../database/storage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('listcrew')
        .setDescription('List all registered crew members.'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const crew = storage.getAllCrew(interaction.guild.id);
        if (crew.length === 0) {
            return interaction.editReply('❌ No crew members are registered yet.');
        }

        const trainmasters = [];
        const dispatchers  = [];
        const yardCrew     = [];
        const roadCrew     = [];
        const unassigned   = [];

        for (const row of crew) {
            // err.code 10007 = Unknown Member (definitively not in server)
            // Any other error (rate limit, network, etc.) → undefined → skip but don't prune
            const member = await interaction.guild.members.fetch(row.userId)
                .catch(err => err.code === 10007 ? null : undefined);
            if (member === null) {
                storage.removeCrew(row.userId); // confirmed left — soft-remove
                continue;
            }
            if (member === undefined) continue; // fetch error — skip display, keep record

            const hasTrainNumber = row.trainNumber && row.trainNumber.trim() !== '';

            if (!hasTrainNumber) {
                unassigned.push(`• <@${row.userId}> *(${row.type || 'No type'})*`);
                continue;
            }

            const entry = `• \`${row.trainNumber}\` — <@${row.userId}>`;

            if (row.type === 'TrainMaster') trainmasters.push(entry);
            else if (row.type === 'Dispatcher') dispatchers.push(entry);
            else if (row.type === 'Yard Crew')  yardCrew.push(entry);
            else if (row.type === 'Road Crew')  roadCrew.push(entry);
            else unassigned.push(`• <@${row.userId}>`);
        }

        const embed = new EmbedBuilder()
            .setTitle('🚆 Registered Crew')
            .setColor(0x2b2d31)
            .setTimestamp()
            .setFooter({ text: 'GRDN Crew System' });

        function addFields(label, entries) {
            if (entries.length === 0) return;
            let current = '';
            let first = true;
            for (const entry of entries) {
                const line = current ? '\n' + entry : entry;
                if ((current + line).length > 1024) {
                    embed.addFields({ name: first ? label : `${label} (cont.)`, value: current, inline: false });
                    current = entry;
                    first = false;
                } else {
                    current += line;
                }
            }
            if (current) embed.addFields({ name: first ? label : `${label} (cont.)`, value: current, inline: false });
        }

        addFields('🎖️ TrainMaster', trainmasters);
        addFields('📡 Dispatcher',  dispatchers);
        addFields('🚧 Yard Crew',   yardCrew);
        addFields('🚂 Road Crew',   roadCrew);
        addFields('⚪ Unassigned',  unassigned);

        if (!embed.data.fields || embed.data.fields.length === 0) {
            return interaction.editReply('❌ No crew members found in this server.');
        }

        return interaction.editReply({ embeds: [embed] });
    }
};

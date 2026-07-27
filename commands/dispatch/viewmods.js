// commands/dispatch/viewmods.js
// Preview any preset's mod list without swapping to it. Ephemeral (only the
// runner sees it) and read-only: it never activates the preset or touches the
// live ops embed. Open to everyone.
//
// Renders through the same buildModFields helper the ops embed uses, so a
// preview looks exactly like the Required Mods section of ops-info.

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
    getActivePreset, getPresetByName, listPresetNames, getPresetMods,
} = require('../../utils/presets');
const { buildModFields } = require('../../utils/dispatchEmbed');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('viewmods')
        .setDescription("Preview a preset's mod list (only you see it).")
        .addStringOption(o =>
            o.setName('preset')
                .setDescription('Which preset to view (defaults to the active one)')
                .setAutocomplete(true)
        ),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = listPresetNames()
            .filter(n => n.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(n => ({ name: n, value: n }));
        await interaction.respond(choices);
    },

    async execute(interaction) {
        const name = interaction.options.getString('preset');
        const preset = name ? getPresetByName(name) : getActivePreset();

        if (!preset) {
            return interaction.reply({
                content: name ? `❌ No preset named **${name}**.` : '❌ No active preset is set.',
                flags: 64,
            });
        }

        const mods = getPresetMods(preset.id);
        const activeTag = preset.active ? ' · active' : '';
        const fields = buildModFields(mods, `📦 Required Mods (${preset.name})`);

        const embed = new EmbedBuilder()
            .setTitle(`🚂 Preset: ${preset.name}${activeTag}`)
            .setColor(0x2b2d31)
            .addFields(...fields)
            .setFooter({ text: `${mods.length} mod${mods.length === 1 ? '' : 's'}` })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};

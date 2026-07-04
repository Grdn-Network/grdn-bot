// commands/dispatch/preset.js
// /preset name:<text>
//   New name  -> saves the current mods as that preset and makes it active.
//   Existing  -> saves current mods into the active preset, then loads the chosen one.
// Presets are deleted manually in the DB. Admins/hosts only. See issue #7.

const { SlashCommandBuilder } = require('discord.js');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE } = require('../../config');
const {
    getActivePreset, getPresetByName, listPresetNames,
    snapshotModsToPreset, loadPresetIntoMods, createPresetFromCurrentMods, setActivePreset,
} = require('../../utils/presets');
const { refreshOpsEmbed } = require('../../utils/modOps');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('preset')
        .setDescription('Save or switch a mod preset for the Operations embed.')
        .addStringOption(o => o
            .setName('name')
            .setDescription('Preset to apply, or a new name to save the current mods as')
            .setRequired(true)
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
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE])) {
            return interaction.reply({ content: '❌ Only admins and hosts can manage presets.', flags: 64 });
        }

        const name   = interaction.options.getString('name').trim();
        const target = getPresetByName(name);
        const active = getActivePreset();

        // New preset: save current mods as it, make it active
        if (!target) {
            const newId = createPresetFromCurrentMods(name);
            setActivePreset(newId);
            await refreshOpsEmbed(interaction);
            return interaction.reply({
                content: `✅ Saved the current mods as new preset **${name}**. It is now the active preset.`,
                flags: 64,
            });
        }

        // Already active
        if (active && target.id === active.id) {
            snapshotModsToPreset(target.id); // keep it in sync just in case
            return interaction.reply({ content: `**${target.name}** is already the active preset.`, flags: 64 });
        }

        // Switch: save current into the active preset, then load the chosen one
        await interaction.deferReply({ flags: 64 });
        if (active) snapshotModsToPreset(active.id);
        loadPresetIntoMods(target.id);
        setActivePreset(target.id);
        await refreshOpsEmbed(interaction);

        const savedNote = active ? `Saved **${active.name}**, and ` : '';
        return interaction.editReply({
            content: `✅ ${savedNote}now showing preset **${target.name}**.`,
        });
    },
};

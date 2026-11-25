// commands/dispatch/mod.js
// /mod action:[add|edit|remove] name: [version:] [url:] [note:]
//
//   add    — add a new mod (or fully update an existing one)
//   edit   — update specific fields of a mod (leave others untouched)
//   remove — delete a mod from the list
//
// Every change is confirmed first (it modifies the active preset), then applied
// and saved back into that preset. Whole mod setups are managed with /preset.

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../../database/db');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE } = require('../../config');
const { getActivePreset } = require('../../utils/presets');
const modPending = require('../../utils/modPending');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mod')
        .setDescription('Manage the Required Mods section of the Operations embed.')
        .addStringOption(o => o
            .setName('action')
            .setDescription('What to do')
            .setRequired(true)
            .addChoices(
                { name: 'Add — add or fully update a mod',        value: 'add'    },
                { name: 'Edit — update specific fields of a mod', value: 'edit'   },
                { name: 'Remove — delete a mod from the list',    value: 'remove' },
                { name: 'Category - move a mod between sections', value: 'category' },
            )
        )
        .addStringOption(o => o
            .setName('name')
            .setDescription('Mod name (autocompletes existing mods)')
            .setRequired(true)
            .setAutocomplete(true)
        )
        .addStringOption(o => o
            .setName('version')
            .setDescription('Version number (e.g. 0.14.2), shown as "v0.14.2". Use "clear" to remove.')
            .setRequired(false)
        )
        .addStringOption(o => o
            .setName('url')
            .setDescription('Download / info link (must start with http:// or https://). Use "clear" to remove.')
            .setRequired(false)
        )
        .addStringOption(o => o
            .setName('note')
            .setDescription('Short note shown after the link. Use "clear" to remove.')
            .setRequired(false)
        )
        .addStringOption(o => o
            .setName('category')
            .setDescription('Which section the mod sits in (used with the Category action)')
            .setRequired(false)
            .addChoices(
                { name: 'Required',          value: 'required' },
                { name: 'Client / Optional', value: 'optional' },
                { name: 'Host Only',         value: 'host'     },
            )
        ),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const mods = db.prepare(`SELECT name FROM mods ORDER BY sort_order, id`).all();
        const choices = mods
            .filter(m => m.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(m => ({ name: m.name, value: m.name }));
        await interaction.respond(choices);
    },

    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE])) {
            return interaction.reply({ content: '❌ Only admins and hosts can manage mods.', flags: 64 });
        }

        const action = interaction.options.getString('action');
        const name   = interaction.options.getString('name').trim();

        // Build + validate a normalized payload for the chosen action
        let payload;

        if (action === 'add') {
            const url     = interaction.options.getString('url')?.trim()     || null;
            const version = interaction.options.getString('version')?.trim() || null;
            const note    = interaction.options.getString('note')?.trim()    || null;
            if (url && !/^https?:\/\/.+/i.test(url)) {
                return interaction.reply({ content: '❌ URL must start with `http://` or `https://`.', flags: 64 });
            }
            payload = { action, name, url, version, note };

        } else if (action === 'edit') {
            const existing = db.prepare(`SELECT * FROM mods WHERE name = ? COLLATE NOCASE`).get(name);
            if (!existing) {
                return interaction.reply({ content: `❌ No mod named **${name}** found. Use autocomplete or check the spelling.`, flags: 64 });
            }
            const rawUrl     = interaction.options.getString('url');
            const rawVersion = interaction.options.getString('version');
            const rawNote    = interaction.options.getString('note');
            const url     = rawUrl     === null ? existing.url     : (rawUrl.toLowerCase()     === 'clear' ? null : rawUrl.trim());
            const version = rawVersion === null ? existing.version : (rawVersion.toLowerCase() === 'clear' ? null : rawVersion.trim());
            const note    = rawNote    === null ? existing.note    : (rawNote.toLowerCase()    === 'clear' ? null : rawNote.trim());
            if (url && !/^https?:\/\/.+/i.test(url)) {
                return interaction.reply({ content: '❌ URL must start with `http://` or `https://`.', flags: 64 });
            }
            payload = { action, name: existing.name, modId: existing.id, url, version, note };

        } else if (action === 'remove') {
            const existing = db.prepare(`SELECT id, name FROM mods WHERE name = ? COLLATE NOCASE`).get(name);
            if (!existing) {
                return interaction.reply({ content: `❌ No mod named **${name}** found. Use autocomplete or check the spelling.`, flags: 64 });
            }
            payload = { action, name: existing.name, modId: existing.id };

        } else { // category
            const existing = db.prepare(`SELECT id, name FROM mods WHERE name = ? COLLATE NOCASE`).get(name);
            if (!existing) {
                return interaction.reply({ content: `❌ No mod named **${name}** found. Use autocomplete or check the spelling.`, flags: 64 });
            }
            const category = interaction.options.getString('category');
            if (!category) {
                return interaction.reply({ content: '❌ Choose a `category` for this action (Required / Client / Optional / Host).', flags: 64 });
            }
            payload = { action, name: existing.name, modId: existing.id, category };
        }

        // Stash and ask for confirmation, naming the active preset that will change
        const active = getActivePreset();
        const presetLabel = active ? `**${active.name}**` : 'the current mods';
        const CAT_LABEL = { required: 'Required', optional: 'Client / Optional', host: 'Host Only' };
        const verb = action === 'add' ? 'add/update'
            : action === 'category' ? `move to ${CAT_LABEL[payload.category]}`
            : action;

        const id = modPending.put(interaction.user.id, payload);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`mod_confirm:${id}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`mod_cancel:${id}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        return interaction.reply({
            content: `You are about to **${verb}** **${payload.name}**. This updates preset ${presetLabel}. Confirm?`,
            components: [row],
            flags: 64,
        });
    },
};

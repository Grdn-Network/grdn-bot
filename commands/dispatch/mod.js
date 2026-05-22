// commands/dispatch/mod.js
// /mod action:[add|edit|remove] name: [version:] [url:] [note:]
//
//   add    — add a new mod (or fully update an existing one)
//   edit   — surgically update specific fields (leave others untouched)
//   remove — delete a mod from the list
//
// name autocompletes from existing mods for all three actions.

const { SlashCommandBuilder } = require('discord.js');
const db = require('../../database/db');
const { buildDispatchEmbed } = require('../../utils/dispatchEmbed');
const { hasAnyRole } = require('../../utils/permissions');
const { ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE, DISPATCH_CHANNEL_ID } = require('../../config');

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
            .setDescription('Version number (e.g. 0.14.2) — shown as "v0.14.2". Use "clear" to remove.')
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
        ),

    // ── Autocomplete ──────────────────────────────────────────────────────────
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const mods = db.prepare(`SELECT name FROM mods ORDER BY sort_order, id`).all();
        const choices = mods
            .filter(m => m.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(m => ({ name: m.name, value: m.name }));
        await interaction.respond(choices);
    },

    // ── Execute ───────────────────────────────────────────────────────────────
    async execute(interaction) {
        if (!hasAnyRole(interaction.member, [ADMIN_ROLE, HOST_ROLE, DVMP_COMMAND_ROLE])) {
            return interaction.reply({ content: '❌ Only admins and hosts can manage mods.', flags: 64 });
        }

        const action = interaction.options.getString('action');
        if (action === 'add')    return handleAdd(interaction);
        if (action === 'edit')   return handleEdit(interaction);
        if (action === 'remove') return handleRemove(interaction);
    },
};

// ── add ───────────────────────────────────────────────────────────────────────

async function handleAdd(interaction) {
    const name    = interaction.options.getString('name').trim();
    const url     = interaction.options.getString('url')?.trim()     || null;
    const version = interaction.options.getString('version')?.trim() || null;
    const note    = interaction.options.getString('note')?.trim()    || null;

    if (url && !/^https?:\/\/.+/i.test(url)) {
        return interaction.reply({ content: '❌ URL must start with `http://` or `https://`.', flags: 64 });
    }

    const existing = db.prepare(`SELECT id FROM mods WHERE name = ? COLLATE NOCASE`).get(name);

    if (existing) {
        db.prepare(`UPDATE mods SET url = ?, version = ?, note = ? WHERE id = ?`)
            .run(url, version, note, existing.id);
    } else {
        const { m: maxOrder } = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM mods`).get();
        db.prepare(`INSERT INTO mods (name, url, version, note, sort_order) VALUES (?, ?, ?, ?, ?)`)
            .run(name, url, version, note, maxOrder + 1);
    }

    await rebuildEmbed(interaction);
    return interaction.reply({
        content: modListReply(existing ? 'Updated' : 'Added', name),
        flags: 64,
    });
}

// ── edit ──────────────────────────────────────────────────────────────────────

async function handleEdit(interaction) {
    const name     = interaction.options.getString('name').trim();
    const existing = db.prepare(`SELECT * FROM mods WHERE name = ? COLLATE NOCASE`).get(name);

    if (!existing) {
        return interaction.reply({
            content: `❌ No mod named **${name}** found. Use autocomplete or check the spelling.`,
            flags: 64,
        });
    }

    // Only update fields that were explicitly provided; leave others untouched.
    // Passing "clear" removes the field.
    const rawUrl     = interaction.options.getString('url');
    const rawVersion = interaction.options.getString('version');
    const rawNote    = interaction.options.getString('note');

    const newUrl     = rawUrl     === null ? existing.url     : (rawUrl.toLowerCase()     === 'clear' ? null : rawUrl.trim());
    const newVersion = rawVersion === null ? existing.version : (rawVersion.toLowerCase() === 'clear' ? null : rawVersion.trim());
    const newNote    = rawNote    === null ? existing.note    : (rawNote.toLowerCase()    === 'clear' ? null : rawNote.trim());

    if (newUrl && !/^https?:\/\/.+/i.test(newUrl)) {
        return interaction.reply({ content: '❌ URL must start with `http://` or `https://`.', flags: 64 });
    }

    db.prepare(`UPDATE mods SET url = ?, version = ?, note = ? WHERE id = ?`)
        .run(newUrl, newVersion, newNote, existing.id);

    await rebuildEmbed(interaction);
    return interaction.reply({
        content: modListReply('Edited', existing.name),
        flags: 64,
    });
}

// ── remove ────────────────────────────────────────────────────────────────────

async function handleRemove(interaction) {
    const name     = interaction.options.getString('name').trim();
    const existing = db.prepare(`SELECT id FROM mods WHERE name = ? COLLATE NOCASE`).get(name);

    if (!existing) {
        return interaction.reply({
            content: `❌ No mod named **${name}** found. Use autocomplete or check the spelling.`,
            flags: 64,
        });
    }

    db.prepare(`DELETE FROM mods WHERE id = ?`).run(existing.id);

    await rebuildEmbed(interaction);
    return interaction.reply({
        content: modListReply('Removed', name),
        flags: 64,
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function rebuildEmbed(interaction) {
    try {
        const embedRow = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
        if (!embedRow) return;
        const channel = interaction.guild.channels.cache.get(DISPATCH_CHANNEL_ID);
        if (!channel) return;
        const msg = await channel.messages.fetch(embedRow.message_id).catch(() => null);
        if (msg) await msg.edit({ embeds: [buildDispatchEmbed()], components: msg.components });
    } catch (err) {
        console.error('[mod] Embed rebuild failed:', err);
    }
}

function modListReply(action, name) {
    const allMods = db.prepare(
        `SELECT name, url, version, note FROM mods ORDER BY sort_order, id`
    ).all();

    if (allMods.length === 0) {
        return `✅ ${action} **${name}**.\n\n_No mods remaining in list._`;
    }

    const list = allMods.map((m, i) => {
        let line = `${i + 1}. **${m.name}**`;
        if (m.version) line += ` v${m.version}`;
        if (m.url)     line += ` — <${m.url}>`;
        if (m.note)    line += ` *(${m.note})*`;
        return line;
    }).join('\n');

    return `✅ ${action} **${name}**.\n\n**Current mod list:**\n${list}`;
}

// commands/dispatch/mod.js
// /mod action:[add|edit|remove|toggle] name: [version:] [url:] [note:]
//
//   add    — add a new mod (or fully update an existing one)
//   edit   — surgically update specific fields (leave others untouched)
//   remove — delete a mod permanently
//   toggle — flip official ↔ unofficial
//              • official mods appear in the Operations embed (required mods)
//              • unofficial mods are hidden from the embed but kept in DB
//                so hosts can experiment and flip back with one command
//
// name autocompletes from all mods (official and unofficial) for all actions.

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
                { name: 'Add — add or fully update a mod',                      value: 'add'    },
                { name: 'Edit — update specific fields of a mod',               value: 'edit'   },
                { name: 'Remove — delete a mod from the list',                  value: 'remove' },
                { name: 'Toggle — flip official ↔ unofficial (embed on/off)',   value: 'toggle' },
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

    // ── Autocomplete — show all mods (official and unofficial) ────────────────
    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const mods = db.prepare(`SELECT name, official FROM mods ORDER BY official DESC, sort_order, id`).all();
        const choices = mods
            .filter(m => m.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(m => ({
                name: m.official ? m.name : `⚗️ ${m.name} (unofficial)`,
                value: m.name,
            }));
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
        if (action === 'toggle') return handleToggle(interaction);
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
        // Fully update — also restore to official if it was unofficial
        db.prepare(`UPDATE mods SET url = ?, version = ?, note = ?, official = 1 WHERE id = ?`)
            .run(url, version, note, existing.id);
    } else {
        const { m: maxOrder } = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM mods`).get();
        db.prepare(`INSERT INTO mods (name, url, version, note, sort_order, official) VALUES (?, ?, ?, ?, ?, 1)`)
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

// ── toggle ────────────────────────────────────────────────────────────────────

async function handleToggle(interaction) {
    const name     = interaction.options.getString('name').trim();
    const existing = db.prepare(`SELECT id, name, official FROM mods WHERE name = ? COLLATE NOCASE`).get(name);

    if (!existing) {
        return interaction.reply({
            content: `❌ No mod named **${name}** found. Use autocomplete or check the spelling.`,
            flags: 64,
        });
    }

    const nowOfficial = existing.official ? 0 : 1;
    db.prepare(`UPDATE mods SET official = ? WHERE id = ?`).run(nowOfficial, existing.id);

    await rebuildEmbed(interaction);

    const label   = nowOfficial ? 'official — will now appear in the embed' : 'unofficial — hidden from embed';
    return interaction.reply({
        content: modListReply(`Toggled **${existing.name}** → ${label}.\n`, ''),
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
        `SELECT name, url, version, note, official FROM mods ORDER BY official DESC, sort_order, id`
    ).all();

    if (allMods.length === 0) {
        return `✅ ${action}${name ? ` **${name}**` : ''}.\n\n_No mods in list._`;
    }

    const official   = allMods.filter(m => m.official);
    const unofficial = allMods.filter(m => !m.official);

    const fmt = (m, i) => {
        let line = `${i + 1}. **${m.name}**`;
        if (m.version) line += ` v${m.version}`;
        if (m.url)     line += ` — <${m.url}>`;
        if (m.note)    line += ` *(${m.note})*`;
        return line;
    };

    let out = `✅ ${action}${name ? `**${name}**` : ''}\n\n`;

    if (official.length > 0) {
        out += `**📦 Official (in embed):**\n${official.map(fmt).join('\n')}`;
    } else {
        out += `**📦 Official (in embed):**\n_none_`;
    }

    if (unofficial.length > 0) {
        out += `\n\n**⚗️ Unofficial (hidden from embed):**\n${unofficial.map(fmt).join('\n')}`;
    }

    return out;
}

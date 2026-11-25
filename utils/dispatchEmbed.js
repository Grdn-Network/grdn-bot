// utils/dispatchEmbed.js
// Single source of truth for the GRDN Operations embed.
// Every command that reads or writes the embed goes through here,
// so the DB and the Discord message are always in sync.

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/db');

/**
 * Reads all dispatch_settings and returns a fully-built EmbedBuilder.
 * Sections (top → bottom):
 *   📋 Setup          — editable, static instructions
 *   📦 Required Mods  — editable, mod list with links
 *   📡 Remote Dispatch Setup — editable, RD username instructions
 *   Server Name / Server Password (inline)
 *   Remote Dispatch Link
 *   Remote Dispatch Password
 */
function buildDispatchEmbed() {
    const s = db.prepare(`
        SELECT server_name, server_password, remote_link, remote_password,
               setup_notes, rd_setup, ops_active
        FROM dispatch_settings WHERE id = 1
    `).get() || {};

    const opsActive = !!s.ops_active;

    // Only official mods appear in the public embed, split into category sections.
    const mods = db.prepare(
        `SELECT name, url, version, note, category FROM mods WHERE official = 1 ORDER BY sort_order, id`
    ).all();
    const activePreset = db.prepare(`SELECT name FROM presets WHERE active = 1 LIMIT 1`).get();
    const presetSuffix = activePreset ? ` (${activePreset.name})` : '';
    const modFields = buildModSections(mods, presetSuffix);

    return new EmbedBuilder()
        .setTitle('🚂 GRDN Operations')
        .setColor(0x2b2d31)
        .addFields(
            { name: '📋 Setup',                value: s.setup_notes || 'Not configured.', inline: false },
            ...modFields,
            { name: '📡 Remote Dispatch Setup', value: s.rd_setup    || 'Not configured.', inline: false },
            { name: 'Server Name',             value: opsActive ? (s.server_name     || 'Not set') : '—', inline: true  },
            { name: 'Server Password',         value: opsActive ? (s.server_password || 'Not set') : '—', inline: true  },
            { name: 'Remote Dispatch Link',    value: opsActive ? (s.remote_link     || 'Not set') : 'No operation started — check the Events tab for the next session.', inline: false },
            { name: 'Remote Dispatch Password', value: s.remote_password || 'GRDN',    inline: true  }
        )
        .setTimestamp();
}

// Formats one mod row the way the ops embed shows it: linked name, version,
// note. Shared so /viewmods renders a preset identically to the live embed.
function formatModLine(m) {
    let line = m.url ? `[${m.name}](${m.url})` : m.name;
    if (m.version) line += ` v${m.version}`;
    if (m.note) line += ` (${m.note})`;
    return line;
}

// Builds the Required Mods embed field(s) for a set of mod rows, splitting
// across fields to stay under the 1024-char limit. Used by both the live ops
// embed and /viewmods so they always match.
function buildModFields(mods, baseName) {
    if (!mods.length) {
        return [{ name: baseName, value: 'No mods configured. Use `/mod add` to add required mods.', inline: false }];
    }
    return chunkFields(mods.map(formatModLine), baseName);
}

// Splits a mod list into the three ops-embed sections by category:
// Required, Client / Optional, Host Only. Empty sections are omitted, so with
// everything defaulting to 'required' the embed looks exactly as it did before.
// presetSuffix (e.g. " (Metro)") is appended to the Required header only.
function buildModSections(mods, presetSuffix = '') {
    const inCategory = (c) => mods.filter(m => (m.category || 'required') === c);

    if (mods.length === 0) {
        return buildModFields([], `📦 Required Mods${presetSuffix}`);
    }

    const sections = [
        { cat: 'required', name: `📦 Required Mods${presetSuffix}` },
        { cat: 'optional', name: '🧩 Client / Optional' },
        { cat: 'host',     name: '🖥️ Host Only' },
    ];

    return sections.flatMap(({ cat, name }) => {
        const group = inCategory(cat);
        return group.length ? buildModFields(group, name) : [];
    });
}

// Packs the given lines into a sequence of embed-field objects, each with a
// value under Discord's 1024-char limit. The first field keeps baseName; any
// overflow fields are labelled "(cont.)". A single line longer than the limit
// is hard-truncated so one bad entry can't break the whole embed.
const FIELD_VALUE_LIMIT = 1024;
function chunkFields(lines, baseName) {
    const fields = [];
    let current = '';
    for (const raw of lines) {
        const line = raw.length > FIELD_VALUE_LIMIT ? raw.slice(0, FIELD_VALUE_LIMIT) : raw;
        if (current === '') {
            current = line;
        } else if (current.length + 1 + line.length <= FIELD_VALUE_LIMIT) {
            current += `\n${line}`;
        } else {
            fields.push(current);
            current = line;
        }
    }
    if (current !== '') fields.push(current);

    return fields.map((value, i) => ({
        name: i === 0 ? baseName : `${baseName} (cont.)`,
        value,
        inline: false,
    }));
}

/**
 * The button row that lives below the embed.
 * Returned as an array so it can be spread directly into components: [].
 */
function buildDispatchComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('startop_btn')
                .setLabel('Start Operation')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('endop_btn')
                .setLabel('End Operation')
                .setStyle(ButtonStyle.Danger)
        )
    ];
}

/**
 * Derives the GRDNConnect URL from a Remote Dispatch link.
 * e.g. grdn.grdnnetwork.com → https://grdn-connect.grdnnetwork.com
 * Returns null if the link isn't a recognised grdnnetwork.com subdomain.
 */
function deriveDvConnectUrl(rdLink) {
    try {
        const raw = rdLink.trim();
        const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        if (!url.hostname.endsWith('.grdnnetwork.com')) return null;
        const hostName = url.hostname.split('.')[0];
        if (!hostName || hostName.endsWith('-connect')) return null;
        return `https://${hostName}-connect.grdnnetwork.com`;
    } catch {
        return null;
    }
}

module.exports = { buildDispatchEmbed, buildModFields, buildModSections, buildDispatchComponents, deriveDvConnectUrl };

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

    // Build mods section — only official mods appear in the public embed
    const mods = db.prepare(
        `SELECT name, url, version, note FROM mods WHERE official = 1 ORDER BY sort_order, id`
    ).all();
    const modsValue = mods.length === 0
        ? 'No mods configured — use `/mod add` to add required mods.'
        : mods.map(m => {
            let line = m.url ? `[${m.name}](${m.url})` : m.name;
            if (m.version) line += ` v${m.version}`;
            if (m.note) line += ` — ${m.note}`;
            return line;
          }).join('\n');

    return new EmbedBuilder()
        .setTitle('🚂 GRDN Operations')
        .setColor(0x2b2d31)
        .addFields(
            { name: '📋 Setup',                value: s.setup_notes || 'Not configured.', inline: false },
            { name: '📦 Required Mods',        value: modsValue,                          inline: false },
            { name: '📡 Remote Dispatch Setup', value: s.rd_setup    || 'Not configured.', inline: false },
            { name: 'Server Name',             value: opsActive ? (s.server_name     || 'Not set') : '—', inline: true  },
            { name: 'Server Password',         value: opsActive ? (s.server_password || 'Not set') : '—', inline: true  },
            { name: 'Remote Dispatch Link',    value: opsActive ? (s.remote_link     || 'Not set') : 'No operation started — check the Events tab for the next session.', inline: false },
            { name: 'Remote Dispatch Password', value: s.remote_password || 'GRDN',    inline: true  }
        )
        .setTimestamp();
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

module.exports = { buildDispatchEmbed, buildDispatchComponents, deriveDvConnectUrl };

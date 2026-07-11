// utils/modOps.js
// Applies a validated /mod change to the live `mods` table, then re-saves the
// active preset. Shared by the /mod confirm button so the command and the
// button stay in lockstep.

const db = require('../database/db');
const { DISPATCH_CHANNEL_ID } = require('../config');
const { buildDispatchEmbed } = require('./dispatchEmbed');
const { syncActivePreset } = require('./presets');

// payload (already validated): { action, name, url, version, note, modId? }
function applyMod(payload) {
    const { action, name } = payload;

    if (action === 'add') {
        const existing = db.prepare(`SELECT id FROM mods WHERE name = ? COLLATE NOCASE`).get(name);
        if (existing) {
            db.prepare(`UPDATE mods SET url = ?, version = ?, note = ?, official = 1 WHERE id = ?`)
                .run(payload.url, payload.version, payload.note, existing.id);
        } else {
            const { m } = db.prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM mods`).get();
            db.prepare(`INSERT INTO mods (name, url, version, note, sort_order, official) VALUES (?, ?, ?, ?, ?, 1)`)
                .run(name, payload.url, payload.version, payload.note, m + 1);
        }
    } else if (action === 'edit') {
        db.prepare(`UPDATE mods SET url = ?, version = ?, note = ? WHERE id = ?`)
            .run(payload.url, payload.version, payload.note, payload.modId);
    } else if (action === 'remove') {
        db.prepare(`DELETE FROM mods WHERE id = ?`).run(payload.modId);
    }

    // Mirror the change into the active preset
    return syncActivePreset(); // returns the active preset row (or null)
}

async function refreshOpsEmbed(interaction) {
    try {
        const embedRow = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
        if (!embedRow) return;
        const channel = interaction.guild.channels.cache.get(DISPATCH_CHANNEL_ID);
        if (!channel) return;
        const msg = await channel.messages.fetch(embedRow.message_id).catch(() => null);
        if (msg) await msg.edit({ embeds: [buildDispatchEmbed()], components: msg.components });
    } catch (err) {
        console.error('[modOps] embed refresh failed:', err);
    }
}

function buildModListReply(action, name) {
    const allMods = db.prepare(
        `SELECT name, url, version, note, official FROM mods ORDER BY official DESC, sort_order, id`
    ).all();

    const fmt = (m, i) => {
        let line = `${i + 1}. **${m.name}**`;
        if (m.version) line += ` v${m.version}`;
        if (m.url)     line += ` <${m.url}>`;
        if (m.note)    line += ` *(${m.note})*`;
        return line;
    };

    const header = `✅ ${action}${name ? ` **${name}**` : ''}\n\n`;
    if (allMods.length === 0) return header + `_No mods in the list._`;

    // Discord caps message content at 2000 chars, and the confirm button appends
    // a "Preset ... was also updated" line after this. Stay well under the cap and
    // truncate the list with a summary if it would overflow. Without this, a long
    // mod list made editReply throw AFTER the change had already been saved, which
    // surfaced as a false "An error occurred". The full list lives in the embed.
    const LIMIT = 1800;
    let out = header + `**📦 Mods (${allMods.length}):**\n`;
    const lines = allMods.map(fmt);
    let shown = 0;
    for (const line of lines) {
        const piece = shown === 0 ? line : `\n${line}`;
        if (out.length + piece.length > LIMIT) break;
        out += piece;
        shown++;
    }
    if (shown < lines.length) {
        out += `\n_+${lines.length - shown} more not shown (full list is in the Operations embed)._`;
    }
    return out;
}

module.exports = { applyMod, refreshOpsEmbed, buildModListReply };

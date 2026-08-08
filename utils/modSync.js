// utils/modSync.js
// BETA. Turns a scanned mod list (from GRDNConnect's read of DVMP's
// ModCompatibilityManager) into the "Auto Sync" preset, categorized.
//
// Merge rules (see grdn-bot #11):
//   - version + category come from the scan (authoritative).
//   - url + display name are preserved from what's already stored for that
//     mod_id, so links/names you curated once are never lost on a re-scan.
//   - a scanned github/nexus homepage is normalized toward its releases/files
//     page and used only when nothing is stored yet.
// Mods are paired by mod_id, never by display name.

const db = require('../database/db');
const { SYNC_PRESET_NAME } = require('../config');
const { loadPresetIntoMods } = require('./presets');

const VALID_CATEGORIES = new Set(['required', 'optional', 'host']);

function normalizeCategory(c) {
    const v = String(c || '').toLowerCase();
    return VALID_CATEGORIES.has(v) ? v : 'required';
}

// Point a bare github repo URL at its releases page, and a nexus mod page at
// its files tab. Anything already deeper, or any other host, is left as-is.
function normalizeModUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase().replace(/^www\./, '');
        const parts = u.pathname.split('/').filter(Boolean);
        if (host === 'github.com') {
            // /user/repo -> /user/repo/releases; leave deeper paths untouched.
            if (parts.length === 2) return `https://github.com/${parts[0]}/${parts[1]}/releases`;
            return url;
        }
        if (host === 'nexusmods.com') {
            if (!/tab=/.test(u.search)) return `${u.origin}${u.pathname}?tab=files`;
            return url;
        }
        return url;
    } catch {
        return url;
    }
}

// Ensures the Auto Sync preset row exists; returns it.
function ensureSyncPreset() {
    let preset = db.prepare(`SELECT * FROM presets WHERE name = ? COLLATE NOCASE`).get(SYNC_PRESET_NAME);
    if (!preset) {
        const info = db.prepare(`INSERT INTO presets (name, active, created_at) VALUES (?, 0, ?)`).run(SYNC_PRESET_NAME, Date.now());
        preset = db.prepare(`SELECT * FROM presets WHERE id = ?`).get(info.lastInsertRowid);
    }
    return preset;
}

/**
 * Applies a scanned mod list to the Auto Sync preset. Never throws on bad rows,
 * it skips them. Returns a summary { preset, total, counts, skipped }.
 * @param {Array<{id:string,name?:string,version?:string,url?:string,category?:string}>} mods
 */
function applyScan(mods) {
    if (!Array.isArray(mods)) throw new Error('mods must be an array');

    const preset = ensureSyncPreset();

    // Preserve curated url/name from what's already stored for each mod_id.
    const prev = db.prepare(
        `SELECT mod_id, name, url FROM preset_mods WHERE preset_id = ? AND mod_id IS NOT NULL`
    ).all(preset.id);
    const byId = new Map(prev.map(r => [r.mod_id, r]));

    let skipped = 0;
    const rows = [];
    mods.forEach((m, i) => {
        const id = String(m?.id || '').trim();
        if (!id) { skipped++; return; }
        const prior = byId.get(id);
        const scannedUrl = normalizeModUrl(m.url);
        rows.push({
            mod_id: id,
            name: (prior && prior.name) || (m.name ? String(m.name) : id),
            url: scannedUrl || (prior && prior.url) || '',
            version: m.version ? String(m.version) : null,
            category: normalizeCategory(m.category),
            sort_order: i,
        });
    });

    const write = db.transaction(() => {
        db.prepare(`DELETE FROM preset_mods WHERE preset_id = ?`).run(preset.id);
        const ins = db.prepare(`
            INSERT INTO preset_mods (preset_id, mod_id, name, url, version, note, official, category, sort_order)
            VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)
        `);
        for (const r of rows) ins.run(preset.id, r.mod_id, r.name, r.url, r.version, r.category, r.sort_order);
    });
    write();

    // If Auto Sync happens to be the active preset, mirror into the live list
    // so the ops embed reflects the scan immediately.
    if (db.prepare(`SELECT active FROM presets WHERE id = ?`).get(preset.id)?.active) {
        loadPresetIntoMods(preset.id);
    }

    const counts = rows.reduce((a, r) => { a[r.category] = (a[r.category] || 0) + 1; return a; }, {});
    return { preset: preset.name, total: rows.length, counts, skipped };
}

module.exports = { applyScan, normalizeModUrl, ensureSyncPreset };

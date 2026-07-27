// utils/presets.js
// Mod preset helpers. Each preset holds a full, independent snapshot of the mod
// list (per-preset versions/links/notes). The live `mods` table mirrors the
// active preset. See grdn-bot issue #7.

const db = require('../database/db');

function getActivePreset() {
    return db.prepare(`SELECT * FROM presets WHERE active = 1 LIMIT 1`).get() || null;
}

function getPresetByName(name) {
    return db.prepare(`SELECT * FROM presets WHERE name = ? COLLATE NOCASE`).get(name) || null;
}

function listPresetNames() {
    return db.prepare(`SELECT name FROM presets ORDER BY name COLLATE NOCASE`).all().map(r => r.name);
}

// Overwrite a preset's stored mod set with the current live `mods` table.
const snapshotModsToPreset = db.transaction((presetId) => {
    db.prepare(`DELETE FROM preset_mods WHERE preset_id = ?`).run(presetId);
    const mods = db.prepare(`SELECT name, url, version, note, official, sort_order FROM mods ORDER BY sort_order, id`).all();
    const ins = db.prepare(`INSERT INTO preset_mods (preset_id, name, url, version, note, official, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const m of mods) ins.run(presetId, m.name, m.url, m.version, m.note, m.official, m.sort_order);
});

// Replace the live `mods` table with a preset's stored mod set.
const loadPresetIntoMods = db.transaction((presetId) => {
    const rows = db.prepare(`SELECT name, url, version, note, official, sort_order FROM preset_mods WHERE preset_id = ? ORDER BY sort_order, id`).all(presetId);
    db.prepare(`DELETE FROM mods`).run();
    const ins = db.prepare(`INSERT INTO mods (name, url, version, note, official, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const m of rows) ins.run(m.name, m.url, m.version, m.note, m.official, m.sort_order);
});

// Non-destructive read of a preset's stored mods. Unlike loadPresetIntoMods,
// this does not touch the live `mods` table. Used by /viewmods to preview.
function getPresetMods(presetId) {
    return db.prepare(
        `SELECT name, url, version, note, official, sort_order FROM preset_mods WHERE preset_id = ? ORDER BY sort_order, id`
    ).all(presetId);
}

// Save current mods into the active preset. Called after every /mod edit.
function syncActivePreset() {
    const active = getActivePreset();
    if (active) snapshotModsToPreset(active.id);
    return active;
}

// Create a new preset from the current mods.
function createPresetFromCurrentMods(name) {
    const info = db.prepare(`INSERT INTO presets (name, active, created_at) VALUES (?, 0, ?)`).run(name, Date.now());
    const presetId = info.lastInsertRowid;
    snapshotModsToPreset(presetId);
    return presetId;
}

const setActivePreset = db.transaction((presetId) => {
    db.prepare(`UPDATE presets SET active = 0`).run();
    db.prepare(`UPDATE presets SET active = 1 WHERE id = ?`).run(presetId);
});

module.exports = {
    getActivePreset,
    getPresetByName,
    listPresetNames,
    snapshotModsToPreset,
    loadPresetIntoMods,
    getPresetMods,
    syncActivePreset,
    createPresetFromCurrentMods,
    setActivePreset,
};

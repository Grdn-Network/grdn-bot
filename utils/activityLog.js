// utils/activityLog.js
// Central activity log. Every command, button, and modal that runs through
// interactionHandler is recorded here with the person who ran it and the
// arguments they passed, so any action can be traced back to a user.
//
// Recording is silent and must never interrupt the interaction it is logging,
// so every function here swallows its own errors.
//
// Read side: /activity (admin only). See grdn-bot issue #13.

const db = require('../database/db');

const DETAIL_MAX = 500;
const ERROR_MAX  = 500;

/**
 * Writes one activity row. Never throws.
 * @param {{ guildId?: string|null, userId: string, userTag?: string|null,
 *           kind: 'command'|'button'|'modal', name: string,
 *           detail?: string|null, channelId?: string|null,
 *           status: 'ok'|'error', error?: string|null }} entry
 */
function record(entry) {
    try {
        db.prepare(`
            INSERT INTO activity_log
                (ts, guild_id, user_id, user_tag, kind, name, detail, channel_id, status, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            Date.now(),
            entry.guildId ?? null,
            entry.userId,
            entry.userTag ?? null,
            entry.kind,
            entry.name,
            entry.detail ? String(entry.detail).slice(0, DETAIL_MAX) : null,
            entry.channelId ?? null,
            entry.status,
            entry.error ? String(entry.error).slice(0, ERROR_MAX) : null,
        );
    } catch (err) {
        console.error('[activityLog] record failed:', err.message);
    }
}

/**
 * Flattens a slash command's options into readable text, e.g. "name:MotherF".
 * Subcommand names are included as bare words. Never throws.
 */
function describeOptions(interaction) {
    try {
        const parts = [];
        const walk = (opts) => {
            for (const o of opts ?? []) {
                if (o.options?.length) {
                    parts.push(o.name);
                    walk(o.options);
                } else if (o.value !== undefined && o.value !== null) {
                    parts.push(`${o.name}:${o.value}`);
                } else {
                    parts.push(o.name);
                }
            }
        };
        walk(interaction.options?.data);
        return parts.join(' ') || null;
    } catch {
        return null;
    }
}

/**
 * Flattens a modal submission's fields into readable text. Never throws.
 */
function describeModalFields(interaction) {
    try {
        const parts = [];
        for (const row of interaction.fields?.fields?.values?.() ?? []) {
            parts.push(`${row.customId}:${row.value}`);
        }
        return parts.join(' ') || null;
    } catch {
        return null;
    }
}

/**
 * Recent activity, newest first. Optional filters.
 * @param {{ userId?: string, name?: string, limit?: number }} opts
 */
function query({ userId, name, limit = 15 } = {}) {
    try {
        const where = [];
        const args  = [];
        if (userId) { where.push('user_id = ?'); args.push(userId); }
        if (name)   { where.push('name LIKE ?'); args.push(`%${name}%`); }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        args.push(Math.max(1, Math.min(limit, 25)));
        return db.prepare(`
            SELECT * FROM activity_log ${clause} ORDER BY ts DESC LIMIT ?
        `).all(...args);
    } catch (err) {
        console.error('[activityLog] query failed:', err.message);
        return [];
    }
}

module.exports = { record, describeOptions, describeModalFields, query };

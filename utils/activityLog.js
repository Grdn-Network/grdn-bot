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
const loggingConfig = require('../config/logging.json');

const DETAIL_MAX = 500;
const ERROR_MAX  = 500;

// Live feed settings. Lines are batched into one message every FLUSH_MS so a
// busy op cannot outrun Discord's per-channel rate limit (roughly 5 messages
// per 5 seconds). Nothing is dropped, it just arrives grouped.
const FLUSH_MS    = 3000;
const MESSAGE_MAX = 1900;

let queue        = [];
let flushTimer   = null;
let mirrorClient = null;

// Feed target. Set activityChannel in config/logging.json to split the feed out
// of the main log channel; otherwise it rides along with the other logs.
function feedChannelId() {
    return loggingConfig.activityChannel || loggingConfig.logChannel || null;
}

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

/** One compact feed line for an entry. */
function formatLine(entry) {
    const when = `<t:${Math.floor(Date.now() / 1000)}:T>`;
    const what = entry.kind === 'command' ? `\`/${entry.name}\`` : `\`${entry.name}\``;
    let line = `${when} <@${entry.userId}> ${what}`;
    if (entry.detail)     line += ` \`${String(entry.detail).slice(0, 200)}\``;
    if (entry.channelId)  line += ` in <#${entry.channelId}>`;
    if (entry.status !== 'ok') line += ` ⚠️ ${String(entry.error ?? entry.status).slice(0, 120)}`;
    return line;
}

/** Queues an entry for the live feed. Never throws. */
function mirror(client, entry) {
    try {
        if (!feedChannelId()) return;
        mirrorClient = client;
        queue.push(formatLine(entry));
        if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
    } catch (err) {
        console.error('[activityLog] mirror failed:', err.message);
    }
}

/** Packs queued lines into messages under the 2000-char cap and sends them. */
function flush() {
    flushTimer = null;
    try {
        const id      = feedChannelId();
        const channel = mirrorClient?.channels?.cache?.get(id);
        if (!channel || queue.length === 0) { queue = []; return; }

        const batches = [];
        let current = '';
        for (const line of queue) {
            const piece = current === '' ? line : `\n${line}`;
            if (current.length + piece.length > MESSAGE_MAX) {
                batches.push(current);
                current = line;
            } else {
                current += piece;
            }
        }
        if (current) batches.push(current);
        queue = [];

        for (const content of batches) {
            // parse: [] renders the mentions as names without pinging anyone.
            channel.send({ content, allowedMentions: { parse: [] } })
                .catch(err => console.error('[activityLog] feed send failed:', err.message));
        }
    } catch (err) {
        queue = [];
        console.error('[activityLog] flush failed:', err.message);
    }
}

/** Records to the database and queues the line for the live feed. Never throws. */
function capture(client, entry) {
    record(entry);
    mirror(client, entry);
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

module.exports = { capture, record, describeOptions, describeModalFields, query };

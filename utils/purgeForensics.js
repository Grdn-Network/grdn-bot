// utils/purgeForensics.js
// Records what a purge/ban removed (message text plus attachments) so an admin
// can review it later with /purged. Used by both the /purgeuser command and the
// scam-review Purge button. Retention: saved media is dropped after 7 days,
// the message records (text, links, filenames) are kept for 90 days.

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const storage = require('../database/storage');

const MEDIA_DIR = path.join(__dirname, '..', 'purged_media');
const BOT_ROOT = path.join(__dirname, '..');
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024; // skip saving files larger than this
const MEDIA_RETENTION_DAYS = 7;
const RECORD_RETENTION_DAYS = 90;

async function startPurge({ guild, target, moderator, reason }) {
    return storage.createPurge({
        guildId: guild?.id ?? null,
        targetId: target.id,
        targetTag: target.tag ?? target.username ?? String(target.id),
        moderatorId: moderator?.id ?? null,
        moderatorTag: moderator?.tag ?? moderator?.username ?? null,
        reason: reason ?? null,
    });
}

// Snapshot one message (text + attachments) before it is deleted.
async function capturePurgedMessage(purgeId, message) {
    const attachments = [];
    for (const a of message.attachments.values()) {
        const meta = {
            filename: a.name ?? 'file',
            url: a.url,
            contentType: a.contentType ?? null,
            size: a.size ?? null,
            localPath: null,
        };
        if (!a.size || a.size <= MAX_DOWNLOAD_BYTES) {
            try {
                const res = await fetch(a.url);
                if (res.ok) {
                    const dir = path.join(MEDIA_DIR, String(purgeId));
                    fs.mkdirSync(dir, { recursive: true });
                    const safe = `${message.id}_${meta.filename.replace(/[^\w.\-]/g, '_')}`;
                    const abs = path.join(dir, safe);
                    fs.writeFileSync(abs, Buffer.from(await res.arrayBuffer()));
                    meta.localPath = path.relative(BOT_ROOT, abs).replace(/\\/g, '/');
                }
            } catch {
                // keep URL + metadata only
            }
        }
        attachments.push(meta);
    }

    storage.recordPurgedMessage(purgeId, {
        channelId: message.channelId,
        channelName: message.channel?.name ?? null,
        content: message.content ?? '',
        attachments,
        msgCreatedAt: message.createdTimestamp ?? null,
    });
}

function finishPurge(purgeId, { deletedCount, channelsAffected }) {
    storage.finalizePurge(purgeId, { deletedCount, channelsAffected });
}

// Idempotent: safe to call on every startup and on a daily timer.
function runRetention() {
    try {
        for (const id of storage.getPurgesOlderThan(MEDIA_RETENTION_DAYS)) {
            fs.rmSync(path.join(MEDIA_DIR, String(id)), { recursive: true, force: true });
        }
        for (const id of storage.getPurgesOlderThan(RECORD_RETENTION_DAYS)) {
            fs.rmSync(path.join(MEDIA_DIR, String(id)), { recursive: true, force: true });
            storage.deletePurge(id);
        }
    } catch (err) {
        console.error('[purgeForensics] retention error:', err.message);
    }
}

module.exports = { startPurge, capturePurgedMessage, finishPurge, runRetention, MEDIA_DIR };

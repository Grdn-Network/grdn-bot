// utils/modPending.js
// Short-lived store for a pending /mod change awaiting its confirm button.
// In-memory is fine: if the bot restarts before confirming, the host just
// re-runs the command.

const pending = new Map(); // id -> { userId, payload, createdAt }
const TTL_MS = 2 * 60 * 1000;

function put(userId, payload) {
    const id = Math.random().toString(36).slice(2, 10);
    pending.set(id, { userId, payload, createdAt: Date.now() });
    const t = setTimeout(() => pending.delete(id), TTL_MS);
    if (t.unref) t.unref();
    return id;
}

function take(id) {
    const entry = pending.get(id);
    if (entry) pending.delete(id);
    return entry || null;
}

module.exports = { put, take };

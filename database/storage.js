// database/storage.js
// Uses your existing SQLite database connection
const db = require('./db');

// ===============================
// Ensure required tables exist
// ===============================

// Steam link table — maps Steam ID64 → Discord user ID (one-time link, permanent)
db.prepare(`
    CREATE TABLE IF NOT EXISTS steam_links (
        steam_id   TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL,
        linked_at  INTEGER NOT NULL
    )
`).run();

// Assignments table (train → assignment info)
db.prepare(`
    CREATE TABLE IF NOT EXISTS assignments (
        guild_id TEXT,
        train_number TEXT,
        dep TEXT,
        des TEXT,
        trk TEXT,
        job TEXT,
        rmk TEXT,
        timestamp INTEGER,
        PRIMARY KEY (guild_id, train_number)
    )
`).run();

// Train Board message ID table
db.prepare(`
    CREATE TABLE IF NOT EXISTS train_board (
        guild_id TEXT PRIMARY KEY,
        message_id TEXT
    )
`).run();

// ===============================
// CREW FUNCTIONS
// ===============================

/**
 * Returns all crew for a guild.
 */
function getAllCrew(guildId) {
        // Single-guild bot — guildId reserved for future multi-guild support
    const rows = db.prepare(`
        SELECT user_id, type, train_number, loco_type, preferred_name
        FROM registrations
        WHERE active = 1
    `).all();

    return rows.map(r => ({
        userId: r.user_id,
        type: r.type,
        trainNumber: r.train_number,
        locoType: r.loco_type ?? null,
        preferredName: r.preferred_name
    }));
}

/**
 * Returns the registration row for a single user, or null.
 */
function getCrewByUserId(guildId, userId) {
    const row = db.prepare(`
        SELECT user_id, type, train_number, loco_type, preferred_name
        FROM registrations
        WHERE user_id = ? AND active = 1
    `).get(userId);

    if (!row) return null;

    return {
        userId: row.user_id,
        type: row.type,
        trainNumber: row.train_number,
        locoType: row.loco_type ?? null,
        preferredName: row.preferred_name
    };
}

// ===============================
// ASSIGNMENT FUNCTIONS
// ===============================

/**
 * Returns assignment for a train or null.
 */
function getAssignmentByTrain(guildId, trainNumber) {
    return db.prepare(`
        SELECT dep, des, trk, job, rmk, timestamp
        FROM assignments
        WHERE guild_id = ? AND train_number = ?
    `).get(guildId, trainNumber) || null;
}

/**
 * Creates or updates assignment for a train.
 */
function setAssignment(guildId, trainNumber, data) {
    db.prepare(`
        INSERT INTO assignments (guild_id, train_number, dep, des, trk, job, rmk, timestamp)
        VALUES (@guild_id, @train_number, @dep, @des, @trk, @job, @rmk, @timestamp)
        ON CONFLICT(guild_id, train_number) DO UPDATE SET
            dep = excluded.dep,
            des = excluded.des,
            trk = excluded.trk,
            job = excluded.job,
            rmk = excluded.rmk,
            timestamp = excluded.timestamp
    `).run({
        guild_id: guildId,
        train_number: trainNumber,
        dep: data.dep,
        des: data.des,
        trk: data.trk,
        job: data.job,
        rmk: data.rmk,
        timestamp: data.timestamp
    });
}

// ===============================
// TRAIN BOARD MESSAGE ID FUNCTIONS
// ===============================

/**
 * Returns the stored Train Board message ID for a guild.
 */
function getTrainBoardMessageId(guildId) {
    const row = db.prepare(`
        SELECT message_id
        FROM train_board
        WHERE guild_id = ?
    `).get(guildId);

    return row ? row.message_id : null;
}

/**
 * Saves or updates the Train Board message ID.
 */
function setTrainBoardMessageId(guildId, messageId) {
    db.prepare(`
        INSERT INTO train_board (guild_id, message_id)
        VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET message_id = excluded.message_id
    `).run(guildId, messageId);
}

// ===============================
// CREW WRITE FUNCTIONS
// ===============================

/**
 * Returns the raw DB row for a user, or null.
 * Use this when you need the snake_case fields (e.g. train_number).
 */
function getCrewRaw(userId) {
    return db.prepare(`
        SELECT user_id, type, train_number, loco_type, preferred_name
        FROM registrations WHERE user_id = ? AND active = 1
    `).get(userId) || null;
}

/**
 * Insert or update a crew member's full profile.
 * locoType is optional — pass null to leave it unchanged on update.
 */
function upsertCrew(userId, type, trainNumber, preferredName, locoType = null) {
    db.prepare(`
        INSERT INTO registrations (user_id, type, train_number, loco_type, preferred_name, active)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(user_id) DO UPDATE SET
            type = excluded.type,
            train_number = excluded.train_number,
            loco_type = excluded.loco_type,
            preferred_name = excluded.preferred_name,
            active = 1
    `).run(userId, type, trainNumber, locoType, preferredName);
}

/**
 * Soft-removes a crew member (sets active = 0). Data is kept for records.
 */
function removeCrew(userId) {
    db.prepare(`UPDATE registrations SET active = 0 WHERE user_id = ?`).run(userId);
}

/**
 * Clear all train numbers — used at end-of-session by /endop.
 */
function clearAllTrainNumbers() {
    db.prepare(`UPDATE registrations SET train_number = ''`).run();
}

// ===============================
// STEAM LINK FUNCTIONS
// ===============================

/**
 * Returns { discordId } for a Steam ID, or null if not linked.
 */
function getSteamLink(steamId) {
    const row = db.prepare(`SELECT discord_id FROM steam_links WHERE steam_id = ?`).get(String(steamId));
    return row ? { discordId: row.discord_id } : null;
}

/**
 * Returns { steamId } for a Discord user, or null if not linked.
 */
function getSteamLinkByDiscord(discordId) {
    const row = db.prepare(`SELECT steam_id FROM steam_links WHERE discord_id = ?`).get(discordId);
    return row ? { steamId: row.steam_id } : null;
}

/**
 * Stores or updates the Steam ID → Discord ID link.
 */
function setSteamLink(steamId, discordId) {
    db.prepare(`
        INSERT INTO steam_links (steam_id, discord_id, linked_at)
        VALUES (?, ?, ?)
        ON CONFLICT(steam_id) DO UPDATE SET
            discord_id = excluded.discord_id,
            linked_at  = excluded.linked_at
    `).run(String(steamId), discordId, Date.now());
}

// ===============================
// ASSIGNMENT DELETE
// ===============================

/**
 * Remove an assignment row entirely.
 */
function deleteAssignment(guildId, trainNumber) {
    db.prepare(`
        DELETE FROM assignments WHERE guild_id = ? AND train_number = ?
    `).run(guildId, trainNumber);
}

/**
 * Wipe all assignments for a guild — called at end of ops.
 */
function clearAllAssignments(guildId) {
    db.prepare(`DELETE FROM assignments WHERE guild_id = ?`).run(guildId);
}

// ===============================
// DV SETTINGS
// ===============================

/**
 * Returns the full base URL for the DV connection, or null if unset.
 * Supports both the new dv_url (full URL) and the legacy dv_host/dv_port format.
 */
function getDvBaseUrl() {
    const row = db.prepare(`SELECT dv_host, dv_port, dv_url FROM dv_settings WHERE id = 1`).get();
    if (!row) return null;
    if (row.dv_url) return row.dv_url.replace(/\/$/, ''); // strip trailing slash
    if (row.dv_host && row.dv_port) return `http://${row.dv_host}:${row.dv_port}`;
    return null;
}

/**
 * Saves a full DV connection URL (e.g. https://guardian.connect.grdnnetwork.com or http://1.2.3.4:7230).
 */
function setDvUrl(url) {
    db.prepare(`UPDATE dv_settings SET dv_url = ?, dv_host = NULL, dv_port = NULL WHERE id = 1`).run(url);
}

/** @deprecated Use getDvBaseUrl() instead */
function getDvSettings() {
    return db.prepare(`SELECT dv_host, dv_port, dv_url FROM dv_settings WHERE id = 1`).get() || null;
}

/** @deprecated Use setDvUrl() instead */
function setDvSettings(host, port) {
    db.prepare(`UPDATE dv_settings SET dv_host = ?, dv_port = ?, dv_url = NULL WHERE id = 1`).run(host, port);
}

// ===============================
// OPS / HOURS TRACKING
// ===============================

/**
 * Determines what category of hours a crew member earns.
 * Dispatchers → 'dispatch'
 * Road Crew   → 'road_crew'
 * Shunter with all-digit train number → 'shunting'
 * Shunter with a name/non-numeric     → 'yardmaster' (tracked but shown separately)
 * Returns null if the user shouldn't be enrolled (no type, no train number).
 */
function classifyCategory(type, trainNumber) {
    if (!type || !trainNumber || trainNumber.trim() === '') return null;
    if (type === 'TrainMaster') return 'trainmaster';
    if (type === 'Dispatcher')  return 'dispatch';
    if (type === 'Road Crew')   return 'road_crew';
    if (type === 'Yard Crew') return 'shunting';
    return null;
}

/** Returns the currently open session for a guild, or null. */
function getActiveSession(guildId) {
    return db.prepare(`
        SELECT * FROM ops_sessions
        WHERE guild_id = ? AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1
    `).get(guildId) || null;
}

/**
 * Opens a new session. Closes any orphaned open session first. Returns the new session id.
 * @param {'official'|'unofficial'} sessionType
 */
function openSession(guildId, startedBy, startedAt, sessionType = 'official') {
    // Safety: close any leftover open session
    const orphan = getActiveSession(guildId);
    if (orphan) {
        db.prepare(`UPDATE ops_sessions SET ended_at = ? WHERE id = ?`).run(startedAt, orphan.id);
        db.prepare(`
            UPDATE ops_log SET end_at = ?, minutes = MAX(1, ROUND((? - start_at) / 60000.0))
            WHERE guild_id = ? AND session_id = ? AND end_at IS NULL
        `).run(startedAt, startedAt, guildId, orphan.id);
        db.prepare(`DELETE FROM session_crew WHERE session_id = ?`).run(orphan.id);
    }
    const result = db.prepare(`
        INSERT INTO ops_sessions (guild_id, started_by, started_at, session_type) VALUES (?, ?, ?, ?)
    `).run(guildId, startedBy, startedAt, sessionType);
    return result.lastInsertRowid;
}

/**
 * Opens an ops_log entry for a user in the current session.
 * No-ops silently if the user already has an open entry.
 */
function openOpsEntry(userId, guildId, sessionId, category, startAt) {
    const exists = db.prepare(`
        SELECT id FROM ops_log WHERE user_id = ? AND guild_id = ? AND end_at IS NULL LIMIT 1
    `).get(userId, guildId);
    if (exists) return;
    db.prepare(`
        INSERT INTO ops_log (user_id, guild_id, session_id, category, start_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(userId, guildId, sessionId, category, startAt);
}

/**
 * Closes a single user's open ops_log entry.
 * Called when they leave voice mid-session.
 */
function closeOpsEntry(userId, guildId, endAt) {
    db.prepare(`
        UPDATE ops_log
        SET end_at = ?, minutes = MAX(1, ROUND((? - start_at) / 60000.0))
        WHERE user_id = ? AND guild_id = ? AND end_at IS NULL
    `).run(endAt, endAt, userId, guildId);
}

/**
 * Closes the active session and writes minutes for all open entries.
 * Also clears session_crew entries so the next session starts clean.
 * Returns the session id that was closed, or null if no session was active.
 */
function closeSession(guildId, endedBy, endedAt) {
    const session = getActiveSession(guildId);
    if (!session) return null;
    db.prepare(`
        UPDATE ops_log
        SET end_at = ?, minutes = MAX(1, ROUND((? - start_at) / 60000.0))
        WHERE guild_id = ? AND session_id = ? AND end_at IS NULL
    `).run(endedAt, endedAt, guildId, session.id);
    db.prepare(`
        UPDATE ops_sessions SET ended_by = ?, ended_at = ? WHERE id = ?
    `).run(endedBy, endedAt, session.id);
    // Clean up session_crew for this session
    db.prepare(`DELETE FROM session_crew WHERE session_id = ?`).run(session.id);
    return session.id;
}

/**
 * Returns the number of distinct ops sessions a user has hours logged in.
 * Used by /profile to show "Ops Attended".
 */
function getOpsAttended(userId) {
    const row = db.prepare(`
        SELECT COUNT(DISTINCT session_id) AS count
        FROM ops_log
        WHERE user_id = ? AND session_id IS NOT NULL
    `).get(userId);
    return row?.count ?? 0;
}

/**
 * Returns total minutes by category for a user, including any currently open entry.
 * Shape: { road_crew, dispatch, shunting, yardmaster, bonus }
 */
function getUserHours(userId) {
    const rows = db.prepare(`
        SELECT category, SUM(minutes) as total
        FROM ops_log
        WHERE user_id = ? AND end_at IS NOT NULL
        GROUP BY category
    `).all(userId);

    const open = db.prepare(`
        SELECT category, start_at FROM ops_log
        WHERE user_id = ? AND end_at IS NULL LIMIT 1
    `).get(userId);

    const totals = { road_crew: 0, dispatch: 0, shunting: 0, yardmaster: 0, trainmaster: 0, bonus: 0 };
    for (const row of rows) {
        if (Object.prototype.hasOwnProperty.call(totals, row.category)) {
            totals[row.category] += row.total ?? 0;
        }
    }
    if (open && Object.prototype.hasOwnProperty.call(totals, open.category)) {
        totals[open.category] += Math.round((Date.now() - open.start_at) / 60000);
    }
    return totals;
}

// ===============================
// SESSION CREW
// ===============================

/**
 * Marks a user as an explicit participant in an official ops session.
 * Called when /setcrew is run while a session is active.
 * opsVoiceTracker will only auto-log hours for users in this table.
 */
function addToSessionCrew(sessionId, userId) {
    db.prepare(`
        INSERT OR IGNORE INTO session_crew (session_id, user_id) VALUES (?, ?)
    `).run(sessionId, userId);
}

/**
 * Returns true if the user explicitly opted into this session via /setcrew.
 */
function isInSessionCrew(sessionId, userId) {
    return !!db.prepare(`
        SELECT 1 FROM session_crew WHERE session_id = ? AND user_id = ?
    `).get(sessionId, userId);
}

/**
 * Returns all user IDs who opted into this session via /setcrew.
 * Used by /endop to scope nickname resets to actual participants.
 */
function getSessionCrew(sessionId) {
    return db.prepare(`
        SELECT user_id FROM session_crew WHERE session_id = ?
    `).all(sessionId).map(r => r.user_id);
}

/**
 * Clears the train number for a single user.
 * Intentionally bypasses the active filter — used by /endop
 * to clean up participants even if they left mid-session.
 */
function clearTrainNumber(userId) {
    db.prepare(`UPDATE registrations SET train_number = '' WHERE user_id = ?`).run(userId);
}

// ===============================
// CREW VOICE CHANNELS
// ===============================

function addCrewVC(guildId, channelId, crewNumber) {
    db.prepare(`
        INSERT INTO crew_vcs (channel_id, guild_id, crew_number, created_at)
        VALUES (?, ?, ?, ?)
    `).run(channelId, guildId, crewNumber, Date.now());
}

function removeCrewVC(channelId) {
    db.prepare(`DELETE FROM crew_vcs WHERE channel_id = ?`).run(channelId);
}

function getCrewVCs(guildId) {
    return db.prepare(`
        SELECT channel_id, crew_number FROM crew_vcs
        WHERE guild_id = ? ORDER BY crew_number
    `).all(guildId);
}

function getCrewVCByChannel(channelId) {
    return db.prepare(`
        SELECT channel_id, guild_id, crew_number FROM crew_vcs WHERE channel_id = ?
    `).get(channelId) || null;
}

function clearAllCrewVCs(guildId) {
    db.prepare(`DELETE FROM crew_vcs WHERE guild_id = ?`).run(guildId);
}

// ===============================
// EXPORTS
// ===============================

module.exports = {
    getSteamLink,
    getSteamLinkByDiscord,
    setSteamLink,
    getAllCrew,
    getCrewByUserId,
    getCrewRaw,
    upsertCrew,
    removeCrew,
    clearAllTrainNumbers,
    getAssignmentByTrain,
    setAssignment,
    deleteAssignment,
    clearAllAssignments,
    getTrainBoardMessageId,
    setTrainBoardMessageId,
    getDvBaseUrl,
    setDvUrl,
    getDvSettings,
    setDvSettings,
    classifyCategory,
    getActiveSession,
    openSession,
    openOpsEntry,
    closeOpsEntry,
    closeSession,
    getUserHours,
    addToSessionCrew,
    isInSessionCrew,
    getSessionCrew,
    clearTrainNumber,
    getOpsAttended,
    addCrewVC,
    removeCrewVC,
    getCrewVCs,
    getCrewVCByChannel,
    clearAllCrewVCs,
};

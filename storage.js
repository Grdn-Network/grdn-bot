// storage.js
// Uses your existing SQLite database connection
const db = require('./database/db');

// ===============================
// Ensure required tables exist
// ===============================

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
        SELECT user_id, type, train_number, preferred_name
        FROM registrations
    `).all();

    return rows.map(r => ({
        userId: r.user_id,
        type: r.type,
        trainNumber: r.train_number,
        preferredName: r.preferred_name
    }));
}

/**
 * Returns the registration row for a single user, or null.
 */
function getCrewByUserId(guildId, userId) {
    const row = db.prepare(`
        SELECT user_id, type, train_number, preferred_name
        FROM registrations
        WHERE user_id = ?
    `).get(userId);

    if (!row) return null;

    return {
        userId: row.user_id,
        type: row.type,
        trainNumber: row.train_number,
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
        SELECT user_id, type, train_number, preferred_name
        FROM registrations WHERE user_id = ?
    `).get(userId) || null;
}

/**
 * Insert or update a crew member's full profile.
 */
function upsertCrew(userId, type, trainNumber, preferredName) {
    db.prepare(`
        INSERT INTO registrations (user_id, type, train_number, preferred_name)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            type = excluded.type,
            train_number = excluded.train_number,
            preferred_name = excluded.preferred_name
    `).run(userId, type, trainNumber, preferredName);
}

/**
 * Remove a crew member from the database entirely.
 */
function deleteCrew(userId) {
    db.prepare(`DELETE FROM registrations WHERE user_id = ?`).run(userId);
}

/**
 * Clear all train numbers — used at end-of-session by resetnames.
 */
function clearAllTrainNumbers() {
    db.prepare(`UPDATE registrations SET train_number = ''`).run();
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
 * Returns the stored DV host/port, or null if unset.
 */
function getDvSettings() {
    return db.prepare(`SELECT dv_host, dv_port FROM dv_settings WHERE id = 1`).get() || null;
}

/**
 * Saves the DV host and port.
 */
function setDvSettings(host, port) {
    db.prepare(`UPDATE dv_settings SET dv_host = ?, dv_port = ? WHERE id = 1`).run(host, port);
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

/** Opens a new session. Closes any orphaned open session first. Returns the new session id. */
function openSession(guildId, startedBy, startedAt) {
    // Safety: close any leftover open session
    const orphan = getActiveSession(guildId);
    if (orphan) {
        db.prepare(`UPDATE ops_sessions SET ended_at = ? WHERE id = ?`).run(startedAt, orphan.id);
        db.prepare(`
            UPDATE ops_log SET end_at = ?, minutes = MAX(1, ROUND((? - start_at) / 60000.0))
            WHERE guild_id = ? AND session_id = ? AND end_at IS NULL
        `).run(startedAt, startedAt, guildId, orphan.id);
    }
    const result = db.prepare(`
        INSERT INTO ops_sessions (guild_id, started_by, started_at) VALUES (?, ?, ?)
    `).run(guildId, startedBy, startedAt);
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
 * Closes the active session and writes minutes for all open entries.
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
    return session.id;
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
// EXPORTS
// ===============================

module.exports = {
    getAllCrew,
    getCrewByUserId,
    getCrewRaw,
    upsertCrew,
    deleteCrew,
    clearAllTrainNumbers,
    getAssignmentByTrain,
    setAssignment,
    deleteAssignment,
    clearAllAssignments,
    getTrainBoardMessageId,
    setTrainBoardMessageId,
    getDvSettings,
    setDvSettings,
    classifyCategory,
    getActiveSession,
    openSession,
    openOpsEntry,
    closeSession,
    getUserHours,
};

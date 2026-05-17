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
    getTrainBoardMessageId,
    setTrainBoardMessageId,
    getDvSettings,
    setDvSettings,
};

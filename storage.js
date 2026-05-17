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
// EXPORTS
// ===============================

module.exports = {
    getAllCrew,
    getCrewByUserId,
    getAssignmentByTrain,
    setAssignment,
    getTrainBoardMessageId,
    setTrainBoardMessageId
};

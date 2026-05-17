const Database = require('better-sqlite3');
const db = new Database('./database/users.sqlite');

/* -----------------------------------------------------
   REGISTRATION TABLE
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS registrations (
        user_id TEXT PRIMARY KEY,
        type TEXT,
        train_number TEXT,
        preferred_name TEXT
    )
`).run();

/* -----------------------------------------------------
   DISPATCH PANEL TABLES
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS dispatch_embed (
        id INTEGER PRIMARY KEY,
        message_id TEXT
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS dispatch_settings (
        id INTEGER PRIMARY KEY,
        server_name TEXT,
        server_password TEXT,
        remote_link TEXT,
        remote_password TEXT
    )
`).run();

db.prepare(`
    INSERT OR IGNORE INTO dispatch_settings 
    (id, server_name, server_password, remote_link, remote_password)
    VALUES (1, 'Not set', 'Not set', 'Not set', 'Not set')
`).run();

/* -----------------------------------------------------
   NO-OP EMBED
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS no_op_embed (
        id INTEGER PRIMARY KEY,
        message_id TEXT
    )
`).run();

/* -----------------------------------------------------
   MOVEMENT BOARD TABLES
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operator_train TEXT,
        departing TEXT,
        destination TEXT,
        cleared_to TEXT,
        completed INTEGER DEFAULT 0,
        completed_at TEXT
    )
`).run();

// Safe migrations
try { db.prepare(`ALTER TABLE movements ADD COLUMN completed INTEGER DEFAULT 0`).run(); } catch {}
try { db.prepare(`ALTER TABLE movements ADD COLUMN completed_at TEXT`).run(); } catch {}

db.prepare(`
    CREATE TABLE IF NOT EXISTS movement_board (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        message_id TEXT
    )
`).run();

/* -----------------------------------------------------
   DV SETTINGS TABLE
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS dv_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        dv_host TEXT,
        dv_port INTEGER
    )
`).run();

db.prepare(`
    INSERT OR IGNORE INTO dv_settings (id, dv_host, dv_port)
    VALUES (1, NULL, NULL)
`).run();

/* -----------------------------------------------------
   OPS / HOURS TRACKING
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS ops_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        started_by TEXT,
        started_at INTEGER NOT NULL,
        ended_by TEXT,
        ended_at INTEGER
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS ops_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        guild_id TEXT NOT NULL,
        session_id INTEGER,
        category TEXT NOT NULL,
        start_at INTEGER,
        end_at INTEGER,
        minutes INTEGER
    )
`).run();

// Tracks one-time migrations so they never run twice
db.prepare(`
    CREATE TABLE IF NOT EXISTS ops_meta (
        key TEXT PRIMARY KEY,
        value TEXT
    )
`).run();

// Grant 10h founding bonus to all users registered before this system existed
const bonusGranted = db.prepare(`SELECT value FROM ops_meta WHERE key = 'bonus_granted'`).get();
if (!bonusGranted) {
    const users = db.prepare(`SELECT user_id FROM registrations`).all();
    const now = Date.now();
    const insert = db.prepare(`
        INSERT INTO ops_log (user_id, guild_id, session_id, category, start_at, end_at, minutes)
        VALUES (?, 'global', NULL, 'bonus', ?, ?, 600)
    `);
    db.transaction(() => {
        for (const u of users) insert.run(u.user_id, now, now);
    })();
    db.prepare(`INSERT INTO ops_meta (key, value) VALUES ('bonus_granted', '1')`).run();
}

module.exports = db;
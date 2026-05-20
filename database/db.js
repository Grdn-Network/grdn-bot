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

// Migrate: editable static sections for the unified Operations embed
try { db.prepare(`ALTER TABLE dispatch_settings ADD COLUMN setup_notes TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE dispatch_settings ADD COLUMN mods_list   TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE dispatch_settings ADD COLUMN rd_setup    TEXT`).run(); } catch {}

// Seed default text for any rows that have nulls (first run after migration)
db.prepare(`
    UPDATE dispatch_settings SET
        setup_notes = COALESCE(setup_notes, 'Use \`/setcrew\` to create your crew profile and join an ops session. See <#1474625317359452415> for setup guides and <#1477255961537155243> for fundamentals.'),
        mods_list   = COALESCE(mods_list,   'Mod list not yet configured. Staff: use \`/editembed field:mods_list\` to add the required mods.'),
        rd_setup    = COALESCE(rd_setup,    'On the Remote Dispatch website you will be asked to choose a username — pick one you will remember and keep it consistent between sessions.')
    WHERE id = 1
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
        dv_port INTEGER,
        dv_url  TEXT
    )
`).run();

// Migrate: add dv_url column if it doesn't exist yet
try { db.prepare(`ALTER TABLE dv_settings ADD COLUMN dv_url TEXT`).run(); } catch {}

db.prepare(`
    INSERT OR IGNORE INTO dv_settings (id, dv_host, dv_port, dv_url)
    VALUES (1, NULL, NULL, NULL)
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
        ended_at INTEGER,
        session_type TEXT NOT NULL DEFAULT 'official'
    )
`).run();

// Migrate: add session_type if not present
try { db.prepare(`ALTER TABLE ops_sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'official'`).run(); } catch {}

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

// Rename Shunter → Yard Crew
db.prepare(`UPDATE registrations SET type = 'Yard Crew' WHERE type = 'Shunter'`).run();

// Add active flag — 1 = active, 0 = soft-deleted (kept for records)
try { db.prepare(`ALTER TABLE registrations ADD COLUMN active INTEGER NOT NULL DEFAULT 1`).run(); } catch {}
// Ensure existing rows are marked active
db.prepare(`UPDATE registrations SET active = 1 WHERE active IS NULL`).run();

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

/* -----------------------------------------------------
   SESSION CREW — explicit opt-in per official session
   Only users who run /setcrew while a session is active
   are tracked here. opsVoiceTracker checks this before
   logging hours, so informal /setcrew users are never
   auto-enrolled in official ops hours.
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS session_crew (
        session_id INTEGER NOT NULL,
        user_id    TEXT    NOT NULL,
        PRIMARY KEY (session_id, user_id)
    )
`).run();

/* -----------------------------------------------------
   CREW VOICE CHANNELS
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS crew_vcs (
        channel_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        crew_number INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    )
`).run();

module.exports = db;
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
    VALUES (1, 'Not set', 'Not set', 'Not set', 'GRDN')
`).run();

// Migrate: update remote_password from any old default value to GRDN
db.prepare(`
    UPDATE dispatch_settings SET remote_password = 'GRDN'
    WHERE id = 1 AND (remote_password IS NULL OR remote_password IN ('Not set', 'N/A', ''))
`).run();

// Migrate: editable static sections for the unified Operations embed
try { db.prepare(`ALTER TABLE dispatch_settings ADD COLUMN setup_notes TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE dispatch_settings ADD COLUMN mods_list   TEXT`).run(); } catch {}
try { db.prepare(`ALTER TABLE dispatch_settings ADD COLUMN rd_setup    TEXT`).run(); } catch {}
// Migrate: ops_active flag — 1 while a session is running, 0 otherwise
try { db.prepare(`ALTER TABLE dispatch_settings ADD COLUMN ops_active INTEGER NOT NULL DEFAULT 0`).run(); } catch {}
// Migrate: interchange_mode — 1 = toggle is on (pre-start), 0 = off; consumed at /session start
try { db.prepare(`ALTER TABLE dispatch_settings ADD COLUMN interchange_mode INTEGER NOT NULL DEFAULT 0`).run(); } catch {}
// Migrate: hub_stations — JSON array of yard IDs treated as hub stops for leg classification
try { db.prepare(`ALTER TABLE dispatch_settings ADD COLUMN hub_stations TEXT NOT NULL DEFAULT '["MF","HB"]'`).run(); } catch {}

// Seed default text for any rows that have nulls (first run after migration)
db.prepare(`
    UPDATE dispatch_settings SET
        setup_notes = COALESCE(setup_notes, 'Use \`/setcrew\` to create your crew profile and join an ops session. Check out <#1474625317359452415> and <#1477255961537155243>.'),
        mods_list   = COALESCE(mods_list,   'Mod list not yet configured.'),
        rd_setup    = COALESCE(rd_setup,    'On the Remote Dispatch website you will be asked to choose a username — pick one you will remember and keep it consistent between sessions.')
    WHERE id = 1
`).run();

// Fix previously-seeded defaults that had incorrect wording
db.prepare(`
    UPDATE dispatch_settings
    SET setup_notes = 'Use \`/setcrew\` to create your crew profile and join an ops session. Check out <#1474625317359452415> and <#1477255961537155243>.'
    WHERE id = 1
      AND setup_notes = 'Use \`/setcrew\` to create your crew profile and join an ops session. See <#1474625317359452415> for setup guides and <#1477255961537155243> for fundamentals.'
`).run();

db.prepare(`
    UPDATE dispatch_settings
    SET mods_list = 'Mod list not yet configured.'
    WHERE id = 1
      AND mods_list = 'Mod list not yet configured. Staff: use \`/editembed field:mods_list\` to add the required mods.'
`).run();

/* -----------------------------------------------------
   MODS LIST
   Structured table replaces the old mods_list text blob.
   Each row: name (unique), url, note, sort_order
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS mods (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL UNIQUE,
        url        TEXT,
        version    TEXT,
        note       TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
    )
`).run();

// Migrate: add version column to existing installs
try { db.prepare(`ALTER TABLE mods ADD COLUMN version TEXT`).run(); } catch {}
// Migrate: official flag — 1 = shown in embed (default), 0 = unofficial/hidden
try { db.prepare(`ALTER TABLE mods ADD COLUMN official INTEGER NOT NULL DEFAULT 1`).run(); } catch {}
db.prepare(`UPDATE mods SET official = 1 WHERE official IS NULL`).run();

/* -----------------------------------------------------
   MOD PRESETS
   Each preset stores its own full snapshot of the mod list
   (name, url, version, note, official, order), so hosts can swap
   whole setups and every mod's link/version is preserved per preset.
   Exactly one preset is active; the live `mods` table mirrors it.
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS presets (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        active     INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS preset_mods (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        preset_id  INTEGER NOT NULL,
        name       TEXT,
        url        TEXT,
        version    TEXT,
        note       TEXT,
        official   INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0
    )
`).run();

// Seed the default "Shared Preset" from the current mods on first run
if (db.prepare(`SELECT COUNT(*) AS c FROM presets`).get().c === 0) {
    const info = db.prepare(`INSERT INTO presets (name, active, created_at) VALUES ('Shared Preset', 1, ?)`).run(Date.now());
    const presetId = info.lastInsertRowid;
    const seedMods = db.prepare(`SELECT name, url, version, note, official, sort_order FROM mods ORDER BY sort_order, id`).all();
    const insSeed = db.prepare(`INSERT INTO preset_mods (preset_id, name, url, version, note, official, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const m of seedMods) insSeed.run(presetId, m.name, m.url, m.version, m.note, m.official, m.sort_order);
    console.log(`[Presets] Seeded "Shared Preset" from ${seedMods.length} current mod(s).`);
}

/* -----------------------------------------------------
   DEFECT ALERT PREFERENCES
   Users opt IN to hotbox/defect alerts (default off).
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS defect_prefs (
        user_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0
    )
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
// Migrate: ops_mode — 'standard' or 'interchange' (set at session start from dispatch_settings)
try { db.prepare(`ALTER TABLE ops_sessions ADD COLUMN ops_mode TEXT NOT NULL DEFAULT 'standard'`).run(); } catch {}

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
// Rename Dispatcher → Controller
db.prepare(`UPDATE registrations SET type = 'Controller' WHERE type = 'Dispatcher'`).run();
// Retire the TrainMaster crew type → fold into Road Crew. The TrainMaster Discord role is untouched (see grdn-bot#14).
db.prepare(`UPDATE registrations SET type = 'Road Crew' WHERE type = 'TrainMaster'`).run();

// Add active flag — 1 = active, 0 = soft-deleted (kept for records)
try { db.prepare(`ALTER TABLE registrations ADD COLUMN active INTEGER NOT NULL DEFAULT 1`).run(); } catch {}
// Add loco_type — DV locomotive type (e.g. DE2, DH4) for precise train board matching
try { db.prepare(`ALTER TABLE registrations ADD COLUMN loco_type TEXT`).run(); } catch {}
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

// One-time recalc: remove hours logged from unofficial ops. Unofficial sessions
// were never meant to count toward the leaderboard, but before session-type
// gating landed they accrued hours like any other. This clears exactly those
// rows (matched by their session's type), and nothing else. Guarded so it runs
// once. New unofficial ops no longer log hours at all.
if (!db.prepare(`SELECT value FROM ops_meta WHERE key = 'unofficial_hours_purged'`).get()) {
    const res = db.prepare(`
        DELETE FROM ops_log
        WHERE session_id IN (SELECT id FROM ops_sessions WHERE session_type = 'unofficial')
    `).run();
    db.prepare(`INSERT INTO ops_meta (key, value) VALUES ('unofficial_hours_purged', '1')`).run();
    console.log(`[Recalc] Cleared ${res.changes} unofficial-op hours row(s) from ops_log.`);
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

/* -----------------------------------------------------
   SESSION STATS — per-job attribution
   One row per /complete, regardless of ops_mode.
   leg_type is null when ops_mode = 'standard'.
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS job_completions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   INTEGER NOT NULL,
        user_id      TEXT    NOT NULL,
        job_id       TEXT    NOT NULL,
        job_type     TEXT,
        departure    TEXT,
        destination  TEXT,
        car_count    INTEGER DEFAULT 0,
        cargo        TEXT,
        wage         REAL    DEFAULT 0,
        leg_type     TEXT,
        completed_at INTEGER
    )
`).run();

/* -----------------------------------------------------
   SESSION STATS — per-player totals, updated live
   Primary key: (session_id, user_id)
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS user_session_stats (
        session_id       INTEGER NOT NULL,
        user_id          TEXT    NOT NULL,
        car_miles        REAL    DEFAULT 0,
        jobs_completed   INTEGER DEFAULT 0,
        local_deliveries INTEGER DEFAULT 0,
        hub_inbound      INTEGER DEFAULT 0,
        hub_outbound     INTEGER DEFAULT 0,
        interchange      INTEGER DEFAULT 0,
        PRIMARY KEY (session_id, user_id)
    )
`).run();

/* -----------------------------------------------------
   LIFETIME STATS — cumulative per-player totals
   Updated at each job completion and car-miles push.
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS user_lifetime_stats (
        user_id          TEXT PRIMARY KEY,
        car_miles        REAL    DEFAULT 0,
        jobs_completed   INTEGER DEFAULT 0,
        local_deliveries INTEGER DEFAULT 0,
        hub_inbound      INTEGER DEFAULT 0,
        hub_outbound     INTEGER DEFAULT 0,
        interchange      INTEGER DEFAULT 0,
        updated_at       INTEGER
    )
`).run();

/* -----------------------------------------------------
   ACTIVITY LOG — one row per command, button, and modal use.
   Records who did what, with the arguments they passed, so an
   action can always be traced back to a person. Written by
   interactionHandler, read by /activity (admin only).
----------------------------------------------------- */
db.prepare(`
    CREATE TABLE IF NOT EXISTS activity_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        ts         INTEGER NOT NULL,
        guild_id   TEXT,
        user_id    TEXT    NOT NULL,
        user_tag   TEXT,
        kind       TEXT    NOT NULL,
        name       TEXT    NOT NULL,
        detail     TEXT,
        channel_id TEXT,
        status     TEXT    NOT NULL,
        error      TEXT
    )
`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_ts   ON activity_log (ts DESC)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log (user_id, ts DESC)`).run();
db.prepare(`CREATE INDEX IF NOT EXISTS idx_activity_name ON activity_log (name, ts DESC)`).run();

module.exports = db;
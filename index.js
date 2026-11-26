const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { CRASH_LOG_CHANNEL_ID, ADMIN_ROLE, TRAIN_BOARD_CHANNEL_ID } = require('./config');
const storage = require('./database/storage');
const { updateTrainBoard } = require('./utils/trainBoard');
const { runRetention } = require('./utils/purgeForensics');
const { sweepStaleSessions, SWEEP_INTERVAL_MS } = require('./utils/staleSessions');
const { pushSessionConfig, isCrewChannel } = require('./utils/sessionConfig');

const CRASH_LOG_PATH = 'C:\\GRDN\\bot\\crash.log';
fs.mkdirSync(path.dirname(CRASH_LOG_PATH), { recursive: true });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.db = require('./database/db');

// Load commands — recursively walks commands/ subdirectories
client.commands = new Collection();
function loadCommands(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            loadCommands(fullPath);
        } else if (entry.name.endsWith('.js')) {
            const command = require(fullPath);
            client.commands.set(command.data.name, command);
        }
    }
}
loadCommands(path.join(__dirname, 'commands'));

// Load interaction handler
require('./interactionHandler')(client);

// Logging system (audit loggers)
const loadLogging = require('./logging/loader');
loadLogging(client);

// Event handlers (functional, not audit loggers)
require('./utils/crewVCManager')(client);
require('./events/opsVoiceTracker')(client);
require('./events/scamScanner')(client);

// How often to poll GRDNConnect for live loco data (ms)
const TRAIN_BOARD_POLL_MS = 30_000;

// Safety-net re-push of session config (ms). Channel changes push on the Discord
// event, so this exists only to recover a host that restarted mid-session and lost
// the config it was holding.
const SESSION_CONFIG_RECONCILE_MS = 600_000;

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    // If no session is active in the DB, make sure ops_active is 0.
    // Prevents stale server name/password showing in the embed after a bot crash or restart.
    const db = require('./database/db');
    const hasActiveSession = db.prepare(
        `SELECT 1 FROM ops_sessions WHERE ended_at IS NULL LIMIT 1`
    ).get();
    if (!hasActiveSession) {
        db.prepare(`UPDATE dispatch_settings SET ops_active = 0 WHERE id = 1`).run();
        console.log('[Startup] No active session found — ops_active cleared.');
    }

    // Prune old purge forensics: saved media after 7 days, records after 90.
    runRetention();
    setInterval(runRetention, 24 * 60 * 60 * 1000);

    // Close any op that was started and never ended, so a forgotten End Op
    // cannot keep someone's hours clock running while they sit in a VC.
    sweepStaleSessions(client);
    setInterval(() => sweepStaleSessions(client), SWEEP_INTERVAL_MS);

    // Continuously refresh the train board while an op session is active.
    setInterval(async () => {
        for (const [, guild] of client.guilds.cache) {
            try {
                if (!storage.getActiveSession(guild.id)) continue;
                await updateTrainBoard(client, guild.id, TRAIN_BOARD_CHANNEL_ID);
            } catch (err) {
                console.error('[TrainBoard Poll]', guild.id, err.message);
            }
        }
    }, TRAIN_BOARD_POLL_MS);

    // One-time recovery right after startup, before the reconcile interval's first
    // tick. The minted token pair lives only in memory (utils/sessionAuth.js), so a
    // restart mid-session leaves every host holding a token this process no longer
    // knows, and stats, radio and crew voice all reject until the config is pushed
    // again. Waiting for the interval would keep the session dark for up to
    // SESSION_CONFIG_RECONCILE_MS. pushSessionConfig mints a fresh pair when the live
    // one is empty, so this needs no token logic of its own. Best effort: a host
    // whose game is down recovers on the next reconcile tick instead.
    for (const [, guild] of client.guilds.cache) {
        try {
            if (!storage.getActiveSession(guild.id)) continue;
            await pushSessionConfig(guild, { force: true, reason: 'startup' });
        } catch (err) {
            console.error('[SessionConfig] startup', guild.id, err.message);
        }
    }

    // Safety net only. Forced, because the point is a host that restarted and is
    // holding nothing, which no fingerprint comparison can detect.
    setInterval(async () => {
        for (const [, guild] of client.guilds.cache) {
            try {
                if (!storage.getActiveSession(guild.id)) continue;
                await pushSessionConfig(guild, { force: true, reason: 'reconcile' });
            } catch (err) {
                console.error('[SessionConfig] reconcile', guild.id, err.message);
            }
        }
    }, SESSION_CONFIG_RECONCILE_MS);
});

// ── Crew channel changes push immediately ─────────────────────────────────────
// Covered by the Guilds intent. The push is skipped when the resulting channel
// list is unchanged, so a rename to the same name or an unrelated edit costs
// nothing. Only channels in the crew VC category are considered.
async function onCrewChannelChange(channel, reason) {
    try {
        if (!isCrewChannel(channel)) return;
        if (!channel.guild || !storage.getActiveSession(channel.guild.id)) return;
        await pushSessionConfig(channel.guild, { reason });
    } catch (err) {
        console.error('[SessionConfig]', reason, err.message);
    }
}

client.on('channelCreate', ch => onCrewChannelChange(ch, 'crew VC created'));
client.on('channelDelete', ch => onCrewChannelChange(ch, 'crew VC deleted'));

// A channel can move into or out of the crew category, so check both states.
client.on('channelUpdate', (before, after) => {
    if (isCrewChannel(before) || isCrewChannel(after))
        onCrewChannelChange(after, 'crew VC updated');
});

// Shared crash handler
async function handleCrash(type, err) {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] ${type}\n${err.stack ?? err}\n`;

    fs.appendFileSync(CRASH_LOG_PATH, message);

    try {
        const channel = client.channels.cache.get(CRASH_LOG_CHANNEL_ID);
        if (channel) {
            await channel.send(
                `🚨 <@&${ADMIN_ROLE}> **GRDN Bot crashed!**\n` +
                `**Type:** ${type}\n` +
                `**Time:** ${timestamp}\n` +
                `\`\`\`${String(err.stack ?? err).slice(0, 1800)}\`\`\``
            );
        }
    } catch {
        // Discord unreachable, file log is enough
    }

    process.exit(1);
}

// Non-fatal Discord errors — don't kill the bot
function isNonFatal(err) {
    if (err?.code === 10062) return true; // Unknown interaction — expired
    if (err?.code === 40060) return true; // Interaction already acknowledged
    if (err?.message?.includes('Opening handshake has timed out')) return true; // WebSocket timeout
    if (err?.message?.includes('The reply to this interaction has already been sent')) return true;
    return false;
}

process.on('uncaughtException', (err) => {
    if (isNonFatal(err)) {
        console.error('[Non-fatal error ignored]', err.message);
        return;
    }
    handleCrash('UncaughtException', err);
});

process.on('unhandledRejection', (err) => {
    if (isNonFatal(err)) {
        console.error('[Non-fatal error ignored]', err.message);
        return;
    }
    handleCrash('UnhandledRejection', err);
});

process.on('SIGTERM', () => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(CRASH_LOG_PATH, `[${timestamp}] Bot stopped (SIGTERM)\n`);
    process.exit(0);
});

client.login(process.env.TOKEN);

// Start HTTP server for GRDNConnect pushes (radio channel changes etc.)
// Requires HTTP_PORT and HTTP_SECRET in .env
require('./server')(client);
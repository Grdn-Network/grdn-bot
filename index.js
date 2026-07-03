const { Client, GatewayIntentBits, Collection, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { CRASH_LOG_CHANNEL_ID, ADMIN_ROLE, TRAIN_BOARD_CHANNEL_ID, CREW_VC_CATEGORY_ID } = require('./config');
const fetch = require('node-fetch');
const storage = require('./database/storage');
const { updateTrainBoard } = require('./utils/trainBoard');
const { runRetention } = require('./utils/purgeForensics');

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

// How often to re-push the crew channel list to the game radio (ms)
// Picks up new crew VCs created during the session without a restart.
const CHANNEL_PUSH_MS = 90_000;

client.once('ready', () => {
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

    // Periodically re-push the live crew VC list to the game's radio mode.
    // Runs every 90s so newly-created crew VCs appear in GRDN RADIO without a restart.
    setInterval(async () => {
        for (const [, guild] of client.guilds.cache) {
            try {
                if (!storage.getActiveSession(guild.id)) continue;
                const dvUrl = storage.getDvBaseUrl();
                if (!dvUrl) continue;

                const channels = [...guild.channels.cache.values()]
                    .filter(ch => ch.parentId === CREW_VC_CATEGORY_ID && ch.type === ChannelType.GuildVoice)
                    .sort((a, b) => a.rawPosition - b.rawPosition)
                    .map(ch => ({ name: ch.name, vcId: ch.id }));

                fetch(`${dvUrl}/session-config`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        botUrl:   process.env.BOT_PUBLIC_URL || '',
                        secret:   process.env.HTTP_SECRET    || '',
                        channels,
                    }),
                    timeout: 3000,
                }).then(r => {
                    if (r.ok) console.log(`[ChannelPush] ${channels.length} channel(s) → game`);
                }).catch(() => {}); // game offline is normal — silent fail
            } catch (err) {
                console.error('[ChannelPush]', guild.id, err.message);
            }
        }
    }, CHANNEL_PUSH_MS);
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
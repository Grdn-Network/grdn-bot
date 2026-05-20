const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { CRASH_LOG_CHANNEL_ID, ADMIN_ROLE, TRAIN_BOARD_CHANNEL_ID } = require('./config');
const storage = require('./database/storage');
const { updateTrainBoard } = require('./utils/trainBoard');

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

// How often to poll GRDNConnect for live loco data (ms)
const TRAIN_BOARD_POLL_MS = 30_000;

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);

    // Continuously refresh the train board while an op session is active.
    // Each tick tries every guild the bot is in; skips guilds with no active session.
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
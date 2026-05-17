const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { CRASH_LOG_CHANNEL_ID, ADMIN_ROLE } = require('./config');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences
    ]
});

client.db = require('./database/db');

// Load commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

// Load interaction handler
require('./interactionHandler')(client);

// Logging system
const loadLogging = require('./logging/loader');
loadLogging(client);

client.once('clientReady', () => {
    console.log(`Logged in as ${client.user.tag}`);
    const channel = client.channels.cache.get(CRASH_LOG_CHANNEL_ID);
    if (channel) {
        channel.send(`✅ <@&${ADMIN_ROLE}> GRDN Bot is online and ready.`);
    }
});

// Shared crash handler
async function handleCrash(type, err) {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] ${type}\n${err.stack ?? err}\n`;

    fs.appendFileSync('C:\\GRDN\\crash.log', message);

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
    if (err?.message?.includes('Opening handshake has timed out')) return true; // WebSocket timeout
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

process.on('SIGTERM', async () => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync('C:\\GRDN\\crash.log', `[${timestamp}] Bot was terminated externally (SIGTERM)\n`);
    try {
        const channel = client.channels.cache.get(CRASH_LOG_CHANNEL_ID);
        if (channel) {
            await channel.send(`⚠️ <@&${ADMIN_ROLE}> GRDN Bot was shut down externally at ${timestamp}`);
        }
    } catch {}
    process.exit(0);
});

client.login(process.env.TOKEN);
// utils/voiceAlert.js
// Joins a Discord voice channel, plays a TTS message, then disconnects.
// Used by /call and any future voice alert system.
//
// Requires (install on VPS):
//   npm install @discordjs/voice @discordjs/opus gtts sodium-native
//   apt-get install ffmpeg

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
} = require('@discordjs/voice');
const gTTS     = require('gtts');
const { Readable } = require('stream');
const storage  = require('../database/storage');

const CONNECT_TIMEOUT_MS  = 5_000;
const PLAYBACK_TIMEOUT_MS = 30_000;

// ── TTS generation ────────────────────────────────────────────────────────────

function generateTTS(text) {
    return new Promise((resolve, reject) => {
        const gtts   = new gTTS(text, 'en');
        const chunks = [];
        const stream = gtts.stream();
        stream.on('data',  chunk => chunks.push(chunk));
        stream.on('end',   ()    => resolve(Buffer.concat(chunks)));
        stream.on('error', err   => reject(err));
    });
}

// ── Core: join VC, play audio, leave ─────────────────────────────────────────

async function playInChannel(voiceChannel, text) {
    const connection = joinVoiceChannel({
        channelId:      voiceChannel.id,
        guildId:        voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf:       false,
        selfMute:       false,
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);

        const audioBuffer = await generateTTS(text);
        const player      = createAudioPlayer();
        const resource    = createAudioResource(Readable.from(audioBuffer));

        connection.subscribe(player);
        player.play(resource);

        await entersState(player, AudioPlayerStatus.Idle, PLAYBACK_TIMEOUT_MS);
    } finally {
        connection.destroy();
    }
}

// ── Alert a train crew by train number ───────────────────────────────────────
// Finds the VC the crew are in (via Discord voice state) and plays the alert.
// Returns { success, reason? }

async function alertTrain(guild, trainNumber, message) {
    const crew    = storage.getAllCrew(guild.id);
    const targets = crew.filter(c => String(c.trainNumber) === String(trainNumber));

    if (targets.length === 0) {
        return { success: false, reason: `No crew registered with train ${trainNumber}` };
    }

    // Find which VC they're in — check all registered crew for this train
    let targetVC = null;
    for (const c of targets) {
        const member = await guild.members.fetch(c.userId).catch(() => null);
        if (member?.voice?.channel) {
            targetVC = member.voice.channel;
            break;
        }
    }

    if (!targetVC) {
        return { success: false, reason: `Train ${trainNumber} crew are not in a voice channel` };
    }

    await playInChannel(targetVC, message);
    return { success: true };
}

// ── Alert a specific VC by ID ─────────────────────────────────────────────────

async function alertChannel(guild, channelId, message) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) {
        return { success: false, reason: 'Channel not found or not a voice channel' };
    }
    await playInChannel(channel, message);
    return { success: true };
}

module.exports = { playInChannel, alertTrain, alertChannel };

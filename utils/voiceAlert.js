// utils/voiceAlert.js
// Joins a Discord voice channel, plays a TTS alert, then disconnects.
//
// ── TTS ENGINES ─────────────────────────────────────────────────────────────
//
//  espeak-ng  (recommended, ~CSX MicroHBD style)
//    Sound : robotic 1990s synthesizer — closest to a real defect detector
//    Install: apt install espeak-ng       (no npm package needed)
//    Test   : espeak-ng -v en-us+m3 -s 130 -p 40 -g 8 "Attention train zero three four" --stdout | aplay
//
//  gtts  (Google Translate TTS)
//    Sound : natural, clear female/male voice — more modern announcement style
//    Install: npm install gtts            (already in package.json)
//    Test   : node -e "require('gtts')('Attention train zero three four','en').save('t.mp3',e=>console.log(e||'saved'))"
//
//  polly  (Amazon Polly "Standard" voice — robotic, professional)
//    Sound : Matthew/Joanna standard voice — between espeak and gtts
//    Install: npm install @aws-sdk/client-polly
//    Setup  : AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION in .env
//    Test   : see /testalert command
//
//  openai  (OpenAI TTS — "onyx" is deep and authoritative)
//    Sound : modern realistic voice — less robotic, very clear
//    Install: npm install openai
//    Setup  : OPENAI_API_KEY in .env
//
// ── ENGINE SELECTION ─────────────────────────────────────────────────────────
//
//  Set VOICE_ENGINE in .env to pin one engine for testing:
//    VOICE_ENGINE=espeak    → always use espeak-ng
//    VOICE_ENGINE=gtts      → always use gtts
//    VOICE_ENGINE=polly     → always use Amazon Polly
//    VOICE_ENGINE=openai    → always use OpenAI TTS
//    VOICE_ENGINE=random    → weighted random (default, production mode)
//
//  Weighted random split (adjust VOICE_WEIGHTS to taste):
//    70 % espeak-ng  (authentic robotic detector voice)
//    30 % gtts       (clean modern announcement voice)

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
} = require('@discordjs/voice');
const { Readable } = require('stream');
const { execFile } = require('child_process');
const storage = require('../database/storage');

const CONNECT_TIMEOUT_MS  = 5_000;
const PLAYBACK_TIMEOUT_MS = 30_000;

// ── Weighted engine roster ────────────────────────────────────────────────────
// Adjust weights here. Engines listed here are tried in order if one fails.

const VOICE_WEIGHTS = [
    {
        name:    'espeak',
        weight:  70,
        options: { voice: 'en-us+m3', speed: 130, pitch: 40, gap: 8 },
        // Other voices worth trying:
        //   en-us+m1  — male variant 1 (deeper)
        //   en-us+m5  — male variant 5 (different cadence)
        //   en+m3     — British English variant (sounds more HAL-9000)
    },
    {
        name:    'gtts',
        weight:  30,
        options: { lang: 'en-us' },
    },
];

// ── Engine picker ─────────────────────────────────────────────────────────────

function pickEngine() {
    const forced = process.env.VOICE_ENGINE;
    if (forced && forced !== 'random') {
        const match = VOICE_WEIGHTS.find(e => e.name === forced);
        if (match) return match;
        console.warn(`[Voice] Unknown VOICE_ENGINE="${forced}", falling back to random`);
    }

    const total = VOICE_WEIGHTS.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total;
    for (const e of VOICE_WEIGHTS) {
        r -= e.weight;
        if (r <= 0) return e;
    }
    return VOICE_WEIGHTS[0];
}

// ── TTS generators ────────────────────────────────────────────────────────────

function generateEspeak(text, opts = {}) {
    const { voice = 'en-us+m3', speed = 130, pitch = 40, gap = 8 } = opts;
    return new Promise((resolve, reject) => {
        execFile('espeak-ng', [
            '-v', voice,
            '-s', String(speed),
            '-p', String(pitch),
            '-g', String(gap),
            '--stdout',
            text,
        ], { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
            if (err) return reject(new Error(`espeak-ng: ${err.message}`));
            resolve(stdout); // WAV buffer — discordjs/voice handles it via ffmpeg
        });
    });
}

function generateGtts(text, opts = {}) {
    const gTTS = require('gtts');
    const { lang = 'en-us' } = opts;
    return new Promise((resolve, reject) => {
        // gtts doesn't support all locale codes — fall back to 'en' if needed
        const safeLang = lang.includes('-') ? lang.split('-')[0] : lang;
        const g = new gTTS(text, safeLang);
        const chunks = [];
        const stream = g.stream();
        stream.on('data',  chunk => chunks.push(chunk));
        stream.on('end',   ()    => resolve(Buffer.concat(chunks)));
        stream.on('error', err   => reject(new Error(`gtts: ${err.message}`)));
    });
}

async function generatePolly(text, opts = {}) {
    const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
    const client = new PollyClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const { voice = 'Matthew', engine = 'standard' } = opts;
    const cmd = new SynthesizeSpeechCommand({
        Text: text, VoiceId: voice, OutputFormat: 'mp3', Engine: engine,
    });
    const data = await client.send(cmd);
    const chunks = [];
    for await (const chunk of data.AudioStream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

async function generateOpenAI(text, opts = {}) {
    const OpenAI = require('openai');
    const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { voice = 'onyx' } = opts; // onyx is deep & authoritative
    const resp = await ai.audio.speech.create({ model: 'tts-1', voice, input: text });
    return Buffer.from(await resp.arrayBuffer());
}

// ── Main TTS dispatch ─────────────────────────────────────────────────────────

async function generateTTS(text, engineOverride = null) {
    const engine = engineOverride ?? pickEngine();
    console.log(`[Voice] Engine: ${engine.name}`);

    switch (engine.name) {
        case 'espeak': return generateEspeak(text, engine.options);
        case 'gtts':   return generateGtts(text, engine.options);
        case 'polly':  return generatePolly(text, engine.options);
        case 'openai': return generateOpenAI(text, engine.options);
        default: throw new Error(`Unknown TTS engine: ${engine.name}`);
    }
}

// ── Core: join VC, play, leave ────────────────────────────────────────────────

async function playInChannel(voiceChannel, text, engineOverride = null) {
    const connection = joinVoiceChannel({
        channelId:      voiceChannel.id,
        guildId:        voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf:       false,
        selfMute:       false,
    });

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS);

        const audioBuffer = await generateTTS(text, engineOverride);
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

async function alertTrain(guild, trainNumber, message, engineOverride = null) {
    const crew    = storage.getAllCrew(guild.id);
    const targets = crew.filter(c => String(c.trainNumber) === String(trainNumber));

    if (targets.length === 0) {
        return { success: false, reason: `No crew registered with train ${trainNumber}` };
    }

    let targetVC = null;
    for (const c of targets) {
        const member = await guild.members.fetch(c.userId).catch(() => null);
        if (member?.voice?.channel) { targetVC = member.voice.channel; break; }
    }

    if (!targetVC) {
        return { success: false, reason: `Train ${trainNumber} crew are not in a voice channel` };
    }

    await playInChannel(targetVC, message, engineOverride);
    return { success: true };
}

// ── Alert a specific VC by ID ─────────────────────────────────────────────────

async function alertChannel(guild, channelId, message, engineOverride = null) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) {
        return { success: false, reason: 'Channel not found or not a voice channel' };
    }
    await playInChannel(channel, message, engineOverride);
    return { success: true };
}

module.exports = {
    playInChannel,
    alertTrain,
    alertChannel,
    VOICE_WEIGHTS, // exposed so /testalert can list them
};

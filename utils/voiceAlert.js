// utils/voiceAlert.js
// /call's voice page. Joins the crew's voice channel, plays "Train <digits>,
// contact dispatch" stitched from pre-recorded .wav clips, then leaves.
//
// Clips live in audio/clips/<voice>/. Each voice folder needs 12 files:
//   0.wav to 9.wav, train.wav, contact_dispatch.wav
// A folder with contact_dispatch.wav counts as a voice; one is picked at random
// per call. To re-record, drop in new .wav files with the same names.

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
} = require('@discordjs/voice');
const { Readable }  = require('stream');
const { execFile }  = require('child_process');
const path          = require('path');
const fs            = require('fs');
const os            = require('os');
const crypto        = require('crypto');

// Use bundled ffmpeg binary (ffmpeg-static) so no system PATH config is needed.
// Falls back to 'ffmpeg' if the package is somehow absent.
const FFMPEG_BIN = (() => { try { return require('ffmpeg-static'); } catch { return 'ffmpeg'; } })();
const storage       = require('../database/storage');

const VOICES_DIR          = path.join(__dirname, '../audio/clips');
const CONNECT_TIMEOUT_MS  = 15_000;
const PLAYBACK_TIMEOUT_MS = 30_000;

// Each subfolder of VOICES_DIR with contact_dispatch.wav is a voice set.
const VOICE_SETS = fs.readdirSync(VOICES_DIR)
    .filter(name => fs.existsSync(path.join(VOICES_DIR, name, 'contact_dispatch.wav')));

if (VOICE_SETS.length === 0)
    console.error('[VoiceAlert] No voice sets found — check audio/clips/ subfolders.');
else
    console.log(`[VoiceAlert] Voice sets loaded: ${VOICE_SETS.join(', ')}`);

function pickVoiceDir() {
    return path.join(VOICES_DIR, VOICE_SETS[Math.floor(Math.random() * VOICE_SETS.length)]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Split a number string into individual digit clip names: "034" → ['0','3','4'] */
function digitsOf(n) {
    return String(n).replace(/\D/g, '').split('');
}

// Clip names (no .wav) for a page. No "end of message", so it sounds like a radio page.
function callSequence(trainNumber) {
    return ['train', ...digitsOf(trainNumber), 'contact_dispatch'];
}

// ── Pure-JS WAV concat ────────────────────────────────────────────────────────
// Scans RIFF chunks to extract fmt + data, trims per-clip silence, verifies
// all clips share the same format, then concatenates with a single new header.
// No process spawn, no temp files — typically completes in < 5 ms.

// How much trailing audio to keep after the last non-silent sample.
// Real detectors let each word decay naturally before the next starts.
const TAIL_MS       = 35;
// Fraction of peak amplitude treated as silence (0.01 = 1 %).
// Raise this if clips have TTS noise floor that prevents trimming.
const SILENCE_RATIO = 0.015;

function parseWav(buf) {
    if (buf.toString('ascii', 0, 4) !== 'RIFF' ||
        buf.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('Not a valid WAV file');
    }
    let pos = 12, fmt = null, dataOffset = -1, dataSize = -1;
    while (pos < buf.length - 8) {
        const id   = buf.toString('ascii', pos, pos + 4);
        const size = buf.readUInt32LE(pos + 4);
        if (id === 'fmt ') {
            fmt = {
                audioFormat:   buf.readUInt16LE(pos + 8),
                numChannels:   buf.readUInt16LE(pos + 10),
                sampleRate:    buf.readUInt32LE(pos + 12),
                byteRate:      buf.readUInt32LE(pos + 16),
                blockAlign:    buf.readUInt16LE(pos + 20),
                bitsPerSample: buf.readUInt16LE(pos + 22),
            };
        } else if (id === 'data') {
            dataOffset = pos + 8;
            dataSize   = size;
            break;
        }
        pos += 8 + size + (size & 1); // RIFF chunks are word-aligned
    }
    if (!fmt)            throw new Error('WAV has no fmt chunk');
    if (dataOffset < 0)  throw new Error('WAV has no data chunk');
    return { fmt, data: buf.slice(dataOffset, dataOffset + dataSize) };
}

function buildWavHeader(fmt, dataSize) {
    const h = Buffer.alloc(44);
    h.write('RIFF',  0, 'ascii');  h.writeUInt32LE(36 + dataSize,    4);
    h.write('WAVE',  8, 'ascii');
    h.write('fmt ', 12, 'ascii');  h.writeUInt32LE(16,               16);
    h.writeUInt16LE(fmt.audioFormat,    20);
    h.writeUInt16LE(fmt.numChannels,    22);
    h.writeUInt32LE(fmt.sampleRate,     24);
    h.writeUInt32LE(fmt.byteRate,       28);
    h.writeUInt16LE(fmt.blockAlign,     32);
    h.writeUInt16LE(fmt.bitsPerSample,  34);
    h.write('data', 36, 'ascii');  h.writeUInt32LE(dataSize,         40);
    return h;
}

// Strips leading + trailing silence from a PCM buffer.
// Keeps TAIL_MS of audio after the last non-silent sample so words decay naturally.
function trimSilence(pcm, fmt) {
    const { bitsPerSample, numChannels, sampleRate } = fmt;
    const bytesPerSample = bitsPerSample / 8;
    const blockSize      = bytesPerSample * numChannels;
    const maxAmp         = bitsPerSample === 16 ? 32767 : 127;
    const threshold      = SILENCE_RATIO * maxAmp;
    const tailBytes      = Math.ceil((TAIL_MS / 1000) * sampleRate) * blockSize;

    const amp = (i) => {
        if (bitsPerSample === 16) return Math.abs(pcm.readInt16LE(i));
        if (bitsPerSample ===  8) return Math.abs(pcm.readUInt8(i) - 128); // unsigned PCM
        return 0;
    };

    let start = pcm.length, end = 0;

    for (let i = 0; i < pcm.length - blockSize; i += blockSize)
        if (amp(i) > threshold) { start = i; break; }

    for (let i = pcm.length - blockSize; i >= 0; i -= blockSize)
        if (amp(i) > threshold) { end = Math.min(pcm.length, i + blockSize + tailBytes); break; }

    return start < end ? pcm.slice(start, end) : pcm; // guard: return original if all-silent
}

function concatWavs(buffers) {
    const parsed = buffers.map(parseWav);
    const ref    = parsed[0].fmt;
    for (const { fmt } of parsed) {
        if (fmt.audioFormat   !== ref.audioFormat   ||
            fmt.numChannels   !== ref.numChannels   ||
            fmt.sampleRate    !== ref.sampleRate    ||
            fmt.bitsPerSample !== ref.bitsPerSample) {
            throw new Error('Clip format mismatch — cannot fast-concat');
        }
    }
    const chunks    = parsed.map(p => trimSilence(p.data, ref));
    const totalSize = chunks.reduce((s, c) => s + c.length, 0);
    return Buffer.concat([buildWavHeader(ref, totalSize), ...chunks]);
}

// ── Audio stitcher ────────────────────────────────────────────────────────────
// Fast path: pure-JS WAV concat (no process spawn).
// Fallback: ffmpeg filter_complex concat (handles format differences).

async function stitchClips(clipNames, clipsDir) {
    // Verify all clips exist upfront
    const missing = clipNames.filter(n => !fs.existsSync(path.join(clipsDir, `${n}.wav`)));
    if (missing.length > 0) {
        throw new Error(`[VoiceAlert] Missing clips: ${missing.map(n => n + '.wav').join(', ')}`);
    }

    const buffers = clipNames.map(n => fs.readFileSync(path.join(clipsDir, `${n}.wav`)));

    // Single-clip shortcut
    if (buffers.length === 1) return buffers[0];

    // Fast path — pure JS, no ffmpeg spawn
    try {
        return concatWavs(buffers);
    } catch (e) {
        console.warn('[VoiceAlert] Fast WAV concat failed, falling back to ffmpeg:', e.message);
    }

    // Slow path — ffmpeg (handles clips with different sample rates / formats)
    // Write to a temp file instead of piping to stdout — avoids Windows pipe issues.
    const tmpFile = path.join(os.tmpdir(), `grdn_${crypto.randomBytes(8).toString('hex')}.wav`);

    return new Promise((resolve, reject) => {
        const inputs    = clipNames.flatMap(n => ['-i', path.join(clipsDir, `${n}.wav`)]);
        const filterStr = clipNames.map((_, i) => `[${i}:a]`).join('')
                        + `concat=n=${clipNames.length}:v=0:a=1[out]`;

        execFile(FFMPEG_BIN, [
            ...inputs,
            '-filter_complex', filterStr,
            '-map', '[out]',
            '-y',
            tmpFile,
        ], (err, stdout, stderr) => {
            if (err) {
                fs.unlink(tmpFile, () => {});
                return reject(new Error(
                    `[VoiceAlert] ffmpeg failed\n` +
                    `bin: ${FFMPEG_BIN}\n` +
                    `code: ${err.code}  killed: ${err.killed}\n` +
                    `msg: ${err.message}\n` +
                    `stderr: ${stderr?.toString().slice(0, 500)}`
                ));
            }
            try {
                const buf = fs.readFileSync(tmpFile);
                fs.unlink(tmpFile, () => {});
                resolve(buf);
            } catch (readErr) {
                reject(new Error(`[VoiceAlert] temp file read failed: ${readErr.message}`));
            }
        });
    });
}

// ── Core: join VC, play, leave ────────────────────────────────────────────────

async function playInChannel(voiceChannel, clipNames, clipsDir = pickVoiceDir()) {
    const connection = joinVoiceChannel({
        channelId:      voiceChannel.id,
        guildId:        voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf:       false,
        selfMute:       false,
        debug:          true,   // enables the 'debug' event so we can diagnose failures
    });

    // Collect state transitions and debug output so we can diagnose failures
    const stateLog  = [];
    const debugLog  = [];
    connection.on('stateChange', (oldState, newState) => {
        const entry = `${oldState.status} -> ${newState.status}` +
            (newState.status === VoiceConnectionStatus.Disconnected
                ? ` (reason=${newState.reason} code=${newState.closeCode})`
                : '');
        stateLog.push(entry);
    });
    connection.on('debug',  (msg) => debugLog.push(msg));
    connection.on('error',  (err) => debugLog.push(`[error] ${err.message}`));

    // Kick off clip stitching immediately — runs in parallel with VC setup.
    // By the time the voice connection is Ready the audio is almost always done.
    const stitchPromise = stitchClips(clipNames, clipsDir);

    try {
        // Step 1 — wait for voice connection to be ready
        await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS)
            .catch(err => {
                const tail = debugLog.slice(-20).join('\n');
                throw new Error(
                    `STEP1_CONNECT: ${err.message}\n` +
                    `States: ${stateLog.join(' | ') || 'none'}\n` +
                    `--- debug (last 20 lines) ---\n${tail || '(none)'}`
                );
            });

        // Step 2 — clips are stitched in parallel; await the result here
        const audioBuffer = await stitchPromise
            .catch(err => { throw new Error(`STEP2_STITCH: ${err.message}`); });

        // Step 3 — create audio resource and player
        const player   = createAudioPlayer();
        const resource = createAudioResource(Readable.from(audioBuffer));

        player.on('error', err => console.error('[VoiceAlert] Player error:', err.message, err.resource?.metadata));

        connection.subscribe(player);
        player.play(resource);

        // Step 4 — wait for playback to finish
        await entersState(player, AudioPlayerStatus.Idle, PLAYBACK_TIMEOUT_MS)
            .catch(err => { throw new Error(`STEP4_PLAYBACK: ${err.message}`); });

    } finally {
        connection.destroy();
    }
}

// ── Alert a train crew by train number ───────────────────────────────────────

async function alertTrain(guild, trainNumber) {
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

    const clipsDir = pickVoiceDir();
    console.log(`[VoiceAlert] Using voice: ${path.basename(clipsDir)}`);
    await playInChannel(targetVC, callSequence(trainNumber), clipsDir);
    return { success: true };
}

module.exports = { alertTrain };

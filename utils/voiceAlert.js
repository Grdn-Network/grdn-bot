// utils/voiceAlert.js
// Joins a Discord voice channel, plays a stitched audio alert, then disconnects.
//
// HOW IT WORKS
// ────────────
// Audio is built by concatenating pre-recorded .wav clips from audio/clips/.
// This matches how real railroad defect detectors operate — a bank of recorded
// words played in sequence, not real-time synthesis.
//
// REPLACING PLACEHOLDER CLIPS
// ────────────────────────────
// The clips/ folder ships with Microsoft David placeholder recordings.
// To use real recordings (e.g. your own voice), just drop in new .wav files
// with the same names — no code changes needed.
//
// CLIP INVENTORY (30 files)
// ──────────────────────────
//  Digits      : 0.wav – 9.wav
//  Openers     : attention.wav, emergency.wav, train.wav
//  Station ID  : grdn_detector.wav
//  Defects     : hotbox_detected.wav, front_truck.wav, rear_truck.wav,
//                wheel_bearing.wav, derailment_detected.wav,
//                air_hose_defect.wav, dragging_equipment.wav,
//                no_defects_detected.wav
//  Actions     : reduce_speed_inspect.wav, stop_immediately_contact_dispatch.wav,
//                check_brake_line_reduce_speed.wav, stop_train_inspect_consist.wav
//  Consist     : cars.wav, speed.wav
//  Closers     : end_of_message.wav, contact_dispatch.wav
//
// DEFECT TYPES (passed from DefectMonitor → server.js → here)
//  'Hot Box'           detail: 'front truck' | 'rear truck' | 'wheel bearing' | null
//  'Derailment'        detail: null
//  'Air Hose Defect'   detail: null
//  'Dragging Equipment' detail: null
//  'Consist Check'     detail: '<carCount> <speedMph>'  e.g. '24 45'
//  'call'              detail: null  (used by /call command)

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

const CLIPS_DIR           = path.join(__dirname, '../audio/clips');
const CONNECT_TIMEOUT_MS  = 15_000;
const PLAYBACK_TIMEOUT_MS = 30_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Split a number string into individual digit clip names: "034" → ['0','3','4'] */
function digitsOf(n) {
    return String(n).replace(/\D/g, '').split('');
}

// ── Clip sequence builder ─────────────────────────────────────────────────────
// Returns an ordered array of clip names (without .wav extension).
// Each name maps to a file in audio/clips/.

function buildClipSequence(trainNumber, defectType, detail = null) {
    const digits = digitsOf(trainNumber);

    switch (defectType) {

        case 'Consist Check': {
            // detail = '<carCount> <speedMph>' — both spoken digit-by-digit
            const seq = ['train', ...digits, 'grdn_detector', 'no_defects_detected'];
            if (detail) {
                const [cars, spd] = detail.trim().split(/\s+/);
                if (cars) seq.push(...digitsOf(cars), 'cars');
                if (spd && spd !== '0') seq.push('speed', ...digitsOf(spd));
            }
            seq.push('end_of_message');
            return seq;
        }

        case 'Derailment':
            return [
                'emergency', 'train', ...digits, 'grdn_detector',
                'derailment_detected', 'stop_immediately_contact_dispatch',
                'end_of_message',
            ];

        case 'Hot Box': {
            const seq = ['attention', 'train', ...digits, 'grdn_detector', 'hotbox_detected'];
            if (detail === 'front truck')   seq.push('front_truck');
            else if (detail === 'rear truck')    seq.push('rear_truck');
            else if (detail === 'wheel bearing') seq.push('wheel_bearing');
            seq.push('reduce_speed_inspect', 'end_of_message');
            return seq;
        }

        case 'Air Hose Defect':
            return [
                'attention', 'train', ...digits, 'grdn_detector',
                'air_hose_defect', 'check_brake_line_reduce_speed',
                'end_of_message',
            ];

        case 'Dragging Equipment':
            return [
                'attention', 'train', ...digits, 'grdn_detector',
                'dragging_equipment', 'stop_train_inspect_consist',
                'end_of_message',
            ];

        case 'call':
            // No "end of message" — mimics a radio page
            return ['train', ...digits, 'contact_dispatch'];

        default:
            throw new Error(`[VoiceAlert] Unknown defect type: "${defectType}"`);
    }
}

// ── Audio stitcher ────────────────────────────────────────────────────────────
// Concatenates clip WAVs via ffmpeg filter_complex and returns a WAV buffer.

async function stitchClips(clipNames) {
    // Verify all clips exist before handing off to ffmpeg
    const missing = clipNames.filter(n => !fs.existsSync(path.join(CLIPS_DIR, `${n}.wav`)));
    if (missing.length > 0) {
        throw new Error(`[VoiceAlert] Missing clips: ${missing.map(n => n + '.wav').join(', ')}`);
    }

    // Single-clip shortcut — skip ffmpeg overhead
    if (clipNames.length === 1) {
        return fs.readFileSync(path.join(CLIPS_DIR, `${clipNames[0]}.wav`));
    }

    // Write to a temp file instead of piping to stdout — avoids Windows pipe issues.
    const tmpFile = path.join(os.tmpdir(), `grdn_${crypto.randomBytes(8).toString('hex')}.wav`);

    return new Promise((resolve, reject) => {
        const inputs    = clipNames.flatMap(n => ['-i', path.join(CLIPS_DIR, `${n}.wav`)]);
        const filterStr = clipNames.map((_, i) => `[${i}:a]`).join('')
                        + `concat=n=${clipNames.length}:v=0:a=1[out]`;

        execFile(FFMPEG_BIN, [
            ...inputs,
            '-filter_complex', filterStr,
            '-map', '[out]',
            '-y',       // overwrite if exists
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
                fs.unlink(tmpFile, () => {}); // cleanup async, don't wait
                resolve(buf);
            } catch (readErr) {
                reject(new Error(`[VoiceAlert] temp file read failed: ${readErr.message}`));
            }
        });
    });
}

// ── Core: join VC, play, leave ────────────────────────────────────────────────

async function playInChannel(voiceChannel, clipNames) {
    const connection = joinVoiceChannel({
        channelId:      voiceChannel.id,
        guildId:        voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf:       false,
        selfMute:       false,
    });

    // Log every state transition so we can see where it gets stuck
    connection.on('stateChange', (oldState, newState) => {
        console.log(`[VoiceAlert] connection: ${oldState.status} -> ${newState.status}`);
        if (newState.status === VoiceConnectionStatus.Disconnected) {
            console.log(`[VoiceAlert] disconnect reason: ${newState.reason} closeCode: ${newState.closeCode}`);
        }
    });

    try {
        // Step 1 — wait for voice connection to be ready
        await entersState(connection, VoiceConnectionStatus.Ready, CONNECT_TIMEOUT_MS)
            .catch(err => { throw new Error(`STEP1_CONNECT: ${err.message}`); });

        // Step 2 — stitch clips with ffmpeg
        const audioBuffer = await stitchClips(clipNames);

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

async function alertTrain(guild, trainNumber, defectType, detail = null) {
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

    const clips = buildClipSequence(trainNumber, defectType, detail);
    await playInChannel(targetVC, clips);
    return { success: true };
}

// ── Alert a specific VC by channel ID ────────────────────────────────────────

async function alertChannel(guild, channelId, trainNumber, defectType, detail = null) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) {
        return { success: false, reason: 'Channel not found or not a voice channel' };
    }
    const clips = buildClipSequence(trainNumber, defectType, detail);
    await playInChannel(channel, clips);
    return { success: true };
}

module.exports = {
    playInChannel,
    alertTrain,
    alertChannel,
    buildClipSequence,
    CLIPS_DIR,
};

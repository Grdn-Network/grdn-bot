// server.js
// Express HTTP server — receives pushes from GRDNConnect instances.
// Runs alongside the Discord bot in index.js.
//
// Environment variables:
//   HTTP_PORT   — port to listen on (default: 3000)
//   HTTP_SECRET — shared secret; set the same value in GRDNConnect settings
//
// Endpoints:
//   POST /radio-change   — move a crew member's Discord VC based on train number
//   POST /defect-alert   — announce a hotbox/defect to opted-in crew
//   POST /update-crew    — re-assign a crew member to a different train (in-game /setcrew)
//   GET  /ping           — health check

const express = require('express');
const storage = require('./database/storage');
const db      = require('./database/db');
const { getCrewVCByChannel } = storage;

// voiceAlert is optional — gracefully absent if @discordjs/voice isn't installed
let alertTrain, alertChannel;
try {
    ({ alertTrain, alertChannel } = require('./utils/voiceAlert'));
} catch {
    alertTrain = alertChannel = null;
}

module.exports = function startServer(client) {
    const app    = express();
    const PORT   = process.env.HTTP_PORT   || 3000;
    const SECRET = process.env.HTTP_SECRET || '';

    app.use(express.json());

    // ── Auth middleware ───────────────────────────────────────────────────────
    app.use((req, res, next) => {
        if (SECRET && req.headers['x-secret'] !== SECRET) {
            console.warn(`[HTTP] Rejected unauthorised request from ${req.ip}`);
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    });

    // ── POST /radio-change ────────────────────────────────────────────────────
    // Body: { trainNumber: string, vcId: string }
    // Looks up crew registered to trainNumber and moves them to the target VC.
    app.post('/radio-change', async (req, res) => {
        const { trainNumber, vcId } = req.body ?? {};
        if (!trainNumber || !vcId) {
            return res.status(400).json({ error: 'Missing trainNumber or vcId' });
        }
        res.json({ ok: true });

        try {
            for (const [, guild] of client.guilds.cache) {
                const crew = storage.getAllCrew(guild.id)
                    .filter(c => String(c.trainNumber) === String(trainNumber));

                for (const c of crew) {
                    const member = await guild.members.fetch(c.userId).catch(() => null);
                    if (!member?.voice?.channel) continue;
                    if (member.voice.channel.id === vcId) continue;
                    await member.voice.setChannel(vcId).catch(err =>
                        console.error(`[Radio] Failed to move ${c.userId}:`, err.message)
                    );
                    console.log(`[Radio] Moved ${c.userId} (train ${trainNumber}) → ${vcId}`);
                }
            }
        } catch (err) {
            console.error('[Radio] Error:', err.message);
        }
    });

    // ── POST /defect-alert ────────────────────────────────────────────────────
    // Body: { trainNumber, defectType, message, detail? }
    //
    // GRDNConnect sends a pre-formatted CSX MicroHBD-style message.
    // Bot joins the VC of opted-in crew and plays it via TTS.
    app.post('/defect-alert', async (req, res) => {
        const { trainNumber, defectType, message } = req.body ?? {};
        if (!trainNumber || !defectType || !message) {
            return res.status(400).json({ error: 'Missing trainNumber, defectType, or message' });
        }
        res.json({ ok: true });

        try {
            for (const [, guild] of client.guilds.cache) {
                const crew = storage.getAllCrew(guild.id)
                    .filter(c => String(c.trainNumber) === String(trainNumber));

                // Special case: consist checks fire even without a matching crew entry
                // (they're informational, not safety-critical)
                const isConsistCheck = defectType === 'Consist Check';

                for (const c of crew) {
                    const pref = db.prepare(
                        `SELECT enabled FROM defect_prefs WHERE user_id = ?`
                    ).get(c.userId);

                    // Defect alerts: opt-in required. Consist checks: always skip if opted out.
                    if (!pref?.enabled && !isConsistCheck) continue;
                    if (!pref?.enabled && isConsistCheck) continue; // consist checks respect opt-in too

                    const member = await guild.members.fetch(c.userId).catch(() => null);
                    if (!member?.voice?.channel) continue;

                    console.log(`[Defect] ${defectType} → ${c.userId} (train ${trainNumber})`);

                    if (alertTrain) {
                        // Pass the pre-formatted message directly
                        alertTrain(guild, trainNumber, message).catch(err =>
                            console.error('[Defect] Voice alert failed:', err.message)
                        );
                        break; // one voice alert per train per event (avoid double-joining)
                    }
                }
            }
        } catch (err) {
            console.error('[Defect] Error:', err.message);
        }
    });

    // ── POST /update-crew ─────────────────────────────────────────────────────
    // Body: { fromTrainNumber: string, toTrainNumber: string }
    //
    // Called by the in-game GRDN Crew CommsRadio mode when a player selects
    // a different loco mid-op. Finds the crew member registered to fromTrainNumber
    // and re-assigns them to toTrainNumber.
    app.post('/update-crew', async (req, res) => {
        const { fromTrainNumber, toTrainNumber } = req.body ?? {};
        if (!fromTrainNumber || !toTrainNumber) {
            return res.status(400).json({ error: 'Missing fromTrainNumber or toTrainNumber' });
        }

        try {
            // LIMIT 1 via rowid subquery — for multi-crew trains, only the
            // most recently registered person is moved. The other crew member
            // stays on the original train. This avoids clobbering both registrations
            // when one of a two-person crew switches locos mid-op.
            const result = db.prepare(`
                UPDATE registrations
                SET train_number = ?
                WHERE rowid IN (
                    SELECT rowid FROM registrations
                    WHERE train_number = ? AND active = 1
                    ORDER BY rowid DESC
                    LIMIT 1
                )
            `).run(toTrainNumber, fromTrainNumber);

            if (result.changes === 0) {
                console.log(`[CrewUpdate] No crew found for train ${fromTrainNumber}`);
                return res.status(404).json({ ok: false, error: 'No crew found for fromTrainNumber' });
            }

            console.log(`[CrewUpdate] Moved ${result.changes} crew member(s): ${fromTrainNumber} → ${toTrainNumber}`);

            // Rename crew VC if they're in one
            try {
                for (const [, guild] of client.guilds.cache) {
                    const crew = storage.getAllCrew(guild.id)
                        .filter(c => String(c.trainNumber) === String(toTrainNumber));

                    for (const c of crew) {
                        const member = await guild.members.fetch(c.userId).catch(() => null);
                        if (!member?.voice?.channel) continue;

                        const vc = getCrewVCByChannel(member.voice.channel.id);
                        if (vc) {
                            await member.voice.channel
                                .setName(`(${toTrainNumber}) | Crew ${vc.crew_number}`)
                                .catch(() => {});
                        }
                    }
                }
            } catch { /* VC rename is best-effort */ }

            return res.json({ ok: true, updated: result.changes });
        } catch (err) {
            console.error('[CrewUpdate] Error:', err.message);
            return res.status(500).json({ ok: false, error: 'Internal error' });
        }
    });

    // ── Health check ──────────────────────────────────────────────────────────
    app.get('/ping', (req, res) => res.json({ ok: true }));

    app.listen(PORT, () => {
        console.log(`[HTTP] Bot server listening on port ${PORT}`);
    });
};

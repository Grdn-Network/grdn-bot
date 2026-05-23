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
const { buildNickname }   = require('./utils/nickname');
const { updateTrainBoard } = require('./utils/trainBoard');
const { TRAIN_BOARD_CHANNEL_ID } = require('./config');

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
                const allCrew = storage.getAllCrew(guild.id);
                const crew = allCrew.filter(c => String(c.trainNumber) === String(trainNumber));

                console.log(`[Radio] Train ${trainNumber} → vcId=${vcId} | ${crew.length}/${allCrew.length} crew matched`);

                for (const c of crew) {
                    const member = await guild.members.fetch(c.userId).catch(() => null);
                    if (!member) {
                        console.log(`[Radio] ${c.preferredName} (${c.userId}): not found in guild`);
                        continue;
                    }
                    if (!member.voice?.channel) {
                        console.log(`[Radio] ${c.preferredName}: not in a voice channel — skipped`);
                        continue;
                    }
                    if (member.voice.channel.id === vcId) {
                        console.log(`[Radio] ${c.preferredName}: already in target channel — skipped`);
                        continue;
                    }
                    await member.voice.setChannel(vcId).catch(err =>
                        console.error(`[Radio] Failed to move ${c.userId}:`, err.message)
                    );
                    console.log(`[Radio] Moved ${c.preferredName} (train ${trainNumber}) → ${vcId}`);
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
        const { trainNumber, defectType, message, detail } = req.body ?? {};
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
                        // Pass structured fields — voiceAlert builds the clip sequence
                        alertTrain(guild, trainNumber, defectType, detail ?? null).catch(err =>
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
    // Body: { fromTrainNumber: string, toTrainNumber: string, locoType?: string }
    //
    // Called by the in-game GRDN Crew CommsRadio mode when a player boards a loco.
    // Finds the crew member registered to fromTrainNumber, moves them to toTrainNumber,
    // and updates their loco_type if provided.
    // After the DB write: refreshes the train board + syncs their Discord nickname.
    app.post('/update-crew', async (req, res) => {
        const { fromTrainNumber, toTrainNumber, locoType } = req.body ?? {};
        if (!fromTrainNumber || !toTrainNumber) {
            return res.status(400).json({ error: 'Missing fromTrainNumber or toTrainNumber' });
        }

        let updatedRow;
        try {
            // LIMIT 1 via rowid subquery — for multi-crew trains, only the most recently
            // registered person is moved. Avoids clobbering both registrations when one
            // of a two-person crew switches locos mid-op.
            const result = db.prepare(`
                UPDATE registrations
                SET train_number = ?,
                    loco_type    = CASE WHEN ? IS NOT NULL THEN ? ELSE loco_type END
                WHERE rowid IN (
                    SELECT rowid FROM registrations
                    WHERE train_number = ? AND active = 1
                    ORDER BY rowid DESC
                    LIMIT 1
                )
            `).run(toTrainNumber, locoType ?? null, locoType ?? null, fromTrainNumber);

            if (result.changes === 0) {
                console.log(`[CrewUpdate] No crew found for train ${fromTrainNumber}`);
                return res.status(404).json({ ok: false, error: 'No crew found for fromTrainNumber' });
            }

            const locoTag = locoType ? ` [${locoType}]` : '';
            console.log(`[CrewUpdate] ${fromTrainNumber} → ${toTrainNumber}${locoTag}`);

            // Fetch the updated row so we can sync nickname + trainboard
            updatedRow = db.prepare(`
                SELECT user_id, type, train_number, loco_type, preferred_name
                FROM registrations
                WHERE train_number = ? AND active = 1
                ORDER BY rowid DESC LIMIT 1
            `).get(toTrainNumber);

            res.json({ ok: true, updated: result.changes });

        } catch (err) {
            console.error('[CrewUpdate] Error:', err.message);
            return res.status(500).json({ ok: false, error: 'Internal error' });
        }

        // ── Post-response: sync nickname, crew VC name, and train board ────────
        // These run after the HTTP response is sent — failures are non-fatal.
        try {
            for (const [, guild] of client.guilds.cache) {
                const crew = storage.getAllCrew(guild.id)
                    .filter(c => String(c.trainNumber) === String(toTrainNumber));

                for (const c of crew) {
                    const member = await guild.members.fetch(c.userId).catch(() => null);
                    if (!member) continue;

                    // Sync Discord nickname
                    if (updatedRow) {
                        const nick = buildNickname(
                            updatedRow.type,
                            updatedRow.train_number,
                            updatedRow.preferred_name
                        );
                        await member.setNickname(nick).catch(() => {});
                    }

                    // Rename crew VC if they're in one
                    if (member.voice?.channel) {
                        const vc = getCrewVCByChannel(member.voice.channel.id);
                        if (vc) {
                            await member.voice.channel
                                .setName(`(${toTrainNumber}) | Crew ${vc.crew_number}`)
                                .catch(() => {});
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[CrewUpdate] Post-sync error:', err.message);
        }

        // Refresh train board if a session is active
        try {
            for (const [, guild] of client.guilds.cache) {
                if (!storage.getActiveSession(guild.id)) continue;
                await updateTrainBoard(client, guild.id, TRAIN_BOARD_CHANNEL_ID);
            }
        } catch (err) {
            console.error('[CrewUpdate] TrainBoard refresh failed:', err.message);
        }
    });

    // ── Health check ──────────────────────────────────────────────────────────
    app.get('/ping', (req, res) => res.json({ ok: true }));

    app.listen(PORT, () => {
        console.log(`[HTTP] Bot server listening on port ${PORT}`);
    });
};

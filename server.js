// server.js
// Express HTTP server — receives pushes from GRDNConnect instances.
// Runs alongside the Discord bot in index.js.
//
// Environment variables:
//   HTTP_PORT   — port to listen on (default: 3000)
//   HTTP_SECRET — shared secret; set the same value in GRDNConnect settings

const express = require('express');
const storage = require('./database/storage');

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
    // GRDNConnect pushes this when a player tunes to a different radio channel.
    //
    // Body: { trainNumber: string, vcId: string }
    //
    // The bot looks up which Discord user(s) are registered to that train
    // number — no per-player Discord ID config needed in GRDNConnect.
    // Multi-crewed trains: all crew on that train are moved.
    app.post('/radio-change', async (req, res) => {
        const { trainNumber, vcId } = req.body ?? {};

        if (!trainNumber || !vcId) {
            return res.status(400).json({ error: 'Missing trainNumber or vcId' });
        }

        // Acknowledge immediately — don't keep GRDNConnect waiting
        res.json({ ok: true });

        try {
            for (const [, guild] of client.guilds.cache) {
                // Find all crew registered to this train number
                const crew = storage.getAllCrew(guild.id)
                    .filter(c => String(c.trainNumber) === String(trainNumber));

                if (crew.length === 0) {
                    console.log(`[Radio] No crew found for train ${trainNumber}`);
                    continue;
                }

                for (const c of crew) {
                    const member = await guild.members.fetch(c.userId).catch(() => null);
                    if (!member) continue;

                    if (!member.voice?.channel) {
                        console.log(`[Radio] ${c.userId} (train ${trainNumber}) not in a VC — skipping`);
                        continue;
                    }

                    // Already in the right channel
                    if (member.voice.channel.id === vcId) continue;

                    await member.voice.setChannel(vcId).catch(err => {
                        console.error(`[Radio] Failed to move ${c.userId}:`, err.message);
                    });

                    console.log(`[Radio] Moved ${c.userId} (train ${trainNumber}) → ${vcId}`);
                }
            }
        } catch (err) {
            console.error('[Radio] Error handling radio-change:', err.message);
        }
    });

    // ── Health check ──────────────────────────────────────────────────────────
    app.get('/ping', (req, res) => res.json({ ok: true }));

    app.listen(PORT, () => {
        console.log(`[HTTP] Bot server listening on port ${PORT}`);
    });
};

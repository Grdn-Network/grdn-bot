// server.js
// Express HTTP server — receives pushes from GRDNConnect instances.
// Runs alongside the Discord bot in index.js.
//
// Environment variables:
//   HTTP_PORT   — port to listen on (default: 3000)
//   HTTP_SECRET — shared secret; set the same value in GRDNConnect settings

const express = require('express');

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
    // Body: { discordUserId: string, vcId: string }
    //
    // Moves the Discord user to the target VC.
    // If they're not currently in any VC, does nothing (Discord won't allow it).
    app.post('/radio-change', async (req, res) => {
        const { discordUserId, vcId } = req.body ?? {};

        if (!discordUserId || !vcId) {
            return res.status(400).json({ error: 'Missing discordUserId or vcId' });
        }

        // Acknowledge immediately — don't keep GRDNConnect waiting
        res.json({ ok: true });

        try {
            // Find the member across all guilds the bot is in
            for (const [, guild] of client.guilds.cache) {
                const member = await guild.members.fetch(discordUserId).catch(() => null);
                if (!member) continue;

                if (!member.voice?.channel) {
                    console.log(`[Radio] ${discordUserId} not in a VC — skipping move`);
                    return;
                }

                // Already in the right channel — nothing to do
                if (member.voice.channel.id === vcId) return;

                await member.voice.setChannel(vcId).catch(err => {
                    console.error(`[Radio] Failed to move ${discordUserId}:`, err.message);
                });

                console.log(`[Radio] Moved ${discordUserId} → ${vcId}`);
                return; // Found and handled — stop searching guilds
            }

            console.warn(`[Radio] User ${discordUserId} not found in any guild`);
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

// utils/staleSessions.js
// Safety net for an op that was started and never ended.
//
// Leaving voice already closes a user's hours entry on its own, so an empty
// channel is harmless. The only real exposure is someone parked in a VC after
// the op is socially over: their entry stays open, and getUserHours counts an
// open entry as live time, so their hours climb indefinitely.
//
// This closes any session left open far longer than a real op could run, which
// writes final minutes and closes the entries. Note that closing orphans on
// startup would be wrong: update.bat restarts the bot mid-op, so that would end
// live sessions. Ageing them out is the safe version.

const { EmbedBuilder } = require('discord.js');
const db = require('../database/db');
const storage = require('../database/storage');
const { DISPATCH_CHANNEL_ID } = require('../config');
const { buildDispatchEmbed } = require('./dispatchEmbed');
const { sendLog } = require('../logging/logHelper');
const loggingConfig = require('../config/logging.json');

// No real op runs this long, so anything older is a forgotten End Op.
const MAX_SESSION_MS = 18 * 60 * 60 * 1000;

// How often to look for them.
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

/** Closes any session that has been open longer than MAX_SESSION_MS. Never throws. */
async function sweepStaleSessions(client) {
    try {
        for (const session of storage.getStaleSessions(MAX_SESSION_MS)) {
            const now   = Date.now();
            const hours = ((now - session.started_at) / 3_600_000).toFixed(1);

            // closeSession writes final minutes for every open entry and clears
            // session_crew, which is what actually stops the hours clock.
            const closedId = storage.closeSession(session.guild_id, client.user?.id ?? null, now);
            if (!closedId) continue;

            db.prepare(`UPDATE dispatch_settings SET ops_active = 0 WHERE id = 1`).run();
            console.warn(`[StaleSweep] Auto-closed session ${session.id} (${session.session_type}) after ${hours}h`);

            await refreshDispatchEmbed(client, session.guild_id);

            const embed = new EmbedBuilder()
                .setTitle('🟠 Stale Ops Session Auto-Closed')
                .setColor(0xffaa00)
                .addFields(
                    { name: 'Session',  value: `#${session.id} (${session.session_type})`, inline: true },
                    { name: 'Open for', value: `${hours} h`,                                inline: true },
                    {
                        name: 'Why',
                        value: 'This session was never ended, so the hours clock was still running for anyone sitting in voice. '
                             + 'Hours have been saved and the clock stopped. Nicknames and crew VCs were left alone, so tidy those up if needed.',
                    },
                )
                .setTimestamp();
            sendLog(client, loggingConfig.logChannel, embed);
        }
    } catch (err) {
        console.error('[StaleSweep]', err.message);
    }
}

async function refreshDispatchEmbed(client, guildId) {
    try {
        const row = db.prepare(`SELECT message_id FROM dispatch_embed WHERE id = 1`).get();
        if (!row) return;
        const channel = client.guilds.cache.get(guildId)?.channels?.cache?.get(DISPATCH_CHANNEL_ID);
        if (!channel) return;
        const msg = await channel.messages.fetch(row.message_id).catch(() => null);
        if (msg) await msg.edit({ embeds: [buildDispatchEmbed()], components: msg.components });
    } catch (err) {
        console.error('[StaleSweep] embed refresh failed:', err.message);
    }
}

module.exports = { sweepStaleSessions, MAX_SESSION_MS, SWEEP_INTERVAL_MS };

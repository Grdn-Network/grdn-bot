// utils/sessionConfig.js
// Builds and pushes /session-config to the host's GRDNConnect.
//
// One place decides what a host is told and when, so change detection and cadence
// live on the bot rather than in the mod. The mod stores what it is given and
// relays the client half to its clients; it never polls for any of it.
//
// What a host is sent:
//   botUrl       — BOT_PUBLIC_URL, where the mod sends its own requests
//   secret       — the host token. Opens every endpoint. Stays on the host.
//   clientSecret — the client token. The host relays this one to its clients.
//   channels     — the crew voice channels, in Discord order
//
// When:
//   /session start            forced, with a freshly minted token pair
//   crew VC added/removed/renamed   on the Discord event, skipped if nothing changed
//   RECONCILE_MS              forced, so a host that restarted mid-session and lost
//                             its config gets it back without anyone noticing
const fetch = require('node-fetch');
const { ChannelType } = require('discord.js');
const { CREW_VC_CATEGORY_ID } = require('../config');
const { cfAccessHeaders } = require('./hostConnect');
const sessionAuth = require('./sessionAuth');
const storage = require('../database/storage');

const PUSH_TIMEOUT_MS = 3000;

// Last payload a host accepted, keyed by its connect URL, so an unchanged push
// costs a Map lookup instead of a request. Cleared on any failure, because a host
// that rejected or missed a push must be told again.
const lastPushed = new Map();

// The crew voice channels as the mod should see them: Discord order, name + id.
function crewChannels(guild) {
    return [...guild.channels.cache.values()]
        .filter(ch => ch.parentId === CREW_VC_CATEGORY_ID && ch.type === ChannelType.GuildVoice)
        .sort((a, b) => a.rawPosition - b.rawPosition)
        .map(ch => ({ name: ch.name, vcId: ch.id }));
}

// Tokens are deliberately not part of this. They only change when minted, and a
// mint always forces a push.
function fingerprint(botUrl, channels) {
    return JSON.stringify([botUrl, channels]);
}

// True when this channel is one the mod cares about, so unrelated channel edits
// across the server do not trigger a push.
function isCrewChannel(channel) {
    return channel?.parentId === CREW_VC_CATEGORY_ID
        && channel?.type === ChannelType.GuildVoice;
}

/**
 * Push session config to the host, unless nothing has changed.
 *
 * @param {Guild}   guild
 * @param {object}  [opts]
 * @param {boolean} [opts.force] push even when the payload is unchanged
 * @param {boolean} [opts.mint]  mint a fresh token pair first (implies force)
 * @param {string}  [opts.reason] shown in the log line
 * @returns {Promise<{pushed: boolean, skipped?: string, error?: string, status?: number}>}
 */
async function pushSessionConfig(guild, { force = false, mint = false, reason = '' } = {}) {
    const connectUrl = storage.getDvBaseUrl();
    if (!connectUrl) return { pushed: false, skipped: 'no host tunnel' };

    const botUrl = process.env.BOT_PUBLIC_URL || '';
    if (!botUrl) {
        console.warn('[SessionConfig] BOT_PUBLIC_URL not set in .env — host will fall back to connect.cfg');
        return { pushed: false, skipped: 'BOT_PUBLIC_URL unset' };
    }

    let tokens = mint ? sessionAuth.mintTokens() : sessionAuth.currentTokens();
    if (mint) force = true;

    // No live pair means the bot restarted mid-session, so whatever the host holds
    // is already dead. Mint and tell it, whatever the fingerprint says.
    if (!tokens.hostToken || !tokens.clientToken) {
        tokens = sessionAuth.mintTokens();
        force  = true;
    }

    const channels = crewChannels(guild);
    const stamp    = fingerprint(botUrl, channels);

    if (!force && lastPushed.get(connectUrl) === stamp) {
        return { pushed: false, skipped: 'unchanged' };
    }

    const why = reason ? ` (${reason})` : '';

    try {
        const res = await fetch(`${connectUrl}/session-config`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', ...cfAccessHeaders() },
            body:    JSON.stringify({
                botUrl,
                secret:       tokens.hostToken,
                clientSecret: tokens.clientToken,
                channels,
            }),
            timeout: PUSH_TIMEOUT_MS,
        });

        if (!res.ok) {
            lastPushed.delete(connectUrl);
            console.warn(`[SessionConfig] Host returned ${res.status}${why}`);
            return { pushed: false, status: res.status };
        }

        lastPushed.set(connectUrl, stamp);
        console.log(`[SessionConfig] Pushed to host — ${channels.length} channel(s)${why}`);
        return { pushed: true };
    } catch (err) {
        // Unknown host state. Drop the fingerprint so the next attempt pushes rather
        // than deciding nothing changed.
        lastPushed.delete(connectUrl);
        console.warn(`[SessionConfig] Could not reach host${why}: ${err.message}`);
        return { pushed: false, error: err.message };
    }
}

// Forget what a host is believed to hold, so the next push is unconditional.
// Call when a host may have restarted.
function forgetHost(connectUrl) {
    if (connectUrl) lastPushed.delete(connectUrl);
    else            lastPushed.clear();
}

module.exports = { pushSessionConfig, crewChannels, isCrewChannel, forgetHost };

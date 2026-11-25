// utils/sessionAuth.js
// Per-session auth tokens for GRDNConnect -> bot requests.
//
// Two tokens are minted per session, not one:
//
//   host   — held only by the host's game. Opens every endpoint.
//   client — relayed by the host to its clients over the Derail Valley multiplayer
//            packet channel. Opens only the endpoints a client needs for radio and
//            crew voice (see CLIENT_ROUTES in server.js).
//
// The split exists because a client has to be given a credential for voice
// switching to work at all, and that credential is in the hands of every player in
// the session. A single token would mean any client could also reassign crew, push
// stats or overwrite the mod preset.
//
// In-memory by design: tokens live only for the running process. A bot restart
// mid-session drops them, and the next config push mints a fresh pair and sends it
// to the host. Fine for ops-length sessions.
const crypto = require('crypto');

// Only one ops session runs at a time per server, so one pair is enough.
// Map of token -> role.
let tokens = new Map();

// Mint a fresh pair, replacing any previous one.
function mintTokens() {
    const hostToken   = crypto.randomBytes(24).toString('hex');
    const clientToken = crypto.randomBytes(24).toString('hex');

    tokens = new Map([
        [hostToken,   'host'],
        [clientToken, 'client'],
    ]);

    return { hostToken, clientToken };
}

// 'host', 'client', or null when the token is unknown or absent.
function roleOf(token) {
    if (typeof token !== 'string' || token.length === 0) return null;
    return tokens.get(token) ?? null;
}

// The live pair, or null for each token with no session (or after a bot restart).
function currentTokens() {
    let hostToken = null;
    let clientToken = null;
    for (const [token, role] of tokens) {
        if (role === 'host')   hostToken   = token;
        if (role === 'client') clientToken = token;
    }
    return { hostToken, clientToken };
}

// Drop both tokens. Call on session end.
function clear() {
    tokens = new Map();
}

module.exports = { mintTokens, roleOf, currentTokens, clear };

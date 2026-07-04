// utils/sessionAuth.js
// Per-session auth tokens for GRDNConnect -> bot requests.
//
// Replaces the reused global HTTP_SECRET with a random token minted when an ops
// session opens and revoked when it closes. The bot pushes the token to the host
// via /session-config; the host relays it to clients via /client-config, so no
// secret is ever compiled into the distributed mod.
//
// In-memory by design: tokens live only for the running process. A bot restart
// mid-session drops the token, and auth falls back to HTTP_SECRET (see server.js)
// until the next /session start re-mints one. Fine for ops-length sessions.
const crypto = require('crypto');

// Only one ops session runs at a time per server, so a single active token is enough.
const activeTokens = new Set();

// Mint a fresh token, replacing any previous one, and return it.
function mintToken() {
    const token = crypto.randomBytes(24).toString('hex');
    activeTokens.clear();
    activeTokens.add(token);
    return token;
}

// True only for a currently-valid session token.
function isValid(token) {
    return typeof token === 'string' && token.length > 0 && activeTokens.has(token);
}

// Drop all tokens. Call on session end.
function clear() {
    activeTokens.clear();
}

module.exports = { mintToken, isValid, clear };

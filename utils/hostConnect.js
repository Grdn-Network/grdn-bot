// utils/hostConnect.js
// Helpers for bot -> host GRDNConnect requests. Hosts are only reached through
// their Cloudflare tunnel: https://<name>-connect.grdnnetwork.com

const TUNNEL_URL = /^https:\/\/[a-z0-9-]+-connect\.grdnnetwork\.com$/i;

// True for a host tunnel URL (no trailing slash). Raw IPs and other hosts are refused.
function isTunnelUrl(url) {
    return typeof url === 'string' && TUNNEL_URL.test(url);
}

// Cloudflare Access service-token headers. Empty until CF_ACCESS_CLIENT_ID and
// CF_ACCESS_CLIENT_SECRET are set in .env, so it's a no-op before the lock is on.
function cfAccessHeaders() {
    const id     = process.env.CF_ACCESS_CLIENT_ID;
    const secret = process.env.CF_ACCESS_CLIENT_SECRET;
    return id && secret
        ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret }
        : {};
}

module.exports = { isTunnelUrl, cfAccessHeaders };

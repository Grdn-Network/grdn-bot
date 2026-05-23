// UDP connectivity diagnostic — run with: node test-udp.js
// Tests whether outbound UDP works from this machine on various ports.
// STUN tests actually get a response, so they confirm two-way UDP, not just sends.

const dgram   = require('dgram');
const crypto  = require('crypto');

// ── DNS test (sends a real query, expects a real response) ───────────────────
function testDNS(host, port, label) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        let done = false;
        const finish = (r) => { if (done) return; done = true; try { socket.close(); } catch {} resolve({ label, result: r }); };

        const query = Buffer.from([
            0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,
            0x07,0x64,0x69,0x73,0x63,0x6f,0x72,0x64,0x03,0x63,0x6f,0x6d,
            0x00,0x00,0x01,0x00,0x01,
        ]);
        socket.on('error',   (e)   => finish(`FAILED — ${e.message}`));
        socket.on('message', (msg) => finish(`✅ OK — got ${msg.length}b response`));
        socket.send(query, port, host, (e) => { if (e) finish(`SEND FAILED — ${e.message}`); });
        setTimeout(() => finish('❌ TIMEOUT — no response (UDP blocked or unreachable)'), 3000);
    });
}

// ── STUN test (RFC 5389 Binding Request — expects a Binding Response) ────────
// STUN servers reply with your external IP, proving 2-way UDP on that port.
function testSTUN(host, port, label) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        let done = false;
        const finish = (r) => { if (done) return; done = true; try { socket.close(); } catch {} resolve({ label, result: r }); };

        const req = Buffer.alloc(20);
        req.writeUInt16BE(0x0001, 0);   // Binding Request
        req.writeUInt16BE(0x0000, 2);   // Length 0
        req.writeUInt32BE(0x2112A442, 4); // Magic Cookie
        crypto.randomBytes(12).copy(req, 8);

        socket.on('error',   (e)   => finish(`FAILED — ${e.message}`));
        socket.on('message', (msg) => finish(`✅ OK — got ${msg.length}b STUN response (2-way UDP confirmed)`));
        socket.send(req, port, host, (e) => { if (e) finish(`SEND FAILED — ${e.message}`); });
        setTimeout(() => finish('❌ TIMEOUT — no STUN response (port likely blocked)'), 3000);
    });
}

(async () => {
    console.log('Testing outbound UDP from this machine...\n');

    const results = await Promise.all([
        testDNS ('1.1.1.1',             53,    'DNS  — Cloudflare   port 53    (baseline)'),
        testDNS ('8.8.8.8',             53,    'DNS  — Google       port 53    (baseline)'),
        testSTUN('stun.l.google.com',   19302, 'STUN — Google       port 19302 (mid-range)'),
        testSTUN('stun1.l.google.com',  3478,  'STUN — Google       port 3478  (standard STUN)'),
        testSTUN('stun.cloudflare.com', 3478,  'STUN — Cloudflare   port 3478  (standard STUN)'),
    ]);

    for (const r of results) console.log(`  ${r.label}\n    → ${r.result}\n`);

    console.log('─────────────────────────────────────────────────────────');
    console.log('Reading results:');
    console.log('  DNS OK + STUN OK  → UDP works fine, issue is elsewhere');
    console.log('  DNS OK + STUN ❌  → mid/high ports blocked by Azure NSG');
    console.log('  DNS ❌            → ALL outbound UDP blocked');
})();

// Quick UDP connectivity diagnostic
// Run: node test-udp.js
// Tests whether outbound UDP works at all from this machine.

const dgram = require('dgram');

function testUDP(host, port, label) {
    return new Promise((resolve) => {
        const socket = dgram.createSocket('udp4');
        let done = false;

        const finish = (result) => {
            if (done) return;
            done = true;
            socket.close();
            resolve(result);
        };

        socket.on('error', (err) => finish({ label, host, port, result: `FAILED — ${err.message}` }));

        // Send a tiny DNS-style query so the remote end can respond
        const msg = Buffer.from([
            0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,
            0x07,0x64,0x69,0x73,0x63,0x6f,0x72,0x64,
            0x03,0x63,0x6f,0x6d,0x00,0x00,0x01,0x00,0x01
        ]);

        socket.send(msg, port, host, (err) => {
            if (err) return finish({ label, host, port, result: `SEND FAILED — ${err.message}` });
        });

        socket.on('message', () => finish({ label, host, port, result: 'OK — got response' }));

        setTimeout(() => finish({ label, host, port, result: 'TIMEOUT — no response (may be blocked or just not a DNS server)' }), 3000);
    });
}

(async () => {
    console.log('Testing outbound UDP from this machine...\n');

    const tests = [
        testUDP('1.1.1.1',   53,    'Cloudflare DNS    (UDP port 53   — low port, should always work)'),
        testUDP('8.8.8.8',   53,    'Google DNS        (UDP port 53   — second low-port check)'),
        testUDP('1.1.1.1',   50000, 'Cloudflare        (UDP port 50000 — Discord voice range)'),
        testUDP('1.1.1.1',   55000, 'Cloudflare        (UDP port 55000 — Discord voice range)'),
    ];

    const results = await Promise.all(tests);
    for (const r of results) {
        const icon = r.result.startsWith('OK') ? '✅' : r.result.startsWith('TIMEOUT') ? '⚠️' : '❌';
        console.log(`${icon}  ${r.label}\n    → ${r.result}\n`);
    }

    console.log('Notes:');
    console.log('  DNS tests (port 53) RESPOND — they confirm UDP send+receive works.');
    console.log('  High-port tests will TIMEOUT even if working — no service listens there.');
    console.log('  If port 53 times out → Azure NSG is blocking ALL outbound UDP.');
    console.log('  If port 53 works but voice still fails → high ports (50000+) are blocked.');
})();

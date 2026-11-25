# How GRDNConnect and the bot authenticate

Traffic goes both ways. The host's game calls the bot for radio switches, crew updates and stats. The bot calls the host's game for session config, jobs, locos and server info.

## Game to bot: session tokens

Every request from the game carries an `x-secret` header.

When a host clicks Start Op, the bot mints a random token for that op and sends it to the host's game with `POST /session-config`. The host's mod hands it to every client over the Multiplayer connection. Nobody types a secret into UMM settings.

The token dies when the op ends. If the bot restarts mid-op, the 90 second channel push mints a new one and sends it to the host, so things recover by themselves.

## HTTP_SECRET

The old shared secret. It lives only in the VPS `.env`, and the bot never sends it anywhere. The bot still accepts it so older Connect builds keep working. That fallback goes away at 1.0 (see the `TODO(1.0)` in `server.js`).

Rotate it on the VPS:

1. Make a new value with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Paste it into `HTTP_SECRET=` in `.env`.
3. Run `restart.bat`.

Nobody notices during an op, since Connect uses the session token first. Builds that only know `HTTP_SECRET` stop working until they update.

## Bot to game: host tunnels

The bot only talks to a host at `https://<name>-connect.grdnnetwork.com`. `host-tunnels.json` on the VPS maps each host's Discord ID to their tunnel name. If you're not in it, Start Op tells you to ask DVMP Command and doesn't open a session. Raw IP addresses aren't accepted.

## Cloudflare Access (planned)

A Cloudflare Access service token is going in front of the `-connect` hostnames. Once that's on, every bot request to a host sends `CF-Access-Client-Id` and `CF-Access-Client-Secret`, read from the VPS `.env`:

```
CF_ACCESS_CLIENT_ID=
CF_ACCESS_CLIENT_SECRET=
```

Leave both blank until the Access policy is live. If either is blank, the bot sends no Access headers.

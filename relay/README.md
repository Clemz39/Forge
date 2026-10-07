# Forge Relay

Forge Relay lets your phone sync with Forge on your computer when the two aren't on the same Wi-Fi.

## What it can and can't see

The relay is a mailbox. Your computer keeps one connection open to it. Your phone hands it a request for your computer, and it passes the answer back.

Every request and answer is encrypted on your devices with the key they agreed when you paired them. The relay can't read or change your notes, files or AI chats. It sees only:
- the size and timing of requests
- the IP addresses they come from

It writes nothing to disk and forgets everything when it restarts.

## Run it

You need a server with a public address that your phone can reach, such as a small VPS or a home server behind a router port-forward. Use HTTPS: put it behind a reverse proxy like Caddy or nginx, or pass a certificate directly.

**Node 18 or newer, no dependencies:**

```
node server.js                      # listens on port 8787
PORT=443 TLS_CERT=cert.pem TLS_KEY=key.pem node server.js
```

**Docker:**

```
docker build -t forge-relay .
docker run -d --restart unless-stopped -p 8787:8787 forge-relay
```

**Caddy in front, with automatic HTTPS:**

```
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

Behind a proxy, set `TRUST_PROXY=1` so rate limiting uses the real client address.

## Connect Forge

1. On your computer, open **Forge → Settings → Synchronization → Away from home**.
2. Enter the relay's address (for example `https://relay.example.com`) and choose **Connect**.
3. Sync your phone once on the same Wi-Fi so it learns the relay.

After that, the phone uses Wi-Fi when it's home and the relay when it isn't. Forge on the computer must be running, either with its window open or in the system tray.

## Settings

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 8787 | Port to listen on |
| `HOST` | 0.0.0.0 | Address to bind |
| `TLS_CERT`, `TLS_KEY` | — | Serve HTTPS directly |
| `MAX_BODY_MB` | 64 | Largest single request (attachments are sent in pieces) |
| `TRUST_PROXY` | off | Read the client address from `X-Forwarded-For` |

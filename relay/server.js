#!/usr/bin/env node
'use strict';
/*
 * Forge Relay — lets a phone sync with Forge on a computer when they aren't on the same Wi-Fi.
 *
 * It is a mailbox, nothing more. Forge on the computer keeps one long request open ("anything for me?"); the phone
 * posts a request for that computer; the relay hands it over and passes the answer back. Every request and answer
 * is already encrypted end to end with the key the two devices agreed when they paired, so the relay can't read or
 * change notes. It stores nothing on disk and forgets everything when it restarts.
 *
 *   GET  /health                               → "ok"
 *   GET  /v1/hub/<hub>/next      (X-Forge-Token) → 200 {rid, path, body} or 204 after ~25 s
 *   POST /v1/hub/<hub>/reply/<rid> (X-Forge-Token) body {status, body}
 *   POST /v1/send/<hub>/v1/<route>              body: the phone's sealed request → the computer's sealed answer
 *
 * <hub> is a random 128-bit id the computer shares with its paired phones (inside the encrypted channel). The first
 * computer to poll a hub id fixes its token; afterwards only that token can collect or answer requests for it.
 *
 * Settings (environment): PORT (8787), HOST (0.0.0.0), TLS_CERT + TLS_KEY (files, to serve https directly),
 * MAX_BODY_MB (64), TRUST_PROXY=1 (behind a proxy that sets X-Forwarded-For).
 * No dependencies: run with `node server.js` on Node 18 or newer.
 */
const http = require('http'), https = require('https'), crypto = require('crypto'), fs = require('fs');

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const MAX_BODY = (Number(process.env.MAX_BODY_MB) || 64) * 1048576;
const POLL_MS = 25000, ANSWER_MS = 300000, OFFLINE_MS = 75000, MAX_QUEUE = 64, IDLE_HUB_MS = 24 * 3600e3;
const HUB_RX = /^[0-9a-f]{32}$/, RID_RX = /^[0-9a-f]{24}$/, ROUTE_RX = /^\/v1\/(status|sync|ai\/chat|blob\/has|blob\/put|blob\/get|unpair)$/;

const hubs = new Map();   // hub id → { tok, lastPoll, queue: [], polls: [], pending: Map(rid → {res, timer}) }
const hashTok = (t) => crypto.createHash('sha256').update(String(t)).digest();
function hubFor(id) { let h = hubs.get(id); if (!h) { h = { tok: null, lastPoll: 0, queue: [], polls: [], pending: new Map(), seen: Date.now() }; hubs.set(id, h); } h.seen = Date.now(); return h; }
function tokOk(h, t) {
  if (!t || String(t).length < 32) return false;
  const x = hashTok(t);
  if (!h.tok) { h.tok = x; return true; }
  return crypto.timingSafeEqual(h.tok, x);
}

/* simple per-address rate limit: a burst of 120, then 20 requests a second */
const buckets = new Map();
function allowed(ip) {
  const t = Date.now(); let b = buckets.get(ip);
  if (!b) { b = { n: 120, t }; buckets.set(ip, b); }
  b.n = Math.min(120, b.n + (t - b.t) / 50); b.t = t;
  if (b.n < 1) return false; b.n -= 1; return true;
}
setInterval(() => {
  const t = Date.now();
  for (const [ip, b] of buckets) if (t - b.t > 600000) buckets.delete(ip);
  for (const [id, h] of hubs) if (t - h.seen > IDLE_HUB_MS && !h.pending.size && !h.polls.length) hubs.delete(id);
}, 60000).unref();

function send(res, code, body, type) {
  if (res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function deliver(h) {
  while (h.polls.length && h.queue.length) {
    const p = h.polls.shift(); clearTimeout(p.timer);
    const m = h.queue.shift();
    send(p.res, 200, { rid: m.rid, path: m.path, body: m.body });
  }
}

async function handle(req, res) {
  const ip = (process.env.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const url = new URL(req.url, 'http://relay');
  const p = url.pathname;
  if (p === '/health') return send(res, 200, 'ok', 'text/plain');
  if (!allowed(ip)) return send(res, 429, { error: 'Too many requests' });
  let m;

  // the computer collects the next request
  if (req.method === 'GET' && (m = p.match(/^\/v1\/hub\/([^/]+)\/next$/))) {
    if (!HUB_RX.test(m[1])) return send(res, 404, { error: 'Not found' });
    const h = hubFor(m[1]);
    if (!tokOk(h, req.headers['x-forge-token'])) return send(res, 403, { error: 'This relay mailbox belongs to another computer.' });
    h.lastPoll = Date.now();
    if (h.polls.length > 4) { const old = h.polls.shift(); clearTimeout(old.timer); send(old.res, 204, ''); }
    const poll = { res, timer: setTimeout(() => { h.polls = h.polls.filter((x) => x !== poll); send(res, 204, ''); }, POLL_MS) };
    h.polls.push(poll);
    res.on('close', () => { clearTimeout(poll.timer); h.polls = h.polls.filter((x) => x !== poll); });
    return deliver(h);
  }

  // the computer answers one request
  if (req.method === 'POST' && (m = p.match(/^\/v1\/hub\/([^/]+)\/reply\/([^/]+)$/))) {
    if (!HUB_RX.test(m[1]) || !RID_RX.test(m[2])) return send(res, 404, { error: 'Not found' });
    const h = hubs.get(m[1]);
    if (!h || !h.tok || !tokOk(h, req.headers['x-forge-token'])) return send(res, 403, { error: 'Forbidden' });
    h.lastPoll = Date.now();
    let j;
    try { j = JSON.parse((await readBody(req, MAX_BODY)).toString('utf8')); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: 'Bad reply' }); }
    const w = h.pending.get(m[2]);
    if (!w) return send(res, 410, { error: 'The phone stopped waiting' });
    h.pending.delete(m[2]); clearTimeout(w.timer);
    const code = Number(j.status) >= 200 && Number(j.status) < 600 ? Number(j.status) : 502;
    send(w.res, code, String(j.body || ''), code === 200 ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
    return send(res, 200, { ok: true });
  }

  // a phone sends a sealed request to its computer and waits for the sealed answer
  if (req.method === 'POST' && (m = p.match(/^\/v1\/send\/([^/]+)(\/.*)$/))) {
    if (!HUB_RX.test(m[1]) || !ROUTE_RX.test(m[2])) return send(res, 404, { error: 'Not found' });
    const h = hubs.get(m[1]);
    if (!h || Date.now() - h.lastPoll > OFFLINE_MS) return send(res, 503, { error: 'offline', message: 'Forge isn’t running on your computer, or it can’t reach the relay.' });
    if (h.queue.length + h.pending.size >= MAX_QUEUE) return send(res, 429, { error: 'Your computer is busy. Try again in a moment.' });
    let body;
    try { body = (await readBody(req, MAX_BODY)).toString('utf8'); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: 'Bad request' }); }
    const rid = crypto.randomBytes(12).toString('hex');
    const w = { res, timer: setTimeout(() => { h.pending.delete(rid); h.queue = h.queue.filter((x) => x.rid !== rid); send(res, 504, { error: 'Your computer took too long to answer.' }); }, ANSWER_MS) };
    h.pending.set(rid, w);
    res.on('close', () => { if (h.pending.get(rid) === w) { clearTimeout(w.timer); h.pending.delete(rid); h.queue = h.queue.filter((x) => x.rid !== rid); } });
    h.queue.push({ rid, path: m[2], body });
    return deliver(h);
  }
  return send(res, 404, { error: 'Not found' });
}

const onReq = (req, res) => { handle(req, res).catch((e) => { console.error(e); send(res, 500, { error: 'Relay error' }); }); };
const server = process.env.TLS_CERT && process.env.TLS_KEY
  ? https.createServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }, onReq)
  : http.createServer(onReq);
server.requestTimeout = 0;            // long polls and slow AI answers
server.headersTimeout = 30000;
server.keepAliveTimeout = 65000;
server.listen(PORT, HOST, () => console.log(`Forge Relay listening on ${process.env.TLS_CERT ? 'https' : 'http'}://${HOST}:${PORT}`));
module.exports = { server };

#!/usr/bin/env node
// 2qo Hub — a tiny community relay you can run on a laptop, Raspberry Pi or Android (Termux)
// on any local network or phone hotspot. No internet required.
//
//  • serves the built 2qo PWA (dist/) so phones can install the app straight from the hub
//  • relays end-to-end encrypted envelopes (the hub cannot read messages)
//  • store-and-forward: keeps envelopes for people who are offline (14 days)
//  • presence + postcode-aware directory ("people near me")
//  • optional /api/postcode proxy to NIPOST's API, keeping your API key on the hub
//
// Usage:  npm run build && npm run hub        (PORT=8787 HOST=0.0.0.0 POSTCODE_API_KEY=...)
//         HTTPS=1 npm run hub   → self-signed HTTPS so phones on the LAN get a secure context
//                                (needed for encryption, mic, camera and installing the PWA)
//         TLS_CERT=cert.pem TLS_KEY=key.pem npm run hub   → your own certificate
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';
import { proximity, parse } from '../src/lib/postcode/format.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, '..', 'dist');
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const PORT = +process.env.PORT || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const POSTCODE_API = (process.env.POSTCODE_API || 'https://api.postcode.gov.ng').replace(/\/$/, '');
const POSTCODE_KEY = process.env.POSTCODE_API_KEY || '';
const QUEUE_DAYS = 14;
const MAX_QUEUE = 1000;

mkdirSync(DATA, { recursive: true });
const load = (f, d) => {
  try {
    return JSON.parse(readFileSync(join(DATA, f), 'utf8'));
  } catch {
    return d;
  }
};
const directory = new Map(Object.entries(load('directory.json', {})));
const queue = new Map(Object.entries(load('queue.json', {})));
let dirty = false;
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  writeFileSync(join(DATA, 'directory.json'), JSON.stringify(Object.fromEntries(directory)));
  const now = Date.now();
  for (const [k, list] of queue) {
    const keep = list.filter((e) => now - e.ts < QUEUE_DAYS * 86400000);
    keep.length ? queue.set(k, keep) : queue.delete(k);
  }
  writeFileSync(join(DATA, 'queue.json'), JSON.stringify(Object.fromEntries(queue)));
}, 5000);

const fingerprint = (jwk) => createHash('sha256').update(jwk.x + '.' + jwk.y).digest('hex').slice(0, 20);
const clients = new Map(); // id -> Set<ws>

// ------------------------------------------------------------------ http ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function proxyPostcode(req, res) {
  const target = POSTCODE_API + req.url.replace(/^\/api\/postcode/, '');
  try {
    const body = req.method === 'POST' ? await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); }) : undefined;
    const up = await fetch(target, { method: req.method, body, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(POSTCODE_KEY ? { 'X-API-Key': POSTCODE_KEY } : {}) } });
    res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Postcode API unreachable from hub', detail: e.message }));
  }
}

async function tlsOptions() {
  if (process.env.TLS_CERT && process.env.TLS_KEY) return { cert: readFileSync(process.env.TLS_CERT), key: readFileSync(process.env.TLS_KEY) };
  if (!process.env.HTTPS) return null;
  const certFile = join(DATA, 'selfsigned.json');
  if (existsSync(certFile)) return JSON.parse(readFileSync(certFile, 'utf8'));
  const { generate } = await import('selfsigned');
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4').map((i) => ({ type: 7, ip: i.address }));
  const pems = await generate([{ name: 'commonName', value: '2qo-hub.local' }], { days: 3650, keySize: 2048, extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 2, value: '2qo-hub.local' }, ...ips] }] });
  const opts = { cert: pems.cert, key: pems.private };
  writeFileSync(certFile, JSON.stringify(opts));
  return opts;
}

const tls = await tlsOptions();
const handler = (req, res) => {
  if (req.url.startsWith('/api/postcode/')) return proxyPostcode(req, res);
  if (req.url === '/api/hub') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ app: '2qo-hub', users: directory.size, online: clients.size }));
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('2qo Hub is running. Build the app first (npm run build) to serve it from here.');
  }
  let p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, p);
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const headers = { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' };
  if (file.includes('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  if (file.endsWith('sw.js') || file.endsWith('index.html')) headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
};
const server = tls ? https.createServer(tls, handler) : http.createServer(handler);

// -------------------------------------------------------------- websocket ---
const wss = new WebSocketServer({ server, path: '/hub', maxPayload: 96 * 1024 * 1024 });

function sendTo(id, obj) {
  const set = clients.get(id);
  if (!set) return false;
  const s = JSON.stringify(obj);
  for (const ws of set) ws.readyState === 1 && ws.send(s);
  return true;
}

function broadcast(obj, except) {
  const s = JSON.stringify(obj);
  for (const [id, set] of clients) if (id !== except) for (const ws of set) ws.readyState === 1 && ws.send(s);
}

wss.on('connection', (ws, req) => {
  let me = null;
  ws.on('message', (raw) => {
    let d;
    try {
      d = JSON.parse(raw);
    } catch {
      return;
    }
    if (d.t === 'hello') {
      const p = d.profile;
      if (!p?.id || !p.publicJwk || fingerprint(p.publicJwk) !== p.id) return ws.close(4001, 'bad identity');
      me = p.id;
      if (!clients.has(me)) clients.set(me, new Set());
      clients.get(me).add(ws);
      directory.set(me, { ...p, avatar: p.avatar && p.avatar.length < 60000 ? p.avatar : null, seenAt: Date.now() });
      dirty = true;
      broadcast({ t: 'presence', id: me, online: true, lastSeen: p.lastSeen ? Date.now() : null }, me);
      // deliver anything that waited for us
      const q = queue.get(me);
      if (q?.length) {
        for (const env of q) ws.send(JSON.stringify({ t: 'env', env }));
        queue.delete(me);
        dirty = true;
      }
      return;
    }
    if (!me) return;
    if (d.t === 'env' && d.env?.to && d.env.from === me) {
      if (!sendTo(d.env.to, { t: 'env', env: d.env })) {
        const list = queue.get(d.env.to) || [];
        if (list.length < MAX_QUEUE) list.push(d.env);
        queue.set(d.env.to, list);
        dirty = true;
      }
      return;
    }
    if (d.t === 'dir') {
      const level = d.level ?? 2;
      const q = String(d.q || '').toLowerCase();
      const mine = parse(d.postcode || '');
      const results = [];
      for (const p of directory.values()) {
        if (p.id === me) continue;
        if (q && !String(p.name || '').toLowerCase().includes(q)) continue;
        const prox = mine.ok ? proximity(mine.canonical, p.postcode) : 0;
        if (mine.ok && prox < level) continue;
        results.push({ ...p, online: clients.has(p.id), prox });
      }
      results.sort((a, b) => b.prox - a.prox || b.online - a.online || (b.seenAt || 0) - (a.seenAt || 0));
      ws.send(JSON.stringify({ t: 'dir', rid: d.rid, results: results.slice(0, 60) }));
    }
  });
  ws.on('close', () => {
    if (!me) return;
    const set = clients.get(me);
    set?.delete(ws);
    if (set && !set.size) {
      clients.delete(me);
      const p = directory.get(me);
      if (p) directory.set(me, { ...p, seenAt: Date.now() });
      dirty = true;
      broadcast({ t: 'presence', id: me, online: false, lastSeen: p?.lastSeen ? Date.now() : null });
    }
  });
});

server.listen(PORT, HOST, () => {
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\n  2qo Hub running`);
  const proto = tls ? 'https' : 'http';
  console.log(`  ➜ local:   ${proto}://localhost:${PORT}`);
  for (const ip of ips) console.log(`  ➜ network: ${proto}://${ip}:${PORT}   (open this on phones on the same Wi-Fi/hotspot)`);
  console.log(`  Postcode proxy → ${POSTCODE_API} ${POSTCODE_KEY ? '(with API key)' : '(no API key: Level 1 & search only)'}\n`);
  if (!tls && ips.length) console.log('  Tip: phones need HTTPS for encryption, mic & camera. Restart with HTTPS=1 for a self-signed certificate.\n');
});

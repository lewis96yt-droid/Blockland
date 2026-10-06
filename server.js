'use strict';
/*
 * Blockland Classic - game server
 * Serves ./public over HTTP and relays player positions + chat over WebSocket.
 * One process, one port: run `npm install` then `npm start`.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '3000', 10);
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || '50', 10);   // total players at once
const MAX_PER_IP = parseInt(process.env.MAX_PER_IP || '8', 10);      // connections per IP address
const TICK_MS = 66;                                                  // ~15 position broadcasts per second
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

/* ---------- HTTP: serve the game page ---------- */
const server = http.createServer(function (req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }

  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

/* ---------- WebSocket: players ---------- */
const wss = new WebSocketServer({ server: server, maxPayload: 2048, perMessageDeflate: false });
const players = new Map();      // id -> player
const ipCounts = new Map();     // ip -> open connections
let nextId = 1;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];     // set by most hosting platforms
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}
function sanitizeName(s) { return String(s || '').replace(/[^\w .\-]/g, '').trim().slice(0, 16); }
function clamp(v, min, max, d) { return (typeof v === 'number' && Number.isFinite(v)) ? Math.min(max, Math.max(min, v)) : d; }
function color(c, d) { return (Number.isInteger(c) && c >= 0 && c <= 0xffffff) ? c : d; }
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj, exceptWs) {
  const s = JSON.stringify(obj);
  players.forEach(function (p) { if (p.ws !== exceptWs && p.ws.readyState === 1) p.ws.send(s); });
}
function info(p) {
  return { id: p.id, n: p.n, t: p.t, l: p.l, x: p.x, y: p.y, z: p.z, r: p.r, s: p.s, a: p.a, d: p.d, p: p.p };
}

wss.on('connection', function (ws, req) {
  const ip = clientIp(req);
  const open = ipCounts.get(ip) || 0;
  if (players.size >= MAX_PLAYERS || open >= MAX_PER_IP) {
    send(ws, { type: 'full' });
    ws.close(1013, 'full');
    return;
  }
  ipCounts.set(ip, open + 1);

  let me = null;
  ws.isAlive = true;
  ws.on('pong', function () { ws.isAlive = true; });
  ws.on('error', function () {});

  // A connection must say hello within 10 seconds or it is dropped.
  const helloTimer = setTimeout(function () { if (!me) ws.terminate(); }, 10000);

  ws.on('message', function (raw) {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    const now = Date.now();

    if (!me) {
      if (m.type !== 'hello') return;
      me = {
        id: nextId++, ws: ws,
        n: sanitizeName(m.name) || ('Guest' + (1000 + Math.floor(Math.random() * 9000))),
        t: color(m.t, 0x0d69ac), l: color(m.l, 0x287f47),
        x: 0, y: 2, z: 0, r: 0, s: 0, a: false, d: false, p: 0,
        dirty: false, lastState: 0, lastChat: 0, lastInfo: 0
      };
      players.set(me.id, me);
      const others = [];
      players.forEach(function (p) { if (p !== me) others.push(info(p)); });
      send(ws, { type: 'welcome', id: me.id, players: others });
      broadcast({ type: 'join', player: info(me) }, ws);
      return;
    }

    switch (m.type) {
      case 'state':
        if (now - me.lastState < 25) return;           // ignore anything faster than ~40/s
        me.lastState = now;
        me.x = clamp(m.x, -300, 300, me.x);
        me.y = clamp(m.y, -100, 300, me.y);
        me.z = clamp(m.z, -300, 300, me.z);
        me.r = clamp(m.r, -10, 10, me.r);
        me.s = clamp(m.s, 0, 40, 0);
        me.a = !!m.a;
        me.d = !!m.d;
        me.p = Math.floor(clamp(m.p, 0, 100000, me.p));
        me.dirty = true;
        break;

      case 'chat': {
        if (now - me.lastChat < 700) return;           // at most about 1 message per second
        const text = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100);
        if (!text) return;
        me.lastChat = now;
        broadcast({ type: 'chat', id: me.id, text: text }, ws);
        break;
      }

      case 'info': {
        if (now - me.lastInfo < 1000) return;
        const nm = sanitizeName(m.name);
        if (!nm) return;
        me.lastInfo = now;
        me.n = nm;
        broadcast({ type: 'info', id: me.id, name: nm }, ws);
        break;
      }
    }
  });

  ws.on('close', function () {
    clearTimeout(helloTimer);
    const c = (ipCounts.get(ip) || 1) - 1;
    if (c <= 0) ipCounts.delete(ip); else ipCounts.set(ip, c);
    if (me) {
      players.delete(me.id);
      broadcast({ type: 'leave', id: me.id });
    }
  });
});

/* Batch every changed player's position into one message per tick. */
setInterval(function () {
  const list = [];
  players.forEach(function (p) {
    if (!p.dirty) return;
    p.dirty = false;
    list.push({ id: p.id, x: p.x, y: p.y, z: p.z, r: p.r, s: p.s, a: p.a, d: p.d, p: p.p });
  });
  if (list.length) broadcast({ type: 'state', players: list });
}, TICK_MS);

/* Drop connections that stopped answering (closed laptop, lost signal). */
setInterval(function () {
  wss.clients.forEach(function (ws) {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, function () {
  console.log('Blockland Classic running on port ' + PORT + ' (max ' + MAX_PLAYERS + ' players)');
});

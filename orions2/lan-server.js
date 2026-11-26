#!/usr/bin/env node
/* Orions II LAN server: static game + tiny SSE relay. No dependencies. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8901);
const rooms = new Map();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function roomOf(code) {
  if (!rooms.has(code)) rooms.set(code, { host: null, guest: null, updated: Date.now() });
  return rooms.get(code);
}

function notify(room, side, msg) {
  const peer = room[side === 'host' ? 'guest' : 'host'];
  if (!peer) return false;
  try {
    peer.write('data: ' + JSON.stringify(msg) + '\n\n');
    return true;
  } catch (e) {
    return false;
  }
}

function sse(req, res, code, side) {
  cors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 1500\n\n');
  const room = roomOf(code);
  const old = room[side];
  if (old && old !== res) {
    try { old.end(); } catch (e) {}
  }
  room[side] = res;
  room.updated = Date.now();
  const other = room[side === 'host' ? 'guest' : 'host'];
  const hello = { type: 'hello', side, peer: !!other, code };
  res.write('data: ' + JSON.stringify(hello) + '\n\n');
  if (other) notify(room, side, { type: 'peer', peer: true, side });
  if (other) {
    try { other.write('data: ' + JSON.stringify({ type: 'peer', peer: true, side }) + '\n\n'); } catch (e) {}
  }

  const beat = setInterval(() => {
    try { res.write('data: {"type":"ping"}\n\n'); } catch (e) {}
  }, 15000);

  const cleanup = () => {
    clearInterval(beat);
    if (room[side] === res) {
      room[side] = null;
      const peer = room[side === 'host' ? 'guest' : 'host'];
      if (peer) {
        try { peer.write('data: ' + JSON.stringify({ type: 'peer', peer: false, side }) + '\n\n'); } catch (e) {}
      }
      if (!room.host && !room.guest) rooms.delete(code);
    }
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
}

function readBody(req, limit, cb) {
  let data = '';
  let done = false;
  req.on('data', chunk => {
    if (done) return;
    data += chunk;
    if (data.length > limit) {
      done = true;
      cb(new Error('too large'));
      req.destroy();
    }
  });
  req.on('end', () => { if (!done) { done = true; cb(null, data); } });
  req.on('error', err => { if (!done) { done = true; cb(err); } });
}

function safeFile(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const full = path.resolve(ROOT, '.' + p);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405); res.end('Method Not Allowed'); return;
  }
  const full = safeFile(req.url || '/');
  if (!full) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
    cors(res);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(full).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
  if (req.method === 'OPTIONS') {
    cors(res); res.writeHead(204); res.end(); return;
  }
  if (u.pathname === '/lan/health') {
    json(res, 200, { ok: true, rooms: rooms.size, uptime: process.uptime() });
    return;
  }
  if (u.pathname === '/lan/events') {
    const code = (u.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const side = u.searchParams.get('side') === 'guest' ? 'guest' : 'host';
    if (code.length < 4) { json(res, 400, { error: 'bad room code' }); return; }
    sse(req, res, code, side);
    return;
  }
  if (u.pathname === '/lan/send' && req.method === 'POST') {
    const code = (u.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const side = u.searchParams.get('side') === 'guest' ? 'guest' : 'host';
    if (code.length < 4) { json(res, 400, { error: 'bad room code' }); return; }
    readBody(req, 256 * 1024, (err, body) => {
      if (err) { json(res, 400, { error: 'bad body' }); return; }
      let msg;
      try { msg = JSON.parse(body || '{}'); } catch (e) { json(res, 400, { error: 'bad json' }); return; }
      const room = rooms.get(code);
      if (!room) { json(res, 404, { error: 'room not found' }); return; }
      const ok = notify(room, side, msg);
      room.updated = Date.now();
      json(res, ok ? 200 : 409, { ok, peer: !!(room[side === 'host' ? 'guest' : 'host']) });
    });
    return;
  }
  serveStatic(req, res);
});

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('Orions II LAN server');
  console.log('  local:   http://127.0.0.1:' + PORT + '/');
  for (const ip of lanAddresses()) console.log('  LAN:     http://' + ip + ':' + PORT + '/');
  console.log('Both devices open the LAN URL, one creates a room, the other joins with the code.');
});

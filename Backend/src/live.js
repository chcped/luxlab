import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { WebSocketServer } from 'ws';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';

export function installLive(app, server) {
  const rooms = new Map();
  const codes = new Map();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
  const sign = (claims, seconds = 3600) => jwt.sign(claims, config.jwtSecret, { algorithm: 'HS256', audience: 'live', issuer: 'luxlab', expiresIn: seconds });
  const verify = token => jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], audience: 'live', issuer: 'luxlab' });
  function auth(req, res, next) {
    try { req.identity = verify(req.get('authorization')?.replace(/^Bearer /, '')); next(); }
    catch { res.status(401).json({ error: 'Sessão expirada. Abra a Activity novamente.' }); }
  }
  function account(req, res, next) {
    if (req.identity.kind !== 'account') return res.sendStatus(403);
    next();
  }
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const endpoint = '/api/live';
  const statusLimit = rateLimit({ windowMs: 60000, limit: 60, keyGenerator: req => `${req.identity.kind}:${req.identity.sub || req.identity.room}` });
  app.get(`${endpoint}/config`, (_req, res) => res.json({ clientId: process.env.DISCORD_CLIENT_ID || '' }));
  app.post(`${endpoint}/auth`, rateLimit({ windowMs: 60000, limit: 10 }), wrap(async (req, res) => {
    if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) return res.status(503).json({ error: 'Configure o Application ID e Client Secret no backend.' });
    if (typeof req.body.code !== 'string' || req.body.code.length > 2048) return res.sendStatus(400);
    const response = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID, client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: req.body.code }) });
    const data = await response.json();
    if (!response.ok || !data.access_token) return res.status(401).json({ error: 'Autorização Discord recusada.' });
    const profile = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${data.access_token}` }, signal: AbortSignal.timeout(10000) });
    if (!profile.ok) return res.sendStatus(401);
    const user = await profile.json();
    res.set('Cache-Control', 'no-store').json({ access_token: data.access_token, token: sign({ kind: 'account', sub: user.id }), name: user.username });
  }));
  app.post(`${endpoint}/rooms`, auth, account, (req, res) => {
    const existing = [...rooms.values()].find(room => room.owner === req.identity.sub && room.expires > Date.now());
    if (existing) return res.json({ roomId: existing.id });
    if (rooms.size >= Number(process.env.MAX_LIVE_ROOMS || 10)) return res.status(429).json({ error: 'Limite de salas atingido.' });
    const room = { id: crypto.randomUUID(), owner: req.identity.sub, expires: Date.now() + 3600000, status: 'offline', stream: null, publisherVersion: 0 };
    rooms.set(room.id, room);
    res.json({ roomId: room.id });
  });
  app.post(`${endpoint}/rooms/:id/join`, auth, account, (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room || room.expires <= Date.now()) return res.sendStatus(404);
    // The random invitation ID is a bearer capability, shared explicitly by the owner.
    res.json({ token: sign({ kind: 'viewer', room: room.id, sub: req.identity.sub }, Math.max(1, Math.floor((room.expires - Date.now()) / 1000))), owner: room.owner === req.identity.sub });
  });
  app.post(`${endpoint}/rooms/:id/pair`, auth, account, (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room || room.owner !== req.identity.sub || room.expires <= Date.now()) return res.sendStatus(403);
    for (const [code, entry] of codes) if (entry.room === room.id) codes.delete(code);
    let code;
    do { code = crypto.randomInt(10000000, 100000000).toString(); } while (codes.has(code));
    codes.set(code, { room: room.id, expires: Date.now() + 120000 });
    res.json({ code, expiresIn: 120 });
  });
  app.post(`${endpoint}/pair`, rateLimit({ windowMs: 60000, limit: 5 }), (req, res) => {
    const entry = codes.get(req.body.code);
    const room = entry && rooms.get(entry.room);
    if (!entry || entry.expires < Date.now() || !room || room.expires <= Date.now()) return res.status(401).json({ error: 'Código inválido ou expirado.' });
    if (room.stream) return res.status(409).json({ error: 'Encerre a transmissão atual antes de vincular outro computador.' });
    codes.delete(req.body.code);
    room.publisherVersion++;
    res.json({ roomId: room.id, token: sign({ kind: 'publisher', room: room.id, version: room.publisherVersion }, Math.max(1, Math.floor((room.expires - Date.now()) / 1000))) });
  });
  app.get(`${endpoint}/rooms/:id/status`, auth, statusLimit, (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room || (req.identity.room !== room.id && !(req.identity.kind === 'account' && req.identity.sub === room.owner))) return res.sendStatus(403);
    res.json({ status: room.status, streamId: room.stream?.id || null });
  });
  app.post(`${endpoint}/rooms/:id/stop`, auth, account, (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room || room.owner !== req.identity.sub) return res.sendStatus(403);
    room.publisherVersion++;
    room.stream?.stop();
    res.json({ ok: true });
  });
  app.get('/media/:room/:stream/:file', auth, wrap(async (req, res) => {
    const room = rooms.get(req.params.room);
    if (req.identity.kind !== 'viewer' || req.identity.room !== room?.id || room?.stream?.id !== req.params.stream) return res.sendStatus(403);
    if (!/^(index\.m3u8|segment\d+\.ts)$/.test(req.params.file)) return res.sendStatus(404);
    res.set({ 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    res.type(req.params.file.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl');
    res.sendFile(path.join(room.stream.dir, req.params.file), error => { if (error && !res.headersSent) res.sendStatus(404); });
  }));
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://localhost').pathname !== '/ingest') return;
    if (req.headers.origin !== 'app://desktop' && !config.allowedOrigins.has(req.headers.origin)) { socket.destroy(); return; }
    if (sockets.clients.size >= Number(process.env.MAX_LIVE_ROOMS || 10) * 2) { socket.destroy(); return; }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  });
  sockets.on('connection', ws => {
    let live;
    let authenticating = false;
    let lastData = Date.now();
    const timeout = setTimeout(() => ws.close(4401, 'Autentique'), 8000);
    const watchdog = setInterval(() => {
      if (Date.now() - lastData > 15000) ws.terminate();
      else if (ws.readyState === 1) ws.ping();
    }, 5000);
    ws.on('error', () => {});
    ws.on('close', () => { clearTimeout(timeout); clearInterval(watchdog); live?.stop(); });
    ws.on('message', async (data, binary) => {
      try {
        if (!live) {
          if (binary || authenticating) throw new Error('auth');
          authenticating = true;
          const claims = verify(JSON.parse(data.toString()).token);
          const room = rooms.get(claims.room);
          if (claims.kind !== 'publisher' || !room || claims.version !== room.publisherVersion || room.expires <= Date.now() || room.stream) throw new Error('auth');
          // Reserve the room before asynchronous filesystem operations.
          live = { id: crypto.randomUUID(), stop: () => {
            if (room.stream === live) { room.stream = null; room.status = 'offline'; }
            ws.close(1000, 'Transmissão encerrada');
          } };
          room.stream = live;
          const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luxlab-live-'));
          if (ws.readyState !== 1 || room.stream !== live) { if (room.stream === live) room.stream = null; await fs.rm(dir, { recursive: true, force: true }); return; }
          live.dir = dir;
          const ffmpeg = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'pipe', '-f', 'webm', '-i', 'pipe:0', '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-b:v', '2500k', '-maxrate', '3000k', '-bufsize', '6000k', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6', '-hls_flags', 'delete_segments+independent_segments+temp_file', '-hls_segment_filename', path.join(dir, 'segment%d.ts'), path.join(dir, 'index.m3u8')], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
          live.process = ffmpeg;
          let stopped = false;
          const expiry = setTimeout(() => live.stop(), Math.max(1, claims.exp * 1000 - Date.now()));
          live.stop = () => {
            if (stopped) return;
            stopped = true;
            clearTimeout(expiry);
            room.status = 'offline';
            if (room.stream === live) room.stream = null;
            ws.close(1000, 'Transmissão encerrada');
            ffmpeg.stdin.destroy();
            ffmpeg.kill('SIGKILL');
          };
          ffmpeg.on('error', () => live.stop());
          ffmpeg.stdin.on('error', () => live.stop());
          ffmpeg.stderr.on('data', () => {});
          ffmpeg.on('close', () => { live.stop(); fs.rm(dir, { recursive: true, force: true }).catch(() => {}); });
          clearTimeout(timeout);
          room.status = 'live';
          ws.send(JSON.stringify({ type: 'ready' }));
          return;
        }
        if (!binary || !live.process || live.process.stdin.destroyed) throw new Error('media');
        lastData = Date.now();
        if (live.process.stdin.writableLength + data.length > 8 * 1024 * 1024) throw new Error('backpressure');
        live.process.stdin.write(data);
      } catch {
        ws.close(4400, 'Sessão ou mídia inválida');
        live?.stop();
        for (const room of rooms.values()) if (room.stream === live) { room.stream = null; room.status = 'offline'; }
      }
    });
  });
  const cleanup = setInterval(() => {
    for (const [key, entry] of codes) if (entry.expires < Date.now()) codes.delete(key);
    for (const [id, room] of rooms) if (room.expires < Date.now()) { room.stream?.stop(); rooms.delete(id); }
  }, 30000);
  return () => { clearInterval(cleanup); for (const room of rooms.values()) room.stream?.stop(); for (const ws of sockets.clients) ws.terminate(); sockets.close(); };
}

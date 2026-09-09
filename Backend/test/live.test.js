import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import express from 'express';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';

process.env.JWT_SECRET = 'test-only-secret-not-for-production-123456';
process.env.ADMIN_API_KEY = 'test-admin-only-not-for-production-123456';
const { installLive } = await import('../src/live.js');

async function fixture(t) {
  const app = express(); app.use(express.json());
  const server = http.createServer(app);
  const closeLive = installLive(app, server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const account = sub => jwt.sign({ kind: 'account', sub }, process.env.JWT_SECRET, { algorithm: 'HS256', audience: 'live', issuer: 'luxlab', expiresIn: 3600 });
  const api = (route, body, token = account('owner')) => fetch(`${origin}${route.startsWith('/media') ? '' : '/api/live'}${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  t.after(() => { closeLive(); server.closeAllConnections(); server.close(); });
  return { origin, account, api };
}

test('sala autentica, vinculação é de uso único e outro usuário não controla', async t => {
  const { api, account } = await fixture(t);
  assert.equal((await api('/rooms', {}, 'invalid')).status, 401);
  const room = await (await api('/rooms', {})).json();
  assert.equal((await api(`/rooms/${room.roomId}/pair`, {}, account('intruder'))).status, 403);
  assert.equal((await api(`/rooms/${room.roomId}/stop`, {}, account('intruder'))).status, 403);
  const { code } = await (await api(`/rooms/${room.roomId}/pair`, {})).json();
  assert.match(code, /^\d{8}$/);
  const paired = await (await api('/pair', { code }, '')).json();
  assert.equal(paired.roomId, room.roomId);
  assert.equal((await api('/pair', { code }, '')).status, 401);
  assert.equal((await api('/rooms', {}, paired.token)).status, 403);
  const viewer = await (await api(`/rooms/${room.roomId}/join`, {}, account('guest'))).json();
  assert.equal(viewer.owner, false);
  assert.equal((await api(`/rooms/${room.roomId}/stop`, {}, viewer.token)).status, 403);
  assert.equal((await api(`/rooms/${room.roomId}/status`, undefined, viewer.token)).status, 200);
  assert.equal((await api(`/rooms/${room.roomId}/status`, undefined, account('intruder'))).status, 403);
});

test('ingest rejeita origem não autorizada antes de abrir WebSocket', async t => {
  const { origin } = await fixture(t);
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ingest', { origin: 'https://malicious.invalid' });
  const [error] = await once(ws, 'error');
  assert.ok(error);
});

test('WebM com áudio vira HLS protegido e encerramento remoto para o upload', { skip: !process.env.FFMPEG_PATH, timeout: 30000 }, async t => {
  const { api, origin } = await fixture(t);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'luxlab-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'source.webm');
  execFileSync(process.env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:v', 'libvpx', '-deadline', 'realtime', '-b:v', '300k', '-c:a', 'libopus', file], { windowsHide: true });
  const room = await (await api('/rooms', {})).json();
  const { code } = await (await api(`/rooms/${room.roomId}/pair`, {})).json();
  const paired = await (await api('/pair', { code }, '')).json();
  const viewer = await (await api(`/rooms/${room.roomId}/join`, {})).json();
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ingest', { origin: 'app://desktop' });
  t.after(() => ws.terminate());
  await once(ws, 'open');
  ws.send(JSON.stringify({ token: paired.token }));
  const [ready] = await once(ws, 'message');
  assert.equal(JSON.parse(ready.toString()).type, 'ready');
  ws.send(await fs.readFile(file));
  const live = await (await api(`/rooms/${room.roomId}/status`, undefined, viewer.token)).json();
  const manifest = `/media/${room.roomId}/${live.streamId}/index.m3u8`;
  let playlist;
  for (let i = 0; i < 60; i++) {
    const response = await api(manifest, undefined, viewer.token);
    if (response.ok) { playlist = await response.text(); break; }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.match(playlist || '', /#EXTM3U/);
  assert.equal((await api(manifest, undefined, paired.token)).status, 403);
  assert.equal((await api(manifest, undefined, 'invalid')).status, 401);
  const segment = playlist.split('\n').find(line => /^segment\d+\.ts$/.test(line));
  const response = await api(manifest.replace('index.m3u8', segment), undefined, viewer.token);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 188);
  assert.equal(bytes[0], 0x47);
  const segmentPath = path.join(dir, 'verify.ts');
  await fs.writeFile(segmentPath, bytes);
  const decoded = execFileSync(process.env.FFMPEG_PATH, ['-hide_banner', '-loglevel', 'error', '-i', segmentPath, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-'], { windowsHide: true });
  assert.equal(decoded.length, 0);
  const closed = once(ws, 'close');
  assert.equal((await api(`/rooms/${room.roomId}/stop`, {})).status, 200);
  await closed;
  assert.equal((await api(manifest, undefined, viewer.token)).status, 403);
  const retry = new WebSocket(origin.replace('http:', 'ws:') + '/ingest', { origin: 'app://desktop' });
  t.after(() => retry.terminate());
  await once(retry, 'open');
  retry.send(JSON.stringify({ token: paired.token }));
  const [closeCode] = await once(retry, 'close');
  assert.equal(closeCode, 4400);
});

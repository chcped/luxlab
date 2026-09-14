import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import express from 'express';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';
import { installStandalone } from '../src/standalone.js';

const secret = 'standalone-test-secret-only-123456789012345';
async function fixture(t, options = {}) {
  const app = express(); app.use(express.json());
  const server = http.createServer(app);
  const close = installStandalone(app, server, { secret, allowedOrigins: new Set(['app://desktop']), ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { close(); server.closeAllConnections(); server.close(); });
  const api = async (path, body = {}, token) => {
    const r = await fetch(base + '/api/v2' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const connect = async token => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { origin: 'app://desktop' });
    const messages = []; const waiting = [];
    ws.on('message', raw => { const msg = JSON.parse(raw); messages.push(msg); for (const notify of [...waiting]) notify(); });
    const next = (type, predicate = () => true) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.splice(waiting.indexOf(check), 1); reject(new Error(`Timeout: ${type}`)); }, 3000);
      function check() { const i = messages.findIndex(m => m.type === type && predicate(m)); if (i >= 0) { clearTimeout(timer); const at = waiting.indexOf(check); if (at >= 0) waiting.splice(at, 1); resolve(messages.splice(i, 1)[0]); } }
      waiting.push(check); check();
    });
    await once(ws, 'open'); ws.send(JSON.stringify({ type: 'join', token }));
    return { ws, next, send: msg => ws.send(JSON.stringify(msg)) };
  };
  return { api, connect };
}

test('convite, presença, compartilhamento, perfil, chat e isolamento entre salas', async t => {
  const { api, connect } = await fixture(t);
  const created = await api('/rooms', { profile: { name: 'Ana' } }); assert.equal(created.status, 201);
  const owner = await connect(created.body.token); const self = (await owner.next('joined')).self;
  const joined = await api(`/rooms/${created.body.roomId}/join`, { profile: { name: 'Bruno' } });
  const viewer = await connect(joined.body.token); const other = (await viewer.next('joined')).self;
  assert.equal((await owner.next('members', m => m.members.length === 2)).members.length, 2);
  owner.send({ type: 'sharing', active: true });
  assert.equal((await viewer.next('members', m => m.members.some(p => p.sharing))).members.find(m => m.id === self).sharing, true);
  viewer.send({ type: 'profile', profile: { name: '<script>alert(1)</script>', color: 'invalid', avatar: '🚀' } });
  assert.equal((await owner.next('members', m => m.members.some(p => p.profile.avatar === '🚀'))).members.find(m => m.id === other).profile.color, '#7c6cff');
  viewer.send({ type: 'chat', text: 'Olá!' }); assert.equal((await owner.next('chat')).message.text, 'Olá!');
  owner.send({ type: 'signal', to: other, payload: { test: 1 } }); assert.deepEqual((await viewer.next('signal')).payload, { test: 1 });
  const different = await api('/rooms'); const outsider = await connect(different.body.token); await outsider.next('joined');
  outsider.send({ type: 'signal', to: other, payload: { test: 'cross-room' } });
  // A legitimate subsequent signal must arrive first; cross-room routing is rejected.
  owner.send({ type: 'signal', to: other, payload: { test: 2 } }); assert.deepEqual((await viewer.next('signal')).payload, { test: 2 });
  owner.ws.close(); assert.equal((await viewer.next('members', m => m.members.length === 1)).members[0].owner, true);
});

test('senha, limites e remoção autorizada somente ao dono', async t => {
  const { api, connect } = await fixture(t, { maxMembers: 2 });
  const room = (await api('/rooms', { password: 'segredo' })).body;
  assert.equal((await api(`/rooms/${room.roomId}/join`)).status, 403);
  assert.equal((await api(`/rooms/${room.roomId}/join`, { password: 'errada' })).status, 403);
  const owner = await connect(room.token); const ownerId = (await owner.next('joined')).self;
  const memberToken = (await api(`/rooms/${room.roomId}/join`, { password: 'segredo' })).body.token;
  const member = await connect(memberToken);
  const memberId = (await member.next('joined')).self;
  assert.equal((await api(`/rooms/${room.roomId}/join`, { password: 'segredo' })).status, 409);
  member.send({ type: 'kick', to: ownerId }); member.send({ type: 'chat', text: 'Ainda aqui' });
  assert.equal((await owner.next('chat')).message.text, 'Ainda aqui');
  const closed = once(member.ws, 'close'); owner.send({ type: 'kick', to: memberId }); assert.equal((await closed)[0], 4403);
  const removed = await connect(memberToken); assert.equal((await once(removed.ws, 'close'))[0], 4403);
});

test('integração JWT exige conta válida quando visitantes estão desativados', async t => {
  const { api } = await fixture(t, { allowGuests: false });
  assert.equal((await api('/rooms')).status, 401);
  assert.equal((await api('/rooms', {}, 'invalid')).status, 401);
  const token = jwt.sign({ sub: 'user-123' }, secret, { algorithm: 'HS256', issuer: 'luxlab-auth', audience: 'luxlab-desktop', expiresIn: 60 });
  assert.equal((await api('/rooms', {}, token)).status, 201);
});

test('sessão expira e token duplicado não substitui participante conectado', async t => {
  const { api, connect } = await fixture(t, { ttl: 2 });
  const room = (await api('/rooms')).body;
  const owner = await connect(room.token); await owner.next('joined');
  const duplicate = await connect(room.token); assert.equal((await once(duplicate.ws, 'close'))[0], 4403);
  assert.equal((await once(owner.ws, 'close'))[0], 4401);
  assert.equal((await api(`/rooms/${room.roomId}/join`)).status, 404);
});

 test('relay policy is delivered and requires a TURN server', async t => {
  const { api } = await fixture(t, { iceTransportPolicy: 'relay', turnUrls: ['turn:example.org:3478?transport=udp'], turnSecret: 'test-turn-secret' });
  const room = (await api('/rooms')).body;
  assert.equal(room.iceTransportPolicy, 'relay');
  assert.ok(room.iceServers[0].username);
  assert.ok(room.iceServers[0].credential);
  assert.throws(() => installStandalone(express(), http.createServer(), { secret, allowedOrigins: new Set(), iceTransportPolicy: 'relay' }), /TURN/);
});

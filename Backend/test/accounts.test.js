import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import { openAccountStore } from '../src/account-store.js';
import { createAccounts, normalizeEmail } from '../src/accounts.js';
import { createSavedRooms } from '../src/saved-rooms.js';
import { installStandalone } from '../src/standalone.js';

const secret = 'local-test-account-secret-not-for-production';
async function fixture(t, options = {}) {
  const store = openAccountStore(options.filename || ':memory:');
  const mail = new Map();
  const accounts = createAccounts({ store, secret, sendCode: async (email, code) => mail.set(email, code), ...options.auth });
  const saved = createSavedRooms({ store, secret, ...options.saved });
  const app = express(); app.use(express.json());
  const server = http.createServer(app);
  const stop = installStandalone(app, server, { secret, accounts, saved, allowedOrigins: new Set(['app://desktop']), ttl: 3600 });
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let stopped = false;
  async function close() {
    if (stopped) return; stopped = true;
    stop(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); store.close();
  }
  t.after(close);
  async function api(method, endpoint, body, token) {
    const response = await fetch(base + '/api/v2' + endpoint, { method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers };
  }
  async function login(email) {
    await accounts.requestCode(email);
    return accounts.verifyCode(email, mail.get(normalizeEmail(email)));
  }
  async function connect(token, rejected = false) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { origin: 'app://desktop' });
    const closed = once(ws, 'close');
    const joined = new Promise(resolve => ws.on('message', raw => { const msg = JSON.parse(raw); if (msg.type === 'joined') resolve(msg); }));
    await once(ws, 'open'); ws.send(JSON.stringify({ type: 'join', token }));
    const timer = setTimeout(() => ws.terminate(), 2500);
    if (rejected) { try { assert.equal((await closed)[0], 4403); } finally { clearTimeout(timer); } return; }
    const result = await Promise.race([joined, closed.then(() => { throw new Error('WebSocket rejected'); })]);
    clearTimeout(timer);
    return { ws, closed, self: result.self };
  }
  return { store, accounts, saved, mail, api, login, connect, close };
}

test('email login verifies ownership, normalizes email, consumes code, and issues revocable sessions', async t => {
  const x = await fixture(t);
  const request = await x.api('POST', '/auth/email/request', { email: '  Ana@Example.com ' });
  assert.equal(request.status, 202); assert.equal(request.body.code, undefined);
  assert.equal(x.store.get('SELECT count(*) AS n FROM accounts').n, 0);
  const code = x.mail.get('ana@example.com');
  assert.match(code, /^\d{8}$/);
  assert.notEqual(x.store.get('SELECT digest FROM login_codes').digest, code);
  const login = await x.api('POST', '/auth/email/verify', { email: 'ana@example.com', code });
  assert.equal(login.status, 200); assert.equal(login.body.account.email, 'ana@example.com');
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const token = login.body.accessToken;
  assert.equal((await x.api('GET', '/auth/me', undefined, token)).status, 200);
  assert.equal((await x.api('POST', '/auth/email/verify', { email: 'ana@example.com', code })).status, 401);
  assert.equal((await x.api('POST', '/auth/logout', {}, token)).status, 204);
  assert.equal((await x.api('GET', '/auth/me', undefined, token)).status, 401);
});

test('codes expire, lock after five attempts, and cannot bypass email delivery limits', async t => {
  let time = 10000000;
  const x = await fixture(t, { auth: { now: () => time } });
  await x.accounts.requestCode('ana@example.com');
  const code = x.mail.get('ana@example.com');
  await x.accounts.requestCode('ana@example.com');
  assert.equal(x.mail.get('ana@example.com'), code);
  const wrong = code === '00000000' ? '11111111' : '00000000';
  for (let i = 0; i < 5; i++) assert.throws(() => x.accounts.verifyCode('ana@example.com', wrong), { status: 401 });
  assert.throws(() => x.accounts.verifyCode('ana@example.com', code), { status: 401 });
  time += 61000; await x.accounts.requestCode('ana@example.com');
  time += 600001;
  assert.throws(() => x.accounts.verifyCode('ana@example.com', x.mail.get('ana@example.com')), { status: 401 });
  for (let i = 0; i < 4; i++) { time += 61000; await x.accounts.requestCode('ana@example.com'); }
  assert.equal(x.store.get('SELECT sends FROM login_codes').sends, 5);
  assert.throws(() => normalizeEmail('bad\r\nBcc: foo@example.com'), { status: 400 });
});

test('missing or failing SMTP never creates an authenticated account', async t => {
  const x = await fixture(t, { auth: { sendCode: null } });
  assert.equal((await x.api('POST', '/auth/email/request', { email: 'ana@example.com' })).status, 503);
  assert.equal((await x.api('GET', '/config')).body.emailLogin, false);
  const failed = createAccounts({ store: x.store, secret, sendCode: async () => { throw new Error('private SMTP password'); } });
  await assert.rejects(failed.requestCode('ana@example.com'), { status: 503 });
  assert.equal(x.store.get('SELECT expires_at FROM login_codes').expires_at, 0);
  assert.equal(x.store.get('SELECT count(*) AS n FROM accounts').n, 0);
});

test('private rooms require verified members; fixed invite enrols once and rotation preserves membership', async t => {
  const x = await fixture(t);
  const owner = await x.login('owner@example.com'), member = await x.login('member@example.com'), outsider = await x.login('outsider@example.com');
  assert.equal((await x.api('POST', '/saved-rooms', { name: 'Room' })).status, 401);
  const external = jwt.sign({ sub: 'external' }, secret, { issuer: 'luxlab-auth', audience: 'luxlab-desktop' });
  assert.equal((await x.api('GET', '/saved-rooms', undefined, external)).status, 401);
  const created = await x.api('POST', '/saved-rooms', { name: 'Nossa sala' }, owner.accessToken);
  assert.equal(created.status, 201);
  const id = created.body.room.id, code = created.body.invite.code;
  assert.equal((await x.api('POST', `/rooms/${id}/join`, {})).status, 401);
  assert.equal((await x.api('POST', `/rooms/${id}/join`, {}, outsider.accessToken)).status, 404);
  assert.equal((await x.api('POST', '/invites/accept', { code })).status, 401);
  assert.equal((await x.api('POST', '/invites/accept', { code }, member.accessToken)).status, 200);
  assert.equal((await x.api('POST', '/invites/accept', { code }, member.accessToken)).status, 200);
  assert.equal((await x.api('GET', '/saved-rooms', undefined, member.accessToken)).body.rooms.length, 1);
  assert.equal((await x.api('GET', `/saved-rooms/${id}/invite`, undefined, owner.accessToken)).body.invite.code, code);
  assert.equal((await x.api('GET', `/saved-rooms/${id}/invite`, undefined, member.accessToken)).status, 404);
  assert.equal((await x.api('DELETE', `/saved-rooms/${id}`, undefined, member.accessToken)).status, 404);
  assert.equal((await x.api('POST', `/saved-rooms/${id}/members`, { email: 'outsider@example.com' }, member.accessToken)).status, 404);
  assert.equal((await x.api('POST', `/saved-rooms/${id}/invite`, { enabled: true }, owner.accessToken)).status, 200);
  assert.equal((await x.api('POST', '/invites/accept', { code }, outsider.accessToken)).status, 404);
  assert.equal((await x.api('POST', `/saved-rooms/${id}/join`, {}, member.accessToken)).status, 200);
  const disabled = await x.api('POST', `/saved-rooms/${id}/invite`, { enabled: false }, owner.accessToken);
  assert.equal(disabled.body.invite.code, null);
});

test('owner can add an existing email; removing a member disconnects all devices and invalidates old room tokens', async t => {
  const x = await fixture(t);
  const owner = await x.login('owner@example.com'), member = await x.login('member@example.com');
  const room = x.saved.create(owner.account.id, 'Friends');
  const id = room.id;
  assert.equal((await x.api('POST', `/saved-rooms/${id}/members`, { email: 'missing@example.com' }, owner.accessToken)).status, 404);
  assert.equal((await x.api('POST', `/saved-rooms/${id}/members`, { email: 'MEMBER@example.com' }, owner.accessToken)).status, 204);
  const old = (await x.api('POST', `/saved-rooms/${id}/join`, {}, member.accessToken)).body.token;
  const first = await x.connect(old);
  const second = await x.connect((await x.api('POST', `/saved-rooms/${id}/join`, {}, member.accessToken)).body.token);
  const removed = await x.api('DELETE', `/saved-rooms/${id}/members/${member.account.id}`, undefined, owner.accessToken);
  assert.equal(removed.status, 204);
  assert.equal((await first.closed)[0], 4403); assert.equal((await second.closed)[0], 4403);
  await x.connect(old, true);
  assert.equal((await x.api('POST', '/invites/accept', { code: x.saved.invite(room).code }, member.accessToken)).status, 403);
  assert.equal((await x.api('GET', '/saved-rooms', undefined, member.accessToken)).body.rooms.length, 0);
  assert.equal((await x.api('POST', `/saved-rooms/${id}/members`, { email: 'member@example.com' }, owner.accessToken)).status, 204);
  await x.connect(old, true);
  await x.connect((await x.api('POST', `/saved-rooms/${id}/join`, {}, member.accessToken)).body.token);
  assert.equal((await x.api('DELETE', `/saved-rooms/${id}/members/${owner.account.id}`, undefined, owner.accessToken)).status, 409);
});

test('persistent owner stays owner offline, and sessions/rooms/members/invites survive database restart', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'luxlab-accounts-'));
  // t.after callbacks run in registration order; explicitly close both servers before removal.
  const filename = path.join(directory, 'accounts.sqlite');
  const x = await fixture(t, { filename });
  const owner = await x.login('owner@example.com'), member = await x.login('member@example.com');
  const room = x.saved.create(owner.account.id, 'Permanent');
  x.saved.add(room.id, member.account.id);
  const invitation = x.saved.invite(room).code;
  const ownerJoin = await x.api('POST', `/saved-rooms/${room.id}/join`, {}, owner.accessToken);
  const ownerSocket = await x.connect(ownerJoin.body.token);
  const memberToken = (await x.api('POST', `/saved-rooms/${room.id}/join`, {}, member.accessToken)).body.token;
  const memberSocket = await x.connect(memberToken);
  const state = new Promise(resolve => memberSocket.ws.on('message', raw => { const msg = JSON.parse(raw); if (msg.type === 'members' && msg.members.length === 1) resolve(msg); }));
  ownerSocket.ws.close();
  assert.equal((await state).members[0].owner, false);
  assert.equal(x.saved.get(room.id).owner_id, owner.account.id);
  memberSocket.ws.close(); await memberSocket.closed;
  assert.ok(x.saved.get(room.id));
  await x.close();
  const y = await fixture(t, { filename });
  assert.equal((await y.api('GET', '/saved-rooms', undefined, owner.accessToken)).body.rooms[0].id, room.id);
  assert.equal(y.saved.invite(y.saved.get(room.id)).code, invitation);
  const resumed = await y.connect(memberToken);
  assert.ok(resumed.self);
  await y.close(); rmSync(directory, { recursive: true, force: true });
});

test('logout and room deletion revoke active WebSockets and previously issued tokens', async t => {
  const x = await fixture(t), owner = await x.login('owner@example.com');
  const room = x.saved.create(owner.account.id, 'Room');
  const token = (await x.api('POST', `/saved-rooms/${room.id}/join`, {}, owner.accessToken)).body.token;
  const socket = await x.connect(token);
  assert.equal((await x.api('POST', '/auth/logout', {}, owner.accessToken)).status, 204);
  assert.equal((await socket.closed)[0], 4401); await x.connect(token, true);
  const other = await x.login('other@example.com');
  const another = x.saved.create(other.account.id, 'Other');
  const anotherToken = (await x.api('POST', `/saved-rooms/${another.id}/join`, {}, other.accessToken)).body.token;
  const anotherSocket = await x.connect(anotherToken);
  assert.equal((await x.api('DELETE', `/saved-rooms/${another.id}`, undefined, other.accessToken)).status, 204);
  assert.equal((await anotherSocket.closed)[0], 4403); await x.connect(anotherToken, true);
  assert.equal(x.saved.membership(another.id, other.account.id), undefined);
});

test('saved-room/member quotas and voluntary departure', async t => {
  const x = await fixture(t, { saved: { maxOwnedRooms: 1, maxSavedMembers: 2 } });
  const owner = await x.login('owner@example.com'), member = await x.login('member@example.com'), third = await x.login('third@example.com');
  const room = x.saved.create(owner.account.id, 'Quota');
  assert.throws(() => x.saved.create(owner.account.id, 'Too many'), { status: 409 });
  x.saved.add(room.id, member.account.id);
  assert.throws(() => x.saved.add(room.id, third.account.id), { status: 409 });
  assert.equal((await x.api('POST', `/saved-rooms/${room.id}/leave`, {}, owner.accessToken)).status, 409);
  assert.equal((await x.api('POST', `/saved-rooms/${room.id}/leave`, {}, member.accessToken)).status, 204);
  assert.equal((await x.api('POST', '/invites/accept', { code: x.saved.invite(room).code }, member.accessToken)).status, 200);
});

test('WebSocket kick removes account authorization, while a member cannot kick the permanent owner', async t => {
  const x = await fixture(t), owner = await x.login('owner@example.com'), member = await x.login('member@example.com');
  const room = x.saved.create(owner.account.id, 'Kick'); x.saved.add(room.id, member.account.id);
  const a = await x.connect((await x.api('POST', `/saved-rooms/${room.id}/join`, {}, owner.accessToken)).body.token);
  const token = (await x.api('POST', `/saved-rooms/${room.id}/join`, {}, member.accessToken)).body.token;
  const b = await x.connect(token);
  const chat = new Promise(resolve => a.ws.on('message', raw => { if (JSON.parse(raw).type === 'chat') resolve(); }));
  b.ws.send(JSON.stringify({ type: 'kick', to: a.self }));
  b.ws.send(JSON.stringify({ type: 'chat', text: 'Owner remains connected' }));
  await chat;
  a.ws.send(JSON.stringify({ type: 'kick', to: b.self }));
  assert.equal((await b.closed)[0], 4403);
  assert.equal(x.saved.membership(room.id, member.account.id), undefined);
  await x.connect(token, true);
});

test('expired account session cannot use a still-valid room JWT', async t => {
  let now = Date.now();
  const x = await fixture(t, { auth: { now: () => now, sessionTtl: 1 } });
  const owner = await x.login('owner@example.com');
  const room = x.saved.create(owner.account.id, 'Expiry');
  const token = (await x.api('POST', `/saved-rooms/${room.id}/join`, {}, owner.accessToken)).body.token;
  now += 1001;
  assert.equal((await x.api('GET', '/auth/me', undefined, owner.accessToken)).status, 401);
  await x.connect(token, true);
});

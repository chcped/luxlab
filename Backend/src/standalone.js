import { log, diagnostic } from './logger.js';
import crypto from 'node:crypto';
import { installAccounts, httpError } from './accounts.js';
import { installSavedRooms } from './saved-rooms.js';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { WebSocketServer, WebSocket } from 'ws';
import rateLimit from 'express-rate-limit';

const scrypt = promisify(crypto.scrypt);
const palette = ['#7c6cff', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6', '#ef4444'];
export function profile(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return { name: String(value.name || 'Visitante').trim().slice(0, 32) || 'Visitante',
    color: palette.includes(value.color) ? value.color : palette[0],
    avatar: ['initial', '🌙', '🎮', '🚀', '🐱', '🎧', '🌻'].includes(value.avatar) ? value.avatar : 'initial' };
}

export function installStandalone(app, server, options) {
  const { secret, allowedOrigins, maxRooms = 100, maxMembers = 8, ttl = 14400, allowGuests = true,
    authSecret = secret, authIssuer = 'luxlab-auth', authAudience = 'luxlab-desktop',
    iceServers = [], turnUrls = [], turnSecret = '', iceTransportPolicy = 'all', accounts = null, saved = null, realtime = null } = options;
  if (!['all', 'relay'].includes(iceTransportPolicy)) throw new Error('ICE_TRANSPORT_POLICY deve ser all ou relay');
  const turnConfigured = !!(turnSecret && turnUrls.length) || iceServers.some(s => [].concat(s.urls).some(u => /^turns?:/.test(u)));
  if (iceTransportPolicy === 'relay' && !turnConfigured) throw new Error('Modo relay exige TURN configurado');
  log('info', 'rtc.config', { iceTransportPolicy, turnConfigured });
  const rooms = new Map();
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const sign = claims => jwt.sign(claims, secret, { algorithm: 'HS256', issuer: 'luxlab-rooms', audience: 'room-member', expiresIn: ttl });
  const verify = token => jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'luxlab-rooms', audience: 'room-member' });
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  app.use('/api/v2', rateLimit({ windowMs: 60000, limit: 40, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api/v2', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  function identity(req, res, next) {
    const token = req.get('authorization')?.replace(/^Bearer /, '');
    const local = accounts?.authenticate(token);
    if (local) { req.user = local; req.account = local.id; return next(); }
    if (!token && allowGuests) { req.account = null; return next(); }
    try {
      const claims = jwt.verify(token, authSecret, { algorithms: ['HS256'], issuer: authIssuer, audience: authAudience });
      if (typeof claims.sub !== 'string' || !claims.sub) throw new Error();
      req.account = claims.sub; next();
    } catch { res.status(401).json({ error: 'Faça login para entrar. Seu provedor deve fornecer um token de acesso válido.' }); }
  }
  function rtcConfig(id) {
    const result = [...iceServers];
    if (turnSecret && turnUrls.length) {
      const username = `${Math.floor(Date.now() / 1000) + ttl}:${id}`;
      result.push({ urls: turnUrls, username, credential: crypto.createHmac('sha1', turnSecret).update(username).digest('base64') });
    }
    return result;
  }
  const send = (ws, data) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1024 * 1024) { ws.close(4408, 'Conexão lenta'); return; }
    const encoded = JSON.stringify(data);
    log('debug', 'ws.out', { connectionId: ws.logId, type: data.type, bytes: Buffer.byteLength(encoded), bufferedBytes: ws.bufferedAmount });
    ws.send(encoded);
  };
  const roomSession = (room, memberId) => room?.realtimeSessions?.get(memberId);
  const summary = member => {
    const media = roomSession(member.room, member.id);
    return { id: member.id, profile: member.profile, sharing: member.sharing, owner: member.owner,
      media: media ? { sessionId: media.sessionId, tracks: [...media.published] } : null };
  };
  const broadcast = (room, data) => { for (const member of room.members.values()) send(member.ws, data); };
  const state = room => broadcast(room, { type: 'members', members: [...room.members.values()].map(summary), locked: !!room.password });
  const joinResponse = (room, req) => {
    const id = crypto.randomUUID();
    return { roomId: room.id, token: sign({ roomId: room.id, memberId: id, account: req.account, profile: profile(req.body?.profile),
      ...(req.user ? { accountSession: req.user.sessionId } : {}),
      ...(room.persistent ? { membershipVersion: saved.membership(room.id, req.account).version } : {}) }),
      iceServers: rtcConfig(id), iceTransportPolicy, expiresAt: room.persistent ? Date.now() + ttl * 1000 : room.expiresAt };
  };
  function runtime(id) {
    if (rooms.has(id)) return rooms.get(id);
    if (!saved?.get(id)) return null;
    if (rooms.size >= maxRooms) throw httpError(503, 'Servidor com limite de salas ativas atingido.');
    const room = { id, persistent: true, password: null, expiresAt: Infinity, idleExpires: Date.now() + 60000, members: new Map(), messages: [], banned: new Set(), realtimeSessions: new Map() };
    rooms.set(id, room);
    return room;
  }
  function revoke(id, accountId) {
    const room = rooms.get(id);
    if (!room) return;
    for (const member of room.members.values()) if (!accountId || member.account === accountId) {
      room.members.delete(member.id); member.ws.close(4403, 'Acesso à sala removido');
    }
    if (!room.members.size) rooms.delete(id); else state(room);
  }
  function joinSaved(id, req) {
    if (!req.user) throw httpError(401, 'Faça login com seu e-mail.');
    if (!saved.get(id) || !saved.membership(id, req.account)) throw httpError(404, 'Sala não encontrada ou acesso não autorizado.');
    const room = runtime(id);
    if (room.members.size >= maxMembers) throw httpError(409, 'Sala cheia.');
    return joinResponse(room, req);
  }
  function validAccount(claims, room) {
    if (claims.accountSession && !accounts?.sessionValid(claims.accountSession, claims.account)) return false;
    if (!room.persistent) return true;
    return !!claims.accountSession && typeof claims.membershipVersion === 'string' && !!saved.get(room.id) && saved.membership(room.id, claims.account)?.version === claims.membershipVersion;
  }
  if (accounts) installAccounts(app, accounts, sessionId => {
    for (const ws of sockets.clients) if (ws.accountSession === sessionId) ws.close(4401, 'Login encerrado');
  });
  if (accounts && saved) installSavedRooms(app, { accounts, saved, join: joinSaved, revoke });
  app.get('/api/v2/config', (_req, res) => res.json({ allowGuests, maxMembers, roomTtlSeconds: ttl,
    emailLogin: !!accounts?.enabled, persistentRooms: !!(accounts && saved) }));
  app.post('/api/v2/rooms', identity, wrap(async (req, res) => {
    if (rooms.size >= maxRooms) return res.status(503).json({ error: 'Servidor com limite de salas atingido.' });
    const password = req.body?.password;
    if (password !== undefined && (typeof password !== 'string' || password.length > 128 || (password.length > 0 && password.length < 4)))
      return res.status(400).json({ error: 'Use uma senha de 4 a 128 caracteres.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = password ? (await scrypt(password, salt, 32)).toString('hex') : null;
    if (rooms.size >= maxRooms) return res.status(503).json({ error: 'Servidor com limite de salas atingido.' });
    const room = { id: crypto.randomBytes(9).toString('base64url'), salt, password: hash, members: new Map(), realtimeSessions: new Map(),
      expiresAt: Date.now() + ttl * 1000, ownerId: null, messages: [], banned: new Set() };
    const result = joinResponse(room, req);
    room.ownerId = verify(result.token).memberId;
    rooms.set(room.id, room);
    res.status(201).json(result);
  }));
  app.post('/api/v2/rooms/:id/join', identity, wrap(async (req, res) => {
    if (saved?.get(req.params.id)) return res.json(joinSaved(req.params.id, req));
    const room = rooms.get(req.params.id);
    if (!room || room.expiresAt <= Date.now()) return res.status(404).json({ error: 'Sala não encontrada ou expirada.' });
    if (room.password) {
      const password = req.body?.password;
      if (typeof password !== 'string' || password.length > 128) return res.status(403).json({ error: 'Informe a senha da sala.', code: 'PASSWORD_REQUIRED' });
      const hash = await scrypt(password, room.salt, 32);
      if (!crypto.timingSafeEqual(hash, Buffer.from(room.password, 'hex'))) return res.status(403).json({ error: 'Senha da sala incorreta.', code: 'PASSWORD_REQUIRED' });
    }
    if (room.members.size >= maxMembers) return res.status(409).json({ error: 'Sala cheia.' });
    res.json(joinResponse(room, req));
  }));
  function realtimeAccess(req, res, next) {
    if (!realtime) return res.status(503).json({ error: 'Cloudflare Realtime nao configurado.' });
    try {
      const token = req.get('authorization')?.replace(/^Bearer /, '');
      const claims = verify(token);
      const room = runtime(claims.roomId);
      if (!room || room.expiresAt <= Date.now() || !validAccount(claims, room)) throw new Error();
      req.realtimeRoom = room; req.realtimeMemberId = claims.memberId; next();
    } catch { res.status(401).json({ error: 'Token da sala invalido ou expirado.' }); }
  }
  const ownRealtimeSession = req => {
    const session = roomSession(req.realtimeRoom, req.realtimeMemberId);
    return session?.sessionId === req.params.sessionId ? session : null;
  };
  const safeTracks = body => Array.isArray(body?.tracks) && body.tracks.length > 0 && body.tracks.length <= 8 && body.tracks.every(track =>
    track && ['local', 'remote'].includes(track.location) && typeof track.trackName === 'string' && track.trackName.length > 0 && track.trackName.length <= 128);
  app.post('/api/v2/realtime/sessions', realtimeAccess, wrap(async (req, res) => {
    const created = await realtime.createSession();
    if (typeof created.sessionId !== 'string' || !created.sessionId) throw httpError(502, 'Cloudflare Realtime nao retornou uma sessao valida.');
    req.realtimeRoom.realtimeSessions.set(req.realtimeMemberId, { sessionId: created.sessionId, published: new Set() });
    res.status(201).json({ sessionId: created.sessionId, iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
  }));
  app.post('/api/v2/realtime/sessions/:sessionId/tracks', realtimeAccess, wrap(async (req, res) => {
    const session = ownRealtimeSession(req);
    if (!session) throw httpError(403, 'Sessao de midia nao pertence a este participante.');
    if (!safeTracks(req.body)) throw httpError(400, 'Lista de tracks invalida.');
    for (const track of req.body.tracks) if (track.location === 'remote') {
      const source = [...req.realtimeRoom.realtimeSessions.values()].find(item => item.sessionId === track.sessionId);
      if (!source?.published.has(track.trackName)) throw httpError(403, 'Track remota nao pertence a esta sala.');
    }
    const result = await realtime.addTracks(session.sessionId, req.body);
    for (const track of req.body.tracks) if (track.location === 'local') session.published.add(track.trackName);
    state(req.realtimeRoom); res.json(result);
  }));
  app.put('/api/v2/realtime/sessions/:sessionId/renegotiate', realtimeAccess, wrap(async (req, res) => {
    const session = ownRealtimeSession(req);
    if (!session) throw httpError(403, 'Sessao de midia nao pertence a este participante.');
    res.json(await realtime.renegotiate(session.sessionId, req.body));
  }));
  app.put('/api/v2/realtime/sessions/:sessionId/tracks/close', realtimeAccess, wrap(async (req, res) => {
    const session = ownRealtimeSession(req);
    if (!session) throw httpError(403, 'Sessao de midia nao pertence a este participante.');
    if (!safeTracks(req.body)) throw httpError(400, 'Lista de tracks invalida.');
    const result = await realtime.closeTracks(session.sessionId, req.body);
    for (const track of req.body.tracks) if (track.location === 'local') session.published.delete(track.trackName);
    state(req.realtimeRoom); res.json(result);
  }));
  const upgrade = (req, socket, head) => {
    let url; try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/ws' || (req.headers.origin && !allowedOrigins.has(req.headers.origin))) { socket.destroy(); return; }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  };
  server.on('upgrade', upgrade);
  sockets.on('connection', ws => {
    ws.logId = crypto.randomUUID(); const started = Date.now();
    log('info', 'ws.open', { connectionId: ws.logId });
    let member, room, expires;
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    const timeout = setTimeout(() => ws.close(4401, 'Autenticação obrigatória'), 8000);
    let windowStart = Date.now(), count = 0;
    ws.on('message', raw => {
      if (Date.now() - windowStart > 10000) { windowStart = Date.now(); count = 0; }
      if (++count > 400) { ws.close(4429, 'Muitas mensagens'); return; }
      let msg; try { msg = JSON.parse(raw.toString()); if (!msg || typeof msg !== 'object') throw new Error(); }
      catch { ws.close(4400, 'Mensagem inválida'); return; }
      log('debug', 'ws.in', { connectionId: ws.logId, type: ['join', 'signal', 'sharing', 'profile', 'chat', 'kick', 'telemetry'].includes(msg.type) ? msg.type : 'unknown', bytes: raw.length });
      if (!member) {
        try {
          if (msg.type !== 'join') throw new Error();
          const claims = verify(msg.token);
          room = runtime(claims.roomId);
          if (!room || room.expiresAt <= Date.now() || room.members.size >= maxMembers || room.members.has(claims.memberId) || room.banned.has(claims.memberId)) throw new Error();
          if (!validAccount(claims, room)) throw new Error();
          member = { id: claims.memberId, ws, profile: profile(claims.profile), sharing: false, room,
            account: claims.account, accountSession: claims.accountSession, membershipVersion: claims.membershipVersion,
            owner: room.persistent ? saved.get(room.id).owner_id === claims.account : room.ownerId === claims.memberId };
          ws.accountSession = claims.accountSession;
          room.members.set(member.id, member);
          log('info', 'room.join', { connectionId: ws.logId, roomId: room.id, memberId: member.id, members: room.members.size });
          clearTimeout(timeout);
          expires = setTimeout(() => ws.close(4401, 'Sessão expirada'), Math.max(1, claims.exp * 1000 - Date.now()));
          send(ws, { type: 'joined', self: member.id, roomId: room.id, messages: room.messages });
          state(room);
        } catch { ws.close(4403, 'Sala indisponível ou convite expirado'); }
        return;
      }
      if (room.members.get(member.id) !== member) return;
      if (!validAccount(member, room)) { ws.close(4403, 'Acesso à sala removido'); return; }
      if (msg.type === 'telemetry') {
        if (Date.now() - (member.lastTelemetry || 0) > 10000) { member.lastTelemetry = Date.now(); member.telemetryCount = 0; }
        if ((member.telemetryCount = (member.telemetryCount || 0) + 1) <= 100 && room.members.has(msg.peerId))
          log('info', 'rtc.client', { roomId: room.id, memberId: member.id, peerId: msg.peerId, metrics: diagnostic(msg.metrics) });
      } else if (msg.type === 'signal') {
        const target = room.members.get(msg.to);
        if (!target || target === member || !msg.payload || typeof msg.payload !== 'object') return;
        send(target.ws, { type: 'signal', from: member.id, payload: msg.payload });
      } else if (msg.type === 'sharing' && typeof msg.active === 'boolean') {
        member.sharing = msg.active; state(room);
      } else if (msg.type === 'profile') {
        member.profile = profile(msg.profile); state(room);
      } else if (msg.type === 'chat' && typeof msg.text === 'string') {
        const text = msg.text.trim().slice(0, 1000);
        if (!text || Date.now() - (member.lastChat || 0) < 500) return;
        member.lastChat = Date.now();
        const message = { id: crypto.randomUUID(), profile: member.profile, text, at: Date.now() };
        room.messages.push(message); if (room.messages.length > 100) room.messages.shift();
        broadcast(room, { type: 'chat', message });
      } else if (msg.type === 'kick' && member.owner && msg.to !== member.id) {
        const target = room.members.get(msg.to);
        if (target && room.persistent) {
          if (target.account === member.account) return;
          saved.remove(room.id, target.account); revoke(room.id, target.account); return;
        }
        if (target) { room.banned.add(target.id); room.members.delete(target.id); target.ws.close(4403, 'Removido pelo dono da sala'); state(room); }
      }
    });
    ws.on('error', error => log('error', 'ws.error', { connectionId: ws.logId, message: error.message }));
    ws.on('close', (code) => {
      log('info', 'ws.close', { connectionId: ws.logId, roomId: room?.id, memberId: member?.id, code, durationMs: Date.now() - started });
      clearTimeout(timeout); clearTimeout(expires);
      if (!member || !room || room.members.get(member.id) !== member) return;
      room.members.delete(member.id);
      room.realtimeSessions.delete(member.id);
      if (!room.persistent && member.owner && room.members.size) {
        const next = room.members.values().next().value; next.owner = true; room.ownerId = next.id;
      }
      if (!room.members.size) rooms.delete(room.id); else state(room);
    });
  });
  const heartbeat = setInterval(() => {
    accounts?.prune();
    for (const [id, room] of rooms) if (room.persistent && !room.members.size && room.idleExpires <= Date.now()) rooms.delete(id);
    for (const room of rooms.values()) for (const member of room.members.values()) if (!validAccount(member, room)) member.ws.close(4403, 'Acesso expirado');
    for (const ws of sockets.clients) { if (!ws.alive) { log('warn', 'ws.heartbeat_timeout', { connectionId: ws.logId }); ws.terminate(); } else { ws.alive = false; ws.ping(); } }
    for (const [id, room] of rooms) if (room.expiresAt <= Date.now()) {
      rooms.delete(id); for (const m of room.members.values()) m.ws.close(4401, 'Sala expirada');
    }
  }, 30000);
  heartbeat.unref();
  return () => { clearInterval(heartbeat); server.off('upgrade', upgrade); for (const ws of sockets.clients) ws.terminate(); sockets.close(); rooms.clear(); };
}

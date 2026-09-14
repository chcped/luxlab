import crypto from 'node:crypto';
import { httpError, normalizeEmail } from './accounts.js';

export function createSavedRooms({ store, secret, maxSavedRooms = 1000, maxOwnedRooms = 20, maxSavedMembers = 100 }) {
  const get = id => store.get('SELECT * FROM saved_rooms WHERE id = ?', id);
  const membership = (roomId, accountId) => typeof accountId === 'string' ? store.get('SELECT * FROM room_memberships WHERE room_id = ? AND account_id = ? AND blocked = 0', roomId, accountId) : null;
  const owner = (id, accountId) => {
    const room = get(id);
    if (!room || room.owner_id !== accountId) throw httpError(404, 'Sala não encontrada.');
    return room;
  };
  const name = value => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw httpError(400, 'Use um nome de 1 a 80 caracteres.');
    return value.trim();
  };
  const summary = (room, accountId) => ({ id: room.id, name: room.name, ownerId: room.owner_id, role: room.owner_id === accountId ? 'owner' : 'member', createdAt: room.created_at });
  function invite(room) {
    if (!room.invite_version) return { enabled: false, code: null };
    const signature = crypto.createHmac('sha256', secret).update(`room-invite:${room.id}:${room.invite_version}`).digest('base64url');
    return { enabled: true, code: `${room.id}.${signature}` };
  }
  function add(id, accountId, { unblock = false } = {}) {
    const current = store.get('SELECT * FROM room_memberships WHERE room_id = ? AND account_id = ?', id, accountId);
    if (current?.blocked && !unblock) throw httpError(403, 'Seu acesso a esta sala foi removido. Peça autorização ao dono.');
    if (current && !current.blocked) return;
    const count = store.get('SELECT count(*) AS count FROM room_memberships WHERE room_id = ? AND blocked = 0', id).count;
    if (count >= maxSavedMembers) throw httpError(409, 'Limite de membros autorizados atingido.');
    store.run(`INSERT INTO room_memberships(room_id,account_id,version,blocked,joined_at) VALUES(?,?,?,0,?)
      ON CONFLICT(room_id,account_id) DO UPDATE SET version=excluded.version,blocked=0,joined_at=excluded.joined_at`, id, accountId, crypto.randomUUID(), Date.now());
  }
  function remove(id, accountId) {
    const room = get(id);
    if (!room || room.owner_id === accountId) throw httpError(409, 'O dono não pode ser removido. Exclua a sala para encerrá-la.');
    store.run('UPDATE room_memberships SET blocked = 1, version = ? WHERE room_id = ? AND account_id = ?', crypto.randomUUID(), id, accountId);
  }
  return { store, get, membership, owner, summary, invite, add, remove,
    create(accountId, value, enabled = true) {
      const roomName = name(value);
      if (typeof enabled !== 'boolean') throw httpError(400, 'inviteEnabled deve ser booleano.');
      return store.transaction(() => {
        if (store.get('SELECT count(*) AS count FROM saved_rooms').count >= maxSavedRooms) throw httpError(503, 'Limite de salas permanentes atingido.');
        if (store.get('SELECT count(*) AS count FROM saved_rooms WHERE owner_id = ?', accountId).count >= maxOwnedRooms) throw httpError(409, 'Você atingiu o limite de salas próprias.');
        let id;
        do { id = crypto.randomBytes(9).toString('base64url'); } while (get(id));
        store.run('INSERT INTO saved_rooms(id,name,owner_id,invite_version,created_at) VALUES(?,?,?,?,?)', id, roomName, accountId, enabled ? crypto.randomBytes(16).toString('hex') : null, Date.now());
        add(id, accountId);
        return get(id);
      });
    },
    rename(id, value) { store.run('UPDATE saved_rooms SET name = ? WHERE id = ?', name(value), id); },
    accept(accountId, code) {
      if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/.test(code)) throw httpError(404, 'Convite inválido ou desativado.');
      return store.transaction(() => {
        const room = get(code.split('.')[0]);
        const expected = room && invite(room).code;
        if (!expected || !crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))) throw httpError(404, 'Convite inválido ou desativado.');
        add(room.id, accountId);
        return room;
      });
    }
  };
}

export function installSavedRooms(app, { accounts, saved, join, revoke }) {
  const { store } = saved;
  app.use(['/api/v2/saved-rooms', '/api/v2/invites'], accounts.required, (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/v2/saved-rooms', (req, res) => {
    const rooms = store.all(`SELECT r.* FROM saved_rooms r JOIN room_memberships m ON m.room_id = r.id WHERE m.account_id = ? AND m.blocked = 0 ORDER BY r.created_at, r.id`, req.account);
    res.json({ rooms: rooms.map(room => saved.summary(room, req.account)) });
  });
  app.post('/api/v2/saved-rooms', (req, res) => {
    const room = saved.create(req.account, req.body?.name, req.body?.inviteEnabled ?? true);
    res.status(201).json({ room: saved.summary(room, req.account), invite: saved.invite(room) });
  });
  app.get('/api/v2/saved-rooms/:id', (req, res) => {
    const room = saved.get(req.params.id);
    if (!room || !saved.membership(room.id, req.account)) throw httpError(404, 'Sala não encontrada.');
    res.json({ room: saved.summary(room, req.account) });
  });
  app.patch('/api/v2/saved-rooms/:id', (req, res) => {
    saved.owner(req.params.id, req.account); saved.rename(req.params.id, req.body?.name);
    res.json({ room: saved.summary(saved.get(req.params.id), req.account) });
  });
  app.delete('/api/v2/saved-rooms/:id', (req, res) => {
    saved.owner(req.params.id, req.account);
    store.run('DELETE FROM saved_rooms WHERE id = ?', req.params.id);
    revoke(req.params.id); res.status(204).end();
  });
  app.post('/api/v2/saved-rooms/:id/join', (req, res) => res.json(join(req.params.id, req)));
  app.get('/api/v2/saved-rooms/:id/members', (req, res) => {
    saved.owner(req.params.id, req.account);
    res.json({ members: store.all(`SELECT a.id, a.email, m.joined_at AS joinedAt FROM room_memberships m JOIN accounts a ON a.id = m.account_id WHERE m.room_id = ? AND m.blocked = 0 ORDER BY m.joined_at, a.id`, req.params.id) });
  });
  app.post('/api/v2/saved-rooms/:id/members', (req, res) => {
    saved.owner(req.params.id, req.account);
    const account = store.get('SELECT id FROM accounts WHERE email = ?', normalizeEmail(req.body?.email));
    if (!account) throw httpError(404, 'Essa pessoa precisa criar uma conta primeiro.');
    store.transaction(() => saved.add(req.params.id, account.id, { unblock: true }));
    res.status(204).end();
  });
  app.delete('/api/v2/saved-rooms/:id/members/:accountId', (req, res) => {
    saved.owner(req.params.id, req.account);
    saved.remove(req.params.id, req.params.accountId);
    revoke(req.params.id, req.params.accountId); res.status(204).end();
  });
  app.post('/api/v2/saved-rooms/:id/leave', (req, res) => {
    if (!saved.membership(req.params.id, req.account)) throw httpError(404, 'Sala não encontrada.');
    saved.remove(req.params.id, req.account);
    // Voluntary departure permits accepting a new invitation later.
    store.run('DELETE FROM room_memberships WHERE room_id = ? AND account_id = ?', req.params.id, req.account);
    revoke(req.params.id, req.account); res.status(204).end();
  });
  app.get('/api/v2/saved-rooms/:id/invite', (req, res) => res.json({ invite: saved.invite(saved.owner(req.params.id, req.account)) }));
  app.post('/api/v2/saved-rooms/:id/invite', (req, res) => {
    saved.owner(req.params.id, req.account);
    if (typeof req.body?.enabled !== 'boolean') throw httpError(400, 'Informe enabled como booleano.');
    // Every enable request rotates the link; existing memberships are preserved.
    store.run('UPDATE saved_rooms SET invite_version = ? WHERE id = ?', req.body.enabled ? crypto.randomBytes(16).toString('hex') : null, req.params.id);
    res.json({ invite: saved.invite(saved.get(req.params.id)) });
  });
  app.post('/api/v2/invites/accept', (req, res) => {
    const room = saved.accept(req.account, req.body?.code);
    res.json({ room: saved.summary(room, req.account) });
  });
}

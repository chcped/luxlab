import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';

export const httpError = (status, message) => Object.assign(new Error(message), { status });
export function normalizeEmail(value) {
  if (typeof value !== 'string') throw httpError(400, 'Informe um e-mail válido.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email) || email.includes('..')) throw httpError(400, 'Informe um e-mail válido.');
  return email;
}
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (left, right) => crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));

export function createAccounts({ store, secret, sendCode, now = Date.now, sessionTtl = 30 * 86400 }) {
  const codeHash = (email, code) => crypto.createHmac('sha256', secret).update(`login:${email}:${code}`).digest('hex');
  const sessionValid = (id, accountId) => !!store.get('SELECT id FROM account_sessions WHERE id = ? AND account_id = ? AND expires_at > ?', id, accountId, now());
  function authenticate(token) {
    if (typeof token !== 'string' || !/^ll_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = store.get('SELECT a.*, s.id AS sessionId, s.expires_at AS expiresAt FROM account_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.id = ? AND s.expires_at > ?', digest(token), now());
    return row || null;
  }
  async function requestCode(value) {
    const email = normalizeEmail(value), time = now();
    if (!sendCode) throw httpError(503, 'Login por e-mail ainda não configurado.');
    const previous = store.get('SELECT * FROM login_codes WHERE email = ?', email);
    if (previous && (time - previous.sent_at < 60000 || (time - previous.window_at < 3600000 && previous.sends >= 5))) return;
    const code = String(crypto.randomInt(100000000)).padStart(8, '0');
    const hash = codeHash(email, code);
    const sameWindow = previous && time - previous.window_at < 3600000;
    store.run(`INSERT INTO login_codes(email,digest,expires_at,attempts,sent_at,window_at,sends) VALUES(?,?,?,0,?,?,?)
      ON CONFLICT(email) DO UPDATE SET digest=excluded.digest,expires_at=excluded.expires_at,attempts=0,sent_at=excluded.sent_at,window_at=excluded.window_at,sends=excluded.sends`,
    email, hash, time + 600000, time, sameWindow ? previous.window_at : time, sameWindow ? previous.sends + 1 : 1);
    try { await sendCode(email, code); }
    catch {
      // A failed delivery must not leave a usable code or erase a newer request.
      store.run('UPDATE login_codes SET expires_at = 0 WHERE email = ? AND digest = ?', email, hash);
      throw httpError(503, 'Não foi possível enviar o código. Tente novamente em um minuto.');
    }
  }
  function verifyCode(value, code) {
    const email = normalizeEmail(value);
    if (typeof code !== 'string' || !/^\d{8}$/.test(code)) throw httpError(400, 'Informe o código de 8 dígitos.');
    const result = store.transaction(() => {
      const row = store.get('SELECT * FROM login_codes WHERE email = ?', email);
      if (!row || row.expires_at <= now() || row.attempts >= 5) return null;
      store.run('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?', email);
      if (!same(row.digest, codeHash(email, code))) return null;
      // Keep the delivery counters even after successful verification.
      store.run('UPDATE login_codes SET expires_at = 0 WHERE email = ?', email);
      store.run('INSERT OR IGNORE INTO accounts(id,email,created_at) VALUES(?,?,?)', crypto.randomUUID(), email, now());
      const account = store.get('SELECT * FROM accounts WHERE email = ?', email);
      const accessToken = `ll_${crypto.randomBytes(32).toString('base64url')}`;
      const expiresAt = now() + sessionTtl * 1000;
      store.run('INSERT INTO account_sessions(id,account_id,expires_at,created_at) VALUES(?,?,?,?)', digest(accessToken), account.id, expiresAt, now());
      return { account: { id: account.id, email: account.email }, accessToken, tokenType: 'Bearer', expiresAt };
    });
    if (!result) throw httpError(401, 'Código inválido ou expirado.');
    return result;
  }
  function required(req, res, next) {
    const account = authenticate(req.get('authorization')?.replace(/^Bearer /, ''));
    if (!account) return res.status(401).json({ error: 'Faça login com seu e-mail.' });
    req.user = account; req.account = account.id; next();
  }
  const prune = () => {
    store.run('DELETE FROM account_sessions WHERE expires_at <= ?', now());
    store.run('DELETE FROM login_codes WHERE sent_at < ?', now() - 86400000);
  };
  return { store, authenticate, sessionValid, requestCode, verifyCode, required, prune,
    enabled: !!sendCode, logout: sessionId => store.run('DELETE FROM account_sessions WHERE id = ?', sessionId) };
}

export function installAccounts(app, accounts, onLogout = () => {}) {
  app.use('/api/v2/auth', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api/v2/auth', rateLimit({ windowMs: 60000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
  const requests = rateLimit({ windowMs: 900000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false });
  app.post('/api/v2/auth/email/request', requests, async (req, res) => {
    await accounts.requestCode(req.body?.email);
    res.status(202).json({ message: 'Se o envio estiver disponível, você receberá um código. Aguarde um minuto antes de solicitar outro.' });
  });
  app.post('/api/v2/auth/email/verify', (req, res) => res.json(accounts.verifyCode(req.body?.email, req.body?.code)));
  app.get('/api/v2/auth/me', accounts.required, (req, res) => res.json({ account: { id: req.user.id, email: req.user.email }, expiresAt: req.user.expiresAt }));
  app.post('/api/v2/auth/logout', accounts.required, (req, res) => {
    accounts.logout(req.user.sessionId); onLogout(req.user.sessionId); res.status(204).end();
  });
}

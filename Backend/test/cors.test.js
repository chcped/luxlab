import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';

process.env.JWT_SECRET = 'test-secret-cors-only-1234567890123456';
process.env.ADMIN_API_KEY = 'test-admin-cors-only-1234567890123456';

process.env.ALLOWED_ORIGINS = 'https://luxlab.net.br';
const { originCors } = await import('../src/http-cors.js');

test('CORS permite desktop e site configurados e recusa origens externas', async t => {
  const app = express(); app.use(originCors);
  app.get('/config', (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/config`;
  for (const origin of ['app://desktop', 'https://luxlab.net.br']) {
    const response = await fetch(url, { headers: { Origin: origin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  }
  const rejected = await fetch(url, { headers: { Origin: 'https://999999999999999999.discordsays.com' } });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
});


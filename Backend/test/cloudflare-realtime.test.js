import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareRealtime, RealtimeApiError } from '../src/cloudflare-realtime.js';

test('cliente Realtime mantem segredo no backend e encaminha SDP', async () => {
  const calls = [];
  const realtime = createCloudflareRealtime({ appId: 'app/id', appSecret: 'super-secret', fetch: async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ sessionId: 'session-1' }), { status: 200 });
  } });
  assert.equal((await realtime.createSession()).sessionId, 'session-1');
  await realtime.addTracks('session/1', { tracks: [{ location: 'local', trackName: 'screen' }] });
  assert.equal(calls[0].url, 'https://rtc.live.cloudflare.com/v1/apps/app%2Fid/sessions/new');
  assert.equal(calls[0].options.headers.authorization, 'Bearer super-secret');
  assert.match(calls[1].url, /sessions\/session%2F1\/tracks\/new$/);
  assert.doesNotMatch(JSON.stringify(calls[1].options.body), /super-secret/);
});

test('cliente Realtime normaliza falhas sem expor resposta sensivel', async () => {
  const realtime = createCloudflareRealtime({ appId: 'app', appSecret: 'secret', fetch: async () =>
    new Response(JSON.stringify({ error: 'internal detail' }), { status: 401 }) });
  await assert.rejects(realtime.createSession(), error => error instanceof RealtimeApiError && error.status === 409 && !error.message.includes('internal detail'));
});

test('cliente Realtime fica desabilitado sem as duas credenciais', () => {
  assert.equal(createCloudflareRealtime({ appId: '', appSecret: '' }), null);
});

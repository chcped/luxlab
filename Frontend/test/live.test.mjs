import test from 'node:test';
import assert from 'node:assert/strict';
import { LivePublisher, serverURLs } from '../src/live-publisher.mjs';

test('configuração usa HTTPS/WSS e rejeita URLs inseguras ou com segredo', () => {
  assert.deepEqual(serverURLs('https://luxlab.net.br'), { api: 'https://luxlab.net.br/api/live/pair', ingest: 'wss://luxlab.net.br/ingest' });
  for (const value of ['http://luxlab.net.br', 'https://user:pass@luxlab.net.br', 'https://luxlab.net.br/?token=secret']) assert.throws(() => serverURLs(value));
  assert.equal(serverURLs('http://localhost:8080').ingest, 'ws://localhost:8080/ingest');
});
test('gravação só começa após ready; congestionamento desliga gravação e socket', async t => {
  const originalWs = globalThis.WebSocket; const originalRecorder = globalThis.MediaRecorder;
  class Socket { static OPEN = 1; readyState = 1; bufferedAmount = 0; sent = []; send(data) { this.sent.push(data); } close() { this.readyState = 3; } }
  class Recorder { static isTypeSupported() { return true; } state = 'inactive'; start() { this.state = 'recording'; } stop() { this.state = 'inactive'; } }
  globalThis.WebSocket = Socket; globalThis.MediaRecorder = Recorder;
  t.after(() => { globalThis.WebSocket = originalWs; globalThis.MediaRecorder = originalRecorder; });
  let failure;
  const publisher = new LivePublisher({ server: 'wss://luxlab.net.br/ingest', token: 'token' }, {}, message => { failure = message; });
  t.after(() => publisher.close());
  const connected = publisher.connect();
  assert.equal(publisher.recorder, undefined);
  publisher.ws.onopen();
  assert.equal(JSON.parse(publisher.ws.sent[0]).token, 'token');
  publisher.ws.onmessage({ data: '{"type":"ready"}' });
  await connected;
  publisher.ws.bufferedAmount = 9 * 1024 * 1024;
  publisher.recorder.ondataavailable({ data: new Blob(['video']) });
  assert.match(failure, /congestionado/);
  assert.equal(publisher.recorder.state, 'inactive');
  assert.equal(publisher.ws.readyState, 3);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { setupProcessAudio } = createRequire(import.meta.url)('../electron/process-audio.cjs');
function setup() {
  const handlers = {}, app = new EventEmitter(), sent = [];
  let callback, running = false, stops = 0;
  const contents = { isDestroyed: () => false, send: (...args) => sent.push(args) };
  const capture = {
    getProcessList: () => [{ pid: 42, name: 'Player' }],
    startCapture(pid, cb) { assert.equal(pid, 42); callback = cb; running = true; return true; },
    stopCapture() { if (running) stops++; running = false; }
  };
  const service = setupProcessAudio({ ipcMain: { handle: (name, handler) => handlers[name] = handler }, getWindow: () => ({ webContents: contents }), trusted: frame => frame?.url === 'app://desktop/index.html', app, loadCapture: () => capture });
  const event = { sender: contents, senderFrame: { url: 'app://desktop/index.html' } };
  return { handlers, service, event, app, sent, emit: data => callback(data), stops: () => stops };
}
test('rejects unauthorized callers and processes that were not offered', () => {
  const { handlers, event } = setup();
  assert.throws(() => handlers['audio:processes']({ ...event, sender: {} }), /Origem/);
  assert.throws(() => handlers['audio:start'](event, 42, 'a'), /Selecione/);
});
test('captures only selected process and rejects stale stop and audio packets', { skip: process.platform !== 'win32' }, () => {
  const x = setup();
  x.handlers['audio:processes'](x.event);
  x.handlers['audio:start'](x.event, 42, 'first');
  x.emit({ buffer: new Float32Array([0.1, 0.1]), channels: 2, sampleRate: 48000 });
  assert.equal(x.sent[0][1].token, 'first');
  x.handlers['audio:stop'](x.event, 'old');
  assert.equal(x.stops(), 0);
  x.handlers['audio:stop'](x.event, 'first');
  x.emit({ buffer: new Float32Array(2) });
  assert.equal(x.sent.length, 1);
  assert.equal(x.stops(), 1);
});
test('quitting stops native capture', { skip: process.platform !== 'win32' }, () => {
  const x = setup();
  x.handlers['audio:processes'](x.event);
  x.handlers['audio:start'](x.event, 42, 'active');
  x.app.emit('before-quit');
  assert.equal(x.stops(), 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setupUpdates } from '../electron/updates.cjs';

function fixture(t, packaged = true) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const app = new EventEmitter();
  app.isPackaged = packaged;
  const updater = new EventEmitter();
  updater.checkForUpdates = t.mock.fn(async () => {});
  updater.quitAndInstall = t.mock.fn();
  const handlers = new Map();
  const messages = [];
  const window = { webContents: { isDestroyed: () => false, send: (_, state) => messages.push(state) } };
  const event = { sender: window.webContents, senderFrame: { url: 'app://desktop/index.html' } };
  setupUpdates({ app, updater, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, getWindow: () => window, trusted: frame => frame?.url === event.senderFrame.url });
  t.after(() => app.emit('before-quit'));
  return { app, updater, handlers, messages, event };
}

test('atualizador fica desativado em desenvolvimento', t => {
  const { updater, handlers, event } = fixture(t, false);
  t.mock.timers.tick(20000);
  assert.equal(handlers.get('updates:get')(event).status, 'disabled');
  assert.equal(handlers.get('updates:install')(event), false);
  assert.equal(updater.checkForUpdates.mock.callCount(), 0);
});

test('download em segundo plano só instala após ação explícita e uma única vez', { skip: process.platform !== 'win32' }, async t => {
  const { updater, handlers, event, messages } = fixture(t);
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(handlers.get('updates:install')(event), false);
  t.mock.timers.tick(15000);
  await Promise.resolve();
  assert.equal(updater.checkForUpdates.mock.callCount(), 1);
  updater.emit('update-available', { version: '0.3.1' });
  assert.equal(handlers.get('updates:install')(event), false);
  updater.emit('update-downloaded', { version: '0.3.1' });
  assert.deepEqual(messages.at(-1), { status: 'downloaded', version: '0.3.1' });
  assert.equal(updater.quitAndInstall.mock.callCount(), 0);
  t.mock.timers.tick(4 * 60 * 60 * 1000);
  assert.equal(updater.checkForUpdates.mock.callCount(), 1);
  assert.equal(handlers.get('updates:install')(event), true);
  assert.equal(handlers.get('updates:install')(event), false);
  await new Promise(setImmediate);
  assert.deepEqual(updater.quitAndInstall.mock.calls[0].arguments, [true, true]);
});

test('IPC rejeita outra janela e origem não confiável', t => {
  const { handlers, event } = fixture(t, false);
  for (const handler of handlers.values()) {
    assert.throws(() => handler({ ...event, sender: {} }), /Origem inválida/);
    assert.throws(() => handler({ ...event, senderFrame: { url: 'https://example.com' } }), /Origem inválida/);
  }
});

test('falha de rede permite nova tentativa periódica', { skip: process.platform !== 'win32' }, async t => {
  const { updater, handlers, event } = fixture(t);
  t.mock.method(console, 'warn', () => {});
  updater.checkForUpdates.mock.mockImplementationOnce(async () => { throw new Error('offline'); });
  t.mock.timers.tick(15000);
  await new Promise(setImmediate);
  assert.equal(handlers.get('updates:get')(event).status, 'error');
  t.mock.timers.tick(4 * 60 * 60 * 1000);
  await new Promise(setImmediate);
  assert.equal(updater.checkForUpdates.mock.callCount(), 2);
});

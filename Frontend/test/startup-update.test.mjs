import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkStartup, updateMarker } from '../electron/startup-update.cjs';

function fixture(action) {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => action(updater);
  const states = [], written = [];
  const marker = { write: version => written.push(version), clear() {} };
  return { updater, marker, states, written, render: state => states.push(state.status), timeoutMs: 30 };
}
test('sem atualizacao abre o app e remove listeners temporarios', async () => {
  const f = fixture(u => u.emit('update-not-available'));
  assert.equal(await checkStartup(f), 'open');
  assert.deepEqual(f.states, ['checking']);
  assert.equal(f.updater.listenerCount('update-downloaded'), 0);
});
test('erro e timeout de rede liberam abertura', async () => {
  for (const action of [() => { throw new Error('offline'); }, () => new Promise(() => {})]) {
    assert.equal(await checkStartup(fixture(action)), 'open');
  }
});
test('download tardio depois do timeout nao instala durante uso', async () => {
  const f = fixture(() => new Promise(() => {}));
  f.updater.quitAndInstall = () => assert.fail('nao deve instalar');
  await checkStartup(f);
  f.updater.emit('update-downloaded', { version: '0.3.3' });
  assert.deepEqual(f.written, []);
});
test('aplica automaticamente e grava a versao antes de reiniciar; falha libera app', async () => {
  const f = fixture(u => { u.emit('update-available', { version: '0.3.3' }); u.emit('update-downloaded', { version: '0.3.3' }); });
  f.updater.quitAndInstall = (silent, reopen) => {
    assert.deepEqual(f.written, ['0.3.3']);
    assert.equal(silent, true); assert.equal(reopen, true);
    throw new Error('instalador indisponivel');
  };
  await checkStartup(f);
  assert.deepEqual(f.states, ['checking', 'downloading', 'installing']);
});
test('pula busca apenas uma vez e somente na versao instalada esperada', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luxlab-update-'));
  const app = { getPath: () => dir, getVersion: () => '0.3.3' };
  try {
    const marker = updateMarker(app);
    marker.write('0.3.3'); assert.equal(marker.consume(), true); assert.equal(marker.consume(), false);
    marker.write('0.3.4'); assert.equal(marker.consume(), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

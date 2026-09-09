import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayback } from '../src/playback.mjs';
import { allowPermission } from '../electron/permissions.cjs';

test('tela cheia permitida apenas na janela local; captura ainda exige selecao', () => {
  const contents = { mainFrame: { url: 'app://desktop/index.html' } };
  const args = { contents, window: { webContents: contents }, trusted: frame => frame.url === 'app://desktop/index.html' };
  assert.equal(allowPermission({ ...args, permission: 'fullscreen' }), true);
  assert.equal(allowPermission({ ...args, permission: 'media' }), false);
  assert.equal(allowPermission({ ...args, permission: 'media', selectedSource: 'screen:1', selectionExpires: Date.now() + 1000 }), true);
  assert.equal(allowPermission({ ...args, permission: 'fullscreen', contents: { mainFrame: contents.mainFrame } }), false);
  contents.mainFrame.url = 'https://example.com';
  assert.equal(allowPermission({ ...args, permission: 'fullscreen' }), false);
});

test('aguarda midia e nao recarrega o mesmo stream quando chega outra faixa', async t => {
  let assignments = 0, source = null;
  const player = { get srcObject() { return source; }, set srcObject(value) { assignments++; source = value; }, play: t.mock.fn(async () => {}) };
  const playback = createPlayback(player, { prompt() {}, report: assert.fail });
  const track = { readyState: 'live', muted: true };
  const stream = { getTracks: () => [track] };
  await playback.setStream(stream);
  assert.equal(player.play.mock.callCount(), 0);
  track.muted = false;
  await playback.setStream(stream);
  assert.equal(player.play.mock.callCount(), 1);
  assert.equal(assignments, 1);
});

test('interrupcao por troca de stream nao mostra erro de reproducao', async () => {
  const prompts = [];
  const player = { srcObject: null, play: async () => { throw Object.assign(new Error('interrupted'), { name: 'AbortError' }); } };
  const playback = createPlayback(player, { prompt: value => prompts.push(value), report: assert.fail });
  await playback.setStream({ getTracks: () => [{ readyState: 'live', muted: false }] });
  assert.equal(prompts.includes(true), false);
});

test('autoplay bloqueado oferece clique e permite nova tentativa', async () => {
  let blocked = true, visible;
  const player = { srcObject: null, play: async () => { if (blocked) throw Object.assign(new Error('gesture'), { name: 'NotAllowedError' }); } };
  const playback = createPlayback(player, { prompt: value => { visible = value; }, report: assert.fail });
  await playback.setStream({ getTracks: () => [{ readyState: 'live', muted: false }] });
  assert.equal(visible, true);
  blocked = false;
  await playback.play();
  assert.equal(visible, false);
});

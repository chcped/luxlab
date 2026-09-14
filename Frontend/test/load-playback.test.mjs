import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayback } from '../src/playback.mjs';

const stream = () => ({ getTracks: () => [{ readyState: 'live', muted: false }] });
test('load playback ignores an interrupted play and does not reload an unchanged stream', async () => {
  let assignments = 0, value;
  const errors = [], prompts = [];
  const player = {
    get srcObject() { return value; }, set srcObject(v) { value = v; assignments++; },
    play: async () => { throw Object.assign(new Error('play interrupted'), { name: 'AbortError' }); }
  };
  const playback = createPlayback(player, { prompt: v => prompts.push(v), report: e => errors.push(e) });
  const video = stream();
  await playback.setStream(video); await playback.setStream(video);
  assert.equal(assignments, 1); assert.deepEqual(errors, []); assert.ok(!prompts.includes(true));
});
test('load playback still reports genuine decoder errors', async () => {
  const errors = [];
  const player = { srcObject: null, play: async () => { throw Object.assign(new Error('decoder failed'), { name: 'NotSupportedError' }); } };
  await createPlayback(player, { prompt() {}, report: e => errors.push(e) }).setStream(stream());
  assert.equal(errors[0].name, 'NotSupportedError');
});

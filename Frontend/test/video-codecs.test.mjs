import test from 'node:test';
import assert from 'node:assert/strict';
import { preferHardwareAcceleration } from '../src/video-codecs.mjs';

const vp8 = { mimeType: 'video/VP8' };
const high = { mimeType: 'video/H264', sdpFmtpLine: 'profile-level-id=640c1f' };
const baseline = { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=42e01f' };
const rtx = { mimeType: 'video/rtx' };

test('hardware prefers constrained baseline and keeps VP8/rtx as fallback', () => {
  assert.deepEqual(preferHardwareAcceleration([vp8, high, baseline, rtx], true), [baseline, vp8, rtx]);
});

test('software prefers VP8 and keeps H.264 as fallback', () => {
  assert.deepEqual(preferHardwareAcceleration([high, baseline, vp8, rtx], false), [vp8, high, baseline, rtx]);
});

test('keeps original capabilities when the preferred codec is unavailable', () => {
  const codecs = [vp8];
  assert.equal(preferHardwareAcceleration(codecs, true), codecs);
  assert.deepEqual(preferHardwareAcceleration([high, rtx], false), [high, rtx]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnostic } from '../src/logger.js';
test('client diagnostics reject payloads, credentials and invalid numbers', () => {
  assert.deepEqual(diagnostic({ event: 'media', bitrateKbps: 123, rttMs: Infinity, token: 'secret', sdp: 'secret', credential: 'secret', framesDecoded: {}, direction: ['invalid'] }), { bitrateKbps: 123, event: 'media' });
});

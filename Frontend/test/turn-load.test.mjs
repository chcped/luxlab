import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { options } = createRequire(import.meta.url)('../scripts/turn-load-options.cjs');
test('load test is a dry run unless explicitly requested', () => {
  assert.equal(options([]).run, false);
  const value = options(['--run', '--pairs=4', '--duration=120', '--mbps=5', '--transport=tcp']);
  assert.equal(value.run, true); assert.equal(value.pairs, 4); assert.equal(value.transport, 'tcp');
});
test('load test rejects unbounded, malformed and unknown parameters', () => {
  for (const arg of ['--pairs=0', '--pairs=1000', '--pairs=1.5', '--duration=Infinity', '--mbps=NaN', '--fps=500', '--transport=all', '--unknown=1', '--run=false']) assert.throws(() => options([arg]), undefined, arg);
});
test('load target cannot embed secrets or use arbitrary cleartext origins', () => {
  for (const server of ['https://user:password@example.com', 'https://example.com/path', 'https://example.com?token=secret', 'http://example.com']) assert.throws(() => options([`--server=${server}`]));
  assert.equal(options(['--server=http://127.0.0.1:8080']).server, 'http://127.0.0.1:8080');
});

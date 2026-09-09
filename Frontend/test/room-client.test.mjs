import test from 'node:test';
import assert from 'node:assert/strict';
import { serverURL, invitation } from '../src/room-client.mjs';

test('convite mantém a origem do servidor e preserva código sensível a maiúsculas', () => {
  assert.equal(invitation('https://tela.example/room/AbC_def-1234', 'https://tela.example'), 'AbC_def-1234');
  assert.equal(invitation('AbC_def-1234', 'https://tela.example'), 'AbC_def-1234');
  assert.throws(() => invitation('https://evil.example/room/AbC_def-1234', 'https://tela.example'));
  assert.throws(() => invitation('../rooms', 'https://tela.example'));
});
test('servidor permite HTTP somente para desenvolvimento local', () => {
  assert.equal(serverURL('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.throws(() => serverURL('http://public.example'));
  assert.throws(() => serverURL('https://user:password@tela.example'));
  assert.throws(() => serverURL('https://tela.example/api'));
});

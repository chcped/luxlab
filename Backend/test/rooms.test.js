import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry } from '../src/rooms.js';

const peer = (id, role) => ({ roomId: 'room', peerId: id, role, ws: {} });
test('aceita um publisher e viewers', () => {
  const rooms = new RoomRegistry(2);
  rooms.join(peer('p', 'publisher'));
  rooms.join(peer('v1', 'viewer'));
  assert.deepEqual(rooms.stats(), { rooms: 1, peers: 2 });
});
test('impede dois publishers', () => {
  const rooms = new RoomRegistry(2);
  rooms.join(peer('p1', 'publisher'));
  assert.throws(() => rooms.join(peer('p2', 'publisher')));
});
test('apaga sala vazia', () => {
  const rooms = new RoomRegistry(2);
  const p = peer('p', 'publisher'); rooms.join(p); rooms.leave(p);
  assert.equal(rooms.stats().rooms, 0);
});

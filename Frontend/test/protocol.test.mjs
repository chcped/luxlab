import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRoomKey, encryptSignal, decryptSignal } from '../src/encryption.mjs';
import { decryptSignal as backendDecrypt, encryptSignal as backendEncrypt } from '../../Backend/client/encryption.js';
import { Publisher, validateSettings } from '../src/publisher.mjs';

test('SDP e ICE são compatíveis com a criptografia do backend em ambas as direções', async () => {
  const key = generateRoomKey();
  for (const value of [{ type: 'offer', sdp: 'v=0\r\n' }, { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 }]) {
    assert.deepEqual(await backendDecrypt(key, await encryptSignal(key, value)), value);
    assert.deepEqual(await decryptSignal(key, await backendEncrypt(key, value)), value);
  }
});
test('uma chave diferente não consegue abrir a sinalização', async () => {
  const encrypted = await encryptSignal(generateRoomKey(), { type: 'answer' });
  await assert.rejects(decryptSignal(generateRoomKey(), encrypted));
});
test('servidores remotos exigem TLS; localhost e TURN são aceitos', () => {
  const settings = { server: 'ws://localhost:8080/ws', token: 'token', roomKey: generateRoomKey(), ice: '[]' };
  assert.equal(validateSettings(settings).server, settings.server);
  assert.throws(() => validateSettings({ ...settings, server: 'ws://example.com/ws' }));
  assert.throws(() => validateSettings({ ...settings, roomKey: 'invalid' }));
  assert.throws(() => validateSettings({ ...settings, ice: '[null]' }));
  const ice = JSON.stringify([{ urls: ['turn:example.com:3478'], username: 'user', credential: 'secret' }]);
  assert.equal(validateSettings({ ...settings, server: 'wss://example.com/ws', ice }).iceServers.length, 1);
});

test('publisher autentica, envia offer cifrada e fecha os peers ao encerrar', async t => {
  const sent = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    send(value) { sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; }
  }
  class Peer {
    connectionState = 'new';
    addTrack() {}
    async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
    async setLocalDescription(value) { this.localDescription = { toJSON: () => value }; }
    close() { this.connectionState = 'closed'; }
  }
  const previousSocket = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  t.after(() => { globalThis.WebSocket = previousSocket; });
  const previous = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = Peer;
  t.after(() => { if (previous) globalThis.RTCPeerConnection = previous; else delete globalThis.RTCPeerConnection; });
  const roomKey = generateRoomKey();
  const publisher = new Publisher({ server: 'ws://localhost:8080/ws', token: 'jwt', roomKey, iceServers: [] }, { getTracks: () => [] });
  t.after(() => publisher.close());
  const connected = publisher.connect();
  publisher.ws.onopen();
  assert.deepEqual(sent[0], { type: 'join', token: 'jwt' });
  publisher.ws.onmessage({ data: JSON.stringify({ type: 'joined', self: { role: 'publisher' }, peers: [] }) });
  await connected;
  await publisher.addPeer({ peerId: 'viewer-1', role: 'viewer' });
  assert.equal(sent[1].to, 'viewer-1');
  assert.deepEqual(await backendDecrypt(roomKey, sent[1].payload), { type: 'offer', sdp: 'v=0' });
  const peer = publisher.peers.get('viewer-1').pc;
  publisher.close();
  assert.equal(peer.connectionState, 'closed');
  assert.equal(publisher.ws.readyState, 3);
  assert.equal(publisher.peers.size, 0);
});

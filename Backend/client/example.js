import { encryptSignal, decryptSignal } from './encryption.js';

export function connectSignaling({ wsUrl, token, roomKey, onPeer, onSignal, onLeave }) {
  const ws = new WebSocket(wsUrl);
  ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'join', token })));
  ws.addEventListener('message', async event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'joined') msg.peers.forEach(onPeer);
    if (msg.type === 'peer-joined') onPeer(msg.peer);
    if (msg.type === 'peer-left') onLeave?.(msg.peerId);
    if (msg.type === 'signal') onSignal(msg.from, await decryptSignal(roomKey, msg.payload));
  });
  return {
    ws,
    async signal(to, rtcDescriptionOrCandidate) {
      ws.send(JSON.stringify({ type: 'signal', to, payload: await encryptSignal(roomKey, rtcDescriptionOrCandidate) }));
    }
  };
}

export const rtcConfiguration = {
  iceServers: [
    { urls: 'stun:SEU_DOMINIO_TURN:3478' },
    { urls: ['turn:SEU_DOMINIO_TURN:3478?transport=udp', 'turns:SEU_DOMINIO_TURN:5349?transport=tcp'], username: 'USUARIO_TEMPORARIO', credential: 'SENHA_TEMPORARIA' }
  ],
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle'
};

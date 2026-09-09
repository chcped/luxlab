import { encryptSignal, decryptSignal } from './encryption.mjs';

export function validateSettings({ server, token, roomKey, ice }) {
  const url = new URL(server);
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Use wss:// para servidores remotos ou ws://localhost para desenvolvimento.');
  }
  if (url.username || url.password || url.hash) throw new Error('A URL do servidor não deve conter credenciais ou fragmento.');
  if (!token.trim()) throw new Error('Informe o token do transmissor.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(roomKey)) throw new Error('A chave deve conter 32 bytes em base64url (43 caracteres).');
  const iceServers = JSON.parse(ice);
  if (!Array.isArray(iceServers) || iceServers.some(item => {
    if (!item || typeof item !== 'object') return true;
    const urls = Array.isArray(item.urls) ? item.urls : [item.urls];
    return !urls.length || urls.some(value => typeof value !== 'string' || !/^(stun|stuns|turn|turns):\S+$/.test(value));
  })) throw new Error('Informe uma lista JSON válida de servidores STUN/TURN.');
  return { server: url.href, token: token.trim(), roomKey, iceServers };
}

export class Publisher {
  constructor(settings, stream, callbacks = {}) {
    this.settings = settings;
    this.stream = stream;
    this.callbacks = callbacks;
    this.peers = new Map();
    this.closed = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.rejectConnect = reject;
      const ws = this.ws = new WebSocket(this.settings.server);
      const timeout = this.timeout = setTimeout(() => this.fail('Tempo esgotado ao conectar ao servidor.'), 12000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', token: this.settings.token }));
      let queue = Promise.resolve();
      ws.onmessage = event => {
        queue = queue.then(async () => {
          if (this.closed) return;
          const message = JSON.parse(event.data);
          if (message.type === 'joined') {
            if (message.self.role !== 'publisher') throw new Error('Use um token de publisher, não de viewer.');
            clearTimeout(timeout);
            this.rejectConnect = null;
            resolve();
            for (const peer of message.peers) await this.addPeer(peer);
          } else if (message.type === 'peer-joined') await this.addPeer(message.peer);
          else if (message.type === 'peer-left') this.removePeer(message.peerId);
          else if (message.type === 'signal') {
            const peer = this.peers.get(message.from);
            if (!peer) return;
            try {
              const signal = await decryptSignal(this.settings.roomKey, message.payload);
              if (this.closed || this.peers.get(message.from) !== peer) return;
              if (signal.type === 'answer') {
                await peer.pc.setRemoteDescription(signal);
                for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
              } else if (signal.candidate) {
                if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal);
                else if (peer.candidates.length < 256) peer.candidates.push(signal);
              }
            } catch {
              this.removePeer(message.from);
              this.callbacks.warning?.('Falha na negociação com um espectador. Verifique a chave da sala e a configuração de rede.');
            }
          } else if (message.type === 'error') {
            this.callbacks.warning?.(`O servidor recusou uma mensagem (${message.code}).`);
          }
        }).catch(() => this.fail('Falha ao negociar a sessão. Confira o token e a configuração de rede.'));
      };
      ws.onerror = () => this.fail('Não foi possível conectar. Confira o endereço e ALLOWED_ORIGINS no backend.');
      ws.onclose = event => {
        if (!this.closed) this.fail(`Conexão encerrada pelo servidor (código ${event.code}). Confira o token e reconecte.`);
      };
    });
  }
  async send(to, value) {
    const payload = await encryptSignal(this.settings.roomKey, value);
    if (!this.closed && this.ws.readyState === WebSocket.OPEN && this.peers.has(to)) {
      this.ws.send(JSON.stringify({ type: 'signal', to, payload }));
    }
  }
  async addPeer({ peerId, role }) {
    if (this.closed || role !== 'viewer' || this.peers.has(peerId)) return;
    const pc = new RTCPeerConnection({ iceServers: this.settings.iceServers, bundlePolicy: 'max-bundle' });
    this.peers.set(peerId, { pc, candidates: [] });
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = event => {
      if (event.candidate) this.send(peerId, event.candidate.toJSON()).catch(() => this.fail('Falha ao enviar candidatos de rede.'));
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.removePeer(peerId);
        this.callbacks.warning?.('Um espectador não conseguiu conectar. Verifique STUN/TURN e peça que ele reconecte.');
      }
      this.count();
    };
    await pc.setLocalDescription(await pc.createOffer());
    await this.send(peerId, pc.localDescription.toJSON());
  }
  count() {
    this.callbacks.count?.([...this.peers.values()].filter(peer => peer.pc.connectionState === 'connected').length);
  }
  removePeer(id) {
    const peer = this.peers.get(id);
    this.peers.delete(id);
    if (peer) { peer.pc.onconnectionstatechange = null; peer.pc.onicecandidate = null; peer.pc.close(); }
    this.count();
  }
  fail(message) {
    if (this.closed) return;
    this.close();
    this.callbacks.error?.(message);
  }
  close() {
    this.closed = true;
    clearTimeout(this.timeout);
    this.rejectConnect?.(new Error('A conexão não foi concluída.'));
    this.rejectConnect = null;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.ws?.close();
  }
}

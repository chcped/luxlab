// One connection per participant. Stable transceivers allow starting/stopping
// screen sharing without recreating connections or requesting microphone input.
export class RoomClient {
  constructor(base, session, callbacks = {}) {
    this.base = base; this.session = session; this.callbacks = callbacks;
    this.peers = new Map(); this.stream = null; this.closed = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.reject = reject;
      const url = new URL('/ws', this.base); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = this.ws = new WebSocket(url);
      this.timeout = setTimeout(() => this.fail('O servidor não respondeu. Verifique o endereço e tente novamente.'), 12000);
      ws.onopen = () => this.send({ type: 'join', token: this.session.token });
      let queue = Promise.resolve();
      ws.onmessage = event => {
        queue = queue.then(async () => {
          if (this.closed) return;
          const msg = JSON.parse(event.data);
          if (msg.type === 'joined') {
            this.self = msg.self; clearTimeout(this.timeout); this.reject = null;
            this.callbacks.joined?.(msg); resolve();
          } else if (msg.type === 'members') {
            for (const id of this.peers.keys()) if (!msg.members.some(m => m.id === id)) this.remove(id);
            for (const member of msg.members) if (member.id !== this.self && !this.peers.has(member.id)) await this.add(member.id);
            this.callbacks.members?.(msg);
          } else if (msg.type === 'signal') {
            await this.signal(msg.from, msg.payload);
          } else if (msg.type === 'chat') this.callbacks.chat?.(msg.message);
        }).catch(error => this.callbacks.warning?.(error.message || 'Falha ao conectar uma transmissão.'));
      };
      ws.onerror = () => this.fail('Não foi possível conectar ao servidor. Confira o endereço e as origens permitidas.');
      ws.onclose = event => { if (!this.closed) this.fail(event.reason || 'Conexão encerrada. Entre novamente na sala.'); };
    });
  }
  send(message) { if (!this.closed && this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message)); }
  async add(id) {
    const pc = new RTCPeerConnection({ iceServers: this.session.iceServers, bundlePolicy: 'max-bundle' });
    const peer = { pc, polite: this.self > id, makingOffer: false, ignoreOffer: false, settingAnswer: false,
      stream: new MediaStream(), candidates: [], senders: {}, initiator: this.self < id };
    this.peers.set(id, peer);
    pc.ontrack = ({ track }) => { peer.stream.addTrack(track); this.callbacks.stream?.(id, peer.stream); };
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.send({ type: 'signal', to: id, payload: { candidate: candidate.toJSON() } }); };
    pc.onconnectionstatechange = () => {
      this.callbacks.connection?.(id, pc.connectionState);
      if (pc.connectionState === 'failed') this.callbacks.warning?.('Uma transmissão não conectou. Confira a configuração STUN/TURN do servidor.');
    };
    pc.onnegotiationneeded = async () => {
      if (!peer.initiator || pc.signalingState !== 'stable') return;
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ type: 'signal', to: id, payload: { description: pc.localDescription.toJSON() } });
      } catch { if (!this.closed && pc.signalingState !== 'closed') this.callbacks.warning?.('Falha na negociação da transmissão.'); }
      finally { peer.makingOffer = false; }
    };
    for (const kind of peer.initiator ? ['video', 'audio'] : []) {
      const track = this.stream?.getTracks().find(t => t.kind === kind);
      const transceiver = pc.addTransceiver(track || kind, { direction: 'sendrecv', ...(track ? { streams: [this.stream] } : {}) });
      peer.senders[kind] = transceiver.sender;
    }
  }
  async signal(id, { description, candidate }) {
    const peer = this.peers.get(id); if (!peer) return;
    const { pc } = peer;
    if (description) {
      const collision = description.type === 'offer' && (peer.makingOffer || (pc.signalingState !== 'stable' && !peer.settingAnswer));
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      peer.settingAnswer = description.type === 'answer';
      try { await pc.setRemoteDescription(description); } finally { peer.settingAnswer = false; }
      if (description.type === 'offer') {
        for (const transceiver of pc.getTransceivers()) {
          const kind = transceiver.receiver.track.kind;
          transceiver.direction = 'sendrecv';
          peer.senders[kind] = transceiver.sender;
          await transceiver.sender.replaceTrack(this.stream?.getTracks().find(t => t.kind === kind) || null);
        }
      }
      for (const ice of peer.candidates.splice(0)) await pc.addIceCandidate(ice);
      if (description.type === 'offer') {
        await pc.setLocalDescription();
        this.send({ type: 'signal', to: id, payload: { description: pc.localDescription.toJSON() } });
      }
    } else if (candidate && !peer.ignoreOffer) {
      if (pc.remoteDescription) await pc.addIceCandidate(candidate);
      else if (peer.candidates.length < 256) peer.candidates.push(candidate);
    }
  }
  async setStream(stream) {
    this.stream = stream;
    await Promise.all([...this.peers.values()].flatMap(peer => ['video', 'audio'].map(kind =>
      peer.senders[kind]?.replaceTrack(stream?.getTracks().find(t => t.kind === kind) || null))));
    this.send({ type: 'sharing', active: !!stream });
  }
  remove(id) {
    const peer = this.peers.get(id); this.peers.delete(id);
    if (peer) { peer.pc.onconnectionstatechange = null; peer.pc.onnegotiationneeded = null; peer.pc.onicecandidate = null; peer.pc.close(); }
    this.callbacks.removed?.(id);
  }
  fail(message) { if (this.closed) return; this.close(); this.callbacks.error?.(message); }
  close() {
    this.closed = true; clearTimeout(this.timeout);
    this.reject?.(new Error('Conexão não concluída.')); this.reject = null;
    for (const id of this.peers.keys()) this.remove(id);
    this.ws?.close();
  }
}

export function serverURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    throw new Error('Use HTTPS no servidor ou HTTP em localhost para desenvolvimento.');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Informe apenas a origem do servidor, por exemplo https://tela.seudominio.com.');
  return url.origin;
}

export function invitation(value, base) {
  let id = value.trim();
  if (/^https?:\/\//.test(id)) {
    const url = new URL(id);
    if (url.origin !== base) throw new Error('Este convite é de outro servidor. Altere o servidor nas configurações primeiro.');
    id = url.pathname.match(/^\/room\/([A-Za-z0-9_-]{12})\/?$/)?.[1] || '';
  }
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) throw new Error('Cole um link de convite válido ou o código de 12 caracteres.');
  return id;
}

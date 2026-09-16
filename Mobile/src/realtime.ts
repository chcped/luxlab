import { Dimensions, PixelRatio, Platform } from 'react-native';
import { mediaDevices, MediaStream, MediaStreamTrack, RTCPeerConnection, RTCRtpSender } from 'react-native-webrtc';
import { applyBaselinePreferences } from './videoCodecs';
import type { IceServer } from './api';
import { summarizeOutbound } from './streamStats';
import { captureScale, DEFAULT_SHARE_QUALITY, ShareQuality, videoBitrate } from './shareQuality';

function preferVideo(pc: RTCPeerConnection) {
  applyBaselinePreferences(pc, RTCRtpSender.getCapabilities('video')?.codecs);
}

type Signal = { description?: any; candidate?: any };
type Peer = {
  pc: RTCPeerConnection;
  stream: MediaStream;
  polite: boolean;
  initiator: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingAnswer: boolean;
  candidates: any[];
  senders: Record<string, ReturnType<RTCPeerConnection['addTrack']>>;
};

export class RoomMediaClient {
  private peers = new Map<string, Peer>();
  private self?: string;
  private localStream?: MediaStream;
  private closed = false;
  private quality: ShareQuality = DEFAULT_SHARE_QUALITY;
  private statsTimer?: ReturnType<typeof setTimeout>;
  private previousStats = new Map<string, Map<string, any>>();

  constructor(
    private iceServers: IceServer[],
    private iceTransportPolicy: 'all' | 'relay',
    private onStream: (memberId: string, stream?: MediaStream) => void,
    private send: (message: object) => void,
  ) {}

  start(self: string) {
    this.self = self;
    if (__DEV__ && Platform.OS !== 'android' && !this.statsTimer && !this.closed) this.scheduleStats();
  }

  private scheduleStats() {
    this.statsTimer = setTimeout(async () => {
      try {
        if (!this.closed && this.localStream) {
          if (!this.peers.size) console.info('[LuxlabStats] ' + JSON.stringify({ state: 'sem receptor' }));
          for (const [id, peer] of this.peers) {
            if (this.closed || !this.localStream) break;
            try {
              const reports = await peer.pc.getStats() as Map<string, any>;
              if (this.closed || this.peers.get(id) !== peer || !this.localStream) continue;
              const samples = summarizeOutbound(reports, this.previousStats.get(id));
              this.previousStats.set(id, reports);
              console.info('[LuxlabStats] ' + JSON.stringify({ peer: id.slice(0, 8), state: peer.pc.connectionState, video: samples }));
            } catch {
              if (!this.closed) console.info('[LuxlabStats] ' + JSON.stringify({ state: 'coleta indisponivel' }));
            }
          }
        }
      } finally {
        if (!this.closed) this.scheduleStats();
      }
    }, 2000);
  }

  async syncMembers(ids: string[]) {
    if (!this.self || this.closed) return;
    for (const id of this.peers.keys()) if (!ids.includes(id)) this.remove(id);
    for (const id of ids) if (id !== this.self && !this.peers.has(id)) await this.add(id);
  }

  async signal(id: string, { description, candidate }: Signal) {
    const peer = this.peers.get(id); if (!peer || this.closed) return;
    const { pc } = peer;
    if (description) {
      const collision = description.type === 'offer' && (peer.makingOffer || (pc.signalingState !== 'stable' && !peer.settingAnswer));
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      peer.settingAnswer = description.type === 'answer';
      try { await pc.setRemoteDescription(description); } finally { peer.settingAnswer = false; }
      if (description.type === 'offer') {
        for (const transceiver of pc.getTransceivers()) {
          const kind = transceiver.receiver.track?.kind;
          if (!kind) continue;
          transceiver.direction = 'sendrecv'; peer.senders[kind] = transceiver.sender;
          if (kind === 'video') preferVideo(pc);
          await transceiver.sender.replaceTrack(this.localStream?.getTracks().find(track => track.kind === kind) || null);
          if (kind === 'video' && this.localStream) await this.tuneVideoSender(transceiver.sender);
        }
      }
      if (description.type === 'answer' && this.localStream && peer.senders.video) await this.tuneVideoSender(peer.senders.video);
      for (const ice of peer.candidates.splice(0)) await pc.addIceCandidate(ice);
      if (description.type === 'offer') {
        preferVideo(pc);
        await pc.setLocalDescription();
        if (this.localStream && peer.senders.video) await this.tuneVideoSender(peer.senders.video);
        this.send({ type: 'signal', to: id, payload: { description: pc.localDescription?.toJSON() } });
      }
    } else if (candidate && !peer.ignoreOffer) {
      if (pc.remoteDescription) await pc.addIceCandidate(candidate);
      else if (peer.candidates.length < 256) peer.candidates.push(candidate);
    }
  }

  async captureScreen(quality: ShareQuality = DEFAULT_SHARE_QUALITY) {
    this.quality = { ...quality };
    const screen = Dimensions.get('screen');
    const scale = captureScale(Math.min(screen.width, screen.height) * PixelRatio.get(), quality.resolution);
    const stream = await mediaDevices.getDisplayMedia({ video: true, audio: true, android: { createConfigForDefaultDisplay: true, resolutionScale: scale } });
    if (this.closed) {
      stream.getTracks().forEach(track => track.stop());
      throw new Error('A sala foi encerrada durante a autorizacao.');
    }
    for (const track of stream.getTracks()) track.onended = () => { if (this.localStream === stream) this.stopPublishing().catch(() => undefined); };
    return stream;
  }

  async publish(stream: MediaStream) {
    this.localStream = stream;
    await Promise.all([...this.peers.values()].flatMap(peer => ['video', 'audio'].map(async kind => {
      const sender = peer.senders[kind];
      if (!sender) return;
      const transceiver = peer.pc.getTransceivers().find(item => item.sender === sender);
      if (transceiver) transceiver.direction = 'sendrecv';
      await sender.replaceTrack(stream.getTracks().find(track => track.kind === kind) || null);
      if (kind === 'video') await this.tuneVideoSender(sender);
    })));
  }

  async stopPublishing() {
    this.previousStats.clear();
    const stream = this.localStream; this.localStream = undefined;
    // Stop MediaProjection immediately. Network negotiation must never keep Android capture alive.
    stream?.getTracks().forEach(track => track.stop());
    await Promise.all([...this.peers.values()].flatMap(peer => Object.values(peer.senders).map(sender => sender.replaceTrack(null).catch(() => undefined))));
  }

  close() {
    this.closed = true;
    clearTimeout(this.statsTimer);
    this.previousStats.clear();
    const stream = this.localStream; this.localStream = undefined;
    stream?.getTracks().forEach(track => track.stop());
    for (const id of [...this.peers.keys()]) this.remove(id);
  }

  private async add(id: string) {
    if (!this.self || this.closed) return;
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: this.iceTransportPolicy, bundlePolicy: 'max-bundle' });
    const peer: Peer = { pc, stream: new MediaStream(), polite: this.self > id, initiator: this.self < id, makingOffer: false, ignoreOffer: false, settingAnswer: false, candidates: [], senders: {} };
    this.peers.set(id, peer);
    pc.ontrack = (event: { track: MediaStreamTrack }) => {
      if (!peer.stream.getTracks().some(track => track.id === event.track.id)) peer.stream.addTrack(event.track);
      event.track.onunmute = () => { if (!this.closed && this.peers.get(id) === peer) this.onStream(id, peer.stream); };
      this.onStream(id, peer.stream);
    };
    pc.onicecandidate = (event: { candidate?: { toJSON: () => unknown } }) => { if (event.candidate) this.send({ type: 'signal', to: id, payload: { candidate: event.candidate.toJSON() } }); };
    pc.onnegotiationneeded = async () => {
      if (!peer.initiator || pc.signalingState !== 'stable' || this.closed) return;
      try {
        peer.makingOffer = true;
        preferVideo(pc);
        await pc.setLocalDescription();
        this.send({ type: 'signal', to: id, payload: { description: pc.localDescription?.toJSON() } });
      } finally { peer.makingOffer = false; }
    };
    if (peer.initiator) for (const kind of ['video', 'audio'] as const) {
      const track = this.localStream?.getTracks().find(item => item.kind === kind);
      const transceiver = pc.addTransceiver(track || kind, { direction: track ? 'sendrecv' : 'recvonly', ...(track && this.localStream ? { streams: [this.localStream] } : {}) });
      peer.senders[kind] = transceiver.sender;
      if (kind === 'video') preferVideo(pc);
      if (kind === 'video' && track) await this.tuneVideoSender(transceiver.sender);
    }
  }

  private remove(id: string) {
    this.previousStats.delete(id);
    const peer = this.peers.get(id); this.peers.delete(id);
    if (!peer) return;
    peer.stream.getTracks().forEach(track => { track.onunmute = null; });
    peer.pc.ontrack = null; peer.pc.onicecandidate = null; peer.pc.onnegotiationneeded = null; peer.pc.close();
    this.onStream(id, undefined);
  }

  private async tuneVideoSender(sender: ReturnType<RTCPeerConnection['addTrack']>) {
    try {
      const parameters = sender.getParameters();
      parameters.degradationPreference = 'maintain-framerate';
      for (const encoding of parameters.encodings) {
        encoding.maxFramerate = this.quality.fps;
        encoding.maxBitrate = videoBitrate(this.quality);
      }
      await sender.setParameters(parameters);
    } catch {
      if (__DEV__) console.warn('[LuxlabQuality] Falha ao aplicar limites de envio.');
    }
  }
}

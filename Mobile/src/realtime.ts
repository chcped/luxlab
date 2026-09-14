import { mediaDevices, MediaStream, RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { LuxlabApi } from './api';

export type RemoteMedia = { sessionId: string; tracks: string[] };

export class CloudflareMediaClient {
  private pc?: RTCPeerConnection;
  private sessionId?: string;
  private published = new Set<string>();
  private subscribed = new Set<string>();
  constructor(private api: LuxlabApi, private token: string, private onStream: (stream: MediaStream) => void) {}
  async connect() {
    const session = await this.api.media('/sessions', 'POST', this.token);
    this.sessionId = session.sessionId;
    const pc = this.pc = new RTCPeerConnection({ iceServers: session.iceServers, bundlePolicy: 'max-bundle' });
    const remote = new MediaStream();
    pc.ontrack = (event: unknown) => {
      const track = (event as unknown as { track?: ReturnType<MediaStream['getTracks']>[number] }).track;
      if (track && !remote.getTracks().some(item => item.id === track.id)) remote.addTrack(track);
      this.onStream(remote);
    };
  }
  async captureScreen() { return mediaDevices.getDisplayMedia({ android: { createConfigForDefaultDisplay: true } }); }
  async publish(stream: MediaStream) {
    const pc = this.requireConnection();
    const transceivers = stream.getTracks().map(track => pc.addTransceiver(track, { direction: 'sendonly' }));
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const tracks = transceivers.map(({ mid, sender }) => ({ location: 'local', mid, trackName: sender.track!.id }));
    const result = await this.api.media(`/sessions/${this.sessionId}/tracks`, 'POST', this.token, { sessionDescription: { type: offer.type, sdp: offer.sdp }, tracks });
    await pc.setRemoteDescription(new RTCSessionDescription(result.sessionDescription));
    tracks.forEach(track => this.published.add(track.trackName)); return tracks.map(track => track.trackName);
  }
  async subscribe(media: RemoteMedia) {
    const pc = this.requireConnection();
    const wanted = media.tracks.filter(trackName => !this.subscribed.has(`${media.sessionId}:${trackName}`));
    if (!wanted.length) return;
    const result = await this.api.media(`/sessions/${this.sessionId}/tracks`, 'POST', this.token, { tracks: wanted.map(trackName => ({ location: 'remote', sessionId: media.sessionId, trackName })) });
    if (result.requiresImmediateRenegotiation && result.sessionDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(result.sessionDescription));
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      await this.api.media(`/sessions/${this.sessionId}/renegotiate`, 'PUT', this.token, { sessionDescription: { type: answer.type, sdp: answer.sdp } });
    }
    wanted.forEach(trackName => this.subscribed.add(`${media.sessionId}:${trackName}`));
  }
  async stopPublishing() {
    if (!this.sessionId || !this.published.size) return;
    const tracks = [...this.published].map(trackName => ({ location: 'local', trackName }));
    await this.api.media(`/sessions/${this.sessionId}/tracks/close`, 'PUT', this.token, { tracks });
    this.published.clear(); this.pc?.getSenders().forEach(sender => sender.track?.stop());
  }
  close() { this.pc?.close(); this.pc = undefined; }
  private requireConnection() { if (!this.pc || !this.sessionId) throw new Error('Sessao de midia ainda nao conectada.'); return this.pc; }
}

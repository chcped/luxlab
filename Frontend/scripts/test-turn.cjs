// Two Electron renderer windows, real signaling server, synthetic media only.
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const windows = [];
async function participant(roomId) {
  const { RoomClient } = await import('./room-client.mjs');
  const { createPlayback } = await import('./playback.mjs');
  const NativeRTC = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativeRTC {
    constructor(config) { super({ ...config, iceTransportPolicy: 'relay' }); }
  };
  const base = 'https://luxlab.net.br';
  const response = await fetch(base + '/api/v2/rooms' + (roomId ? `/${roomId}/join` : ''), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: { name: roomId ? 'Teste TURN receptor' : 'Teste TURN emissor' } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`API HTTP ${response.status}`);
  const session = await response.json();
  const errors = window.testErrors = [];
  const player = document.getElementById('player'); player.muted = true;
  const playback = createPlayback(player, { prompt() {}, report: e => errors.push(e.name) });
  const client = window.testClient = new RoomClient(base, session, {
    stream: (_id, stream) => playback.setStream(stream),
    warning: message => errors.push(message), error: message => errors.push(message),
  });
  await client.connect();
  const hasTurn = session.iceServers?.some(s => [].concat(s.urls).some(u => /^turns?:/.test(u)));
  if (!hasTurn) throw new Error('Backend nao forneceu servidor TURN.');
  if (!roomId) {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const ctx = canvas.getContext('2d'); let frame = 0;
    window.testTimer = setInterval(() => {
      ctx.fillStyle = frame++ % 2 ? '#ff0000' : '#00ff00'; ctx.fillRect(0, 0, 320, 180);
    }, 40);
    const stream = window.testStream = canvas.captureStream(25);
    const audio = window.testAudio = new AudioContext();
    const oscillator = audio.createOscillator(); const destination = audio.createMediaStreamDestination();
    oscillator.connect(destination); oscillator.start(); await audio.resume();
    stream.addTrack(destination.stream.getAudioTracks()[0]);
    await client.setStream(stream);
  }
  return { roomId: session.roomId, hasTurn };
}
async function statistics() {
  const peers = [];
  for (const { pc } of window.testClient.peers.values()) {
    const stats = await pc.getStats();
    const transport = [...stats.values()].find(s => s.type === 'transport' && s.selectedCandidatePairId);
    const pair = transport && stats.get(transport.selectedCandidatePairId);
    peers.push({ connection: pc.connectionState, ice: pc.iceConnectionState,
      local: pair && stats.get(pair.localCandidateId)?.candidateType,
      remote: pair && stats.get(pair.remoteCandidateId)?.candidateType,
      protocol: pair && stats.get(pair.localCandidateId)?.protocol,
      inbound: [...stats.values()].filter(s => s.type === 'inbound-rtp').map(s => ({
        kind: s.kind, bytes: s.bytesReceived, frames: s.framesDecoded, samples: s.totalSamplesReceived,
      })) });
  }
  return { peers, width: document.getElementById('player').videoWidth, errors: window.testErrors };
}
app.whenReady().then(async () => {
  let code = 1;
  const deadline = setTimeout(() => app.exit(1), 60000);
  try {
    protocol.handle('app', request => {
      const name = new URL(request.url).pathname;
      if (!['/index.html', '/styles.css', '/app.js', '/room-client.mjs', '/playback.mjs'].includes(name)) return new Response('', { status: 404 });
      return net.fetch(pathToFileURL(path.join(__dirname, '../src', name)).href);
    });
    for (let i = 0; i < 2; i++) {
      const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false } });
      windows.push(win); await win.loadURL('app://desktop/index.html');
    }
    const first = await windows[0].webContents.executeJavaScript(`(${participant.toString()})(null)`, true);
    await windows[1].webContents.executeJavaScript(`(${participant.toString()})(${JSON.stringify(first.roomId)})`, true);
    let results;
    for (let i = 0; i < 35; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      results = await Promise.all(windows.map(w => w.webContents.executeJavaScript(`(${statistics.toString()})()`)));
      const relay = results.every(r => r.peers.length && r.peers.every(p => p.local === 'relay' && p.remote === 'relay' && p.connection === 'connected'));
      const received = results[1].peers.some(p => p.inbound.some(s => s.kind === 'video' && s.frames > 0) && p.inbound.some(s => s.kind === 'audio' && s.bytes > 0));
      if (relay && received && results[1].width > 0) { code = 0; break; }
    }
    console.log(JSON.stringify({ passed: code === 0, sender: results[0], receiver: results[1] }, null, 2));
  } catch (error) { console.error('Teste TURN:', error.message); }
  finally {
    for (const win of windows) {
      await win.webContents.executeJavaScript('window.testClient?.close(); window.testStream?.getTracks().forEach(t => t.stop()); clearInterval(window.testTimer); window.testAudio?.close();').catch(() => {});
      win.destroy();
    }
    clearTimeout(deadline); app.exit(code);
  }
});

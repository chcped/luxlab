const { app, BrowserWindow, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { options } = require('./turn-load-options.cjs');
const config = options(process.argv.slice(2));
if (!config.run) { app.exit(0); } else {
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  app.setPath('userData', path.join(app.getPath('temp'), `luxlab-turn-load-${process.pid}`));
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  start();
}

async function participant(config, roomId) {
  const { RoomClient } = await import('./room-client.mjs');
  const { createPlayback } = await import('./playback.mjs');
  const NativeRTC = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativeRTC { constructor(settings) { super({ ...settings, iceTransportPolicy: 'relay' }); } };
  const response = await fetch(config.server + '/api/v2/rooms' + (roomId ? `/${roomId}/join` : ''), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { name: 'Teste carga TURN' } }), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Backend HTTP ${response.status}; confira ALLOW_GUESTS e limites de salas/requisições.`);
  const session = await response.json();
  session.iceServers = session.iceServers.flatMap(server => {
    const urls = [].concat(server.urls).filter(url => {
      if (!/^turns?:/.test(url)) return false;
      const transport = /[?&]transport=(udp|tcp)/.exec(url)?.[1] || (url.startsWith('turns:') ? 'tcp' : 'udp');
      return transport === config.transport;
    });
    return urls.length ? [{ ...server, urls }] : [];
  });
  if (!session.iceServers.length) throw new Error(`Backend não forneceu TURN ${config.transport}.`);
  const state = window.loadState = { errors: [], previous: {}, client: null };
  const report = error => { if (state.errors.length < 20) state.errors.push(String(error)); };
  const player = document.querySelector('video');
  const playback = createPlayback(player, { prompt: visible => { if (visible) report('Reprodução bloqueada no participante de teste.'); }, report: error => report(error.message) });
  const client = state.client = new RoomClient(config.server, session, {
    stream(_id, stream) { playback.setStream(stream); },
    warning: report, error: report
  });
  await client.connect();
  if (!roomId) {
    const canvas = document.createElement('canvas'); canvas.width = config.width; canvas.height = config.height;
    const ctx = canvas.getContext('2d');
    const texture = document.createElement('canvas'); texture.width = 320; texture.height = 180;
    const noise = texture.getContext('2d'), pixels = noise.createImageData(320, 180);
    let frame = 0;
    const draw = () => {
      for (let i = 0; i < pixels.data.length; i += 4) {
        const value = Math.random() * 256; pixels.data[i] = value; pixels.data[i + 1] = (value + frame) % 256; pixels.data[i + 2] = 255 - value; pixels.data[i + 3] = 255;
      }
      noise.putImageData(pixels, 0, 0); ctx.drawImage(texture, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff'; ctx.font = '40px sans-serif'; ctx.fillText(`TURN load ${frame++}`, 30, 60);
      state.generatedFrames = frame;
    };
    draw(); state.timer = setInterval(draw, 1000 / config.fps);
    const stream = state.stream = canvas.captureStream(config.fps);
    const audio = state.audio = new AudioContext(), oscillator = audio.createOscillator(), destination = audio.createMediaStreamDestination();
    oscillator.connect(destination); oscillator.start(); await audio.resume(); stream.addTrack(destination.stream.getAudioTracks()[0]);
    await client.setStream(stream);
    state.bitrateTimer = setInterval(async () => {
      for (const peer of client.peers.values()) {
        const sender = peer.senders.video;
        if (!sender?.track || peer.loadConfigured || peer.loadConfiguring) continue;
        peer.loadConfiguring = true;
        try {
          const parameters = sender.getParameters();
          if (!parameters.encodings?.length) continue;
          for (const encoding of parameters.encodings) { encoding.maxBitrate = config.mbps * 1000000; encoding.maxFramerate = config.fps; }
          parameters.degradationPreference = 'maintain-resolution';
          await sender.setParameters(parameters); peer.loadConfigured = true;
        } catch (error) { report(`Bitrate: ${error.message}`); }
        finally { peer.loadConfiguring = false; }
      }
    }, 1000);
  }
  return session.roomId;
}

async function statistics() {
  const state = window.loadState, peers = [];
  if (!state) return { peers, errors: ['Participante não inicializado'] };
  for (const [id, peer] of state.client.peers) {
    const stats = await peer.pc.getStats();
    const transport = [...stats.values()].find(s => s.type === 'transport' && s.selectedCandidatePairId);
    const pair = transport && stats.get(transport.selectedCandidatePairId);
    const local = pair && stats.get(pair.localCandidateId), remote = pair && stats.get(pair.remoteCandidateId);
    const streams = [];
    for (const s of stats.values()) if (['inbound-rtp', 'outbound-rtp'].includes(s.type) && !s.isRemote) {
      const key = `${id}:${s.id}`, previous = state.previous[key];
      const bytes = s.bytesReceived ?? s.bytesSent ?? 0;
      const seconds = previous ? (s.timestamp - previous.timestamp) / 1000 : 0;
      const received = s.packetsReceived ?? 0, lost = s.packetsLost ?? 0;
      const packetDelta = previous ? Math.max(0, received - previous.received) : 0;
      const lossDelta = previous ? Math.max(0, lost - previous.lost) : 0;
      streams.push({ direction: s.type, kind: s.kind, bytes, mbps: seconds > 0 ? Math.max(0, bytes - previous.bytes) * 8 / seconds / 1e6 : null,
        packetsLost: lost, lossPercent: packetDelta + lossDelta ? 100 * lossDelta / (packetDelta + lossDelta) : 0,
        frames: s.framesDecoded ?? s.framesEncoded ?? 0, fps: s.framesPerSecond ?? null,
        frameDelta: previous ? Math.max(0, (s.framesDecoded ?? s.framesEncoded ?? 0) - previous.frames) : null,
        width: s.frameWidth ?? null, height: s.frameHeight ?? null, jitterMs: s.jitter === undefined ? null : s.jitter * 1000,
        freezeCount: s.freezeCount ?? null, freezeSeconds: s.totalFreezesDuration ?? null,
        qualityLimitation: s.qualityLimitationReason ?? null });
      state.previous[key] = { timestamp: s.timestamp, bytes, received, lost, frames: s.framesDecoded ?? s.framesEncoded ?? 0 };
    }
    peers.push({ connection: peer.pc.connectionState, ice: peer.pc.iceConnectionState,
      local: local?.candidateType, remote: remote?.candidateType, relayProtocol: local?.relayProtocol ?? null,
      candidateProtocol: local?.protocol, rttMs: pair?.currentRoundTripTime === undefined ? null : pair.currentRoundTripTime * 1000,
      availableOutgoingMbps: pair?.availableOutgoingBitrate === undefined ? null : pair.availableOutgoingBitrate / 1e6,
      bitrateConfigured: !!peer.loadConfigured, streams });
  }
  const now = performance.now();
  const generatedFps = state.lastDrawSample && state.generatedFrames !== undefined ?
    (state.generatedFrames - state.lastDrawSample.frames) * 1000 / (now - state.lastDrawSample.time) : null;
  state.lastDrawSample = { time: now, frames: state.generatedFrames };
  return { peers, errors: [...state.errors], closed: state.client.closed, generatedFps };
}

function start() {
  const windows = [], samples = [];
  let stopping = false, timedOut = false;
  const output = path.join(__dirname, '../diagnostics', `turn-load-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const log = value => fs.appendFileSync(output + '.jsonl', JSON.stringify(value) + '\n');
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
  app.on('window-all-closed', () => {});
  app.whenReady().then(async () => {
    const deadline = setTimeout(() => {
      timedOut = true; stopping = true;
      fs.writeFileSync(output + '.json', JSON.stringify({ config, completed: false, connectivityPassed: false, error: 'Tempo limite global excedido; consulte o JSONL parcial.' }, null, 2));
      for (const { win } of windows) if (!win.isDestroyed()) win.destroy();
      app.exit(1);
    }, (config.duration + config.warmup + config.pairs * 40 + 60) * 1000);
    let error = null;
    try {
      protocol.handle('app', request => {
        const pathname = new URL(request.url).pathname;
        if (pathname === '/index.html') return new Response('<!doctype html><video autoplay muted playsinline></video>', { headers: { 'Content-Type': 'text/html' } });
        if (['/room-client.mjs', '/playback.mjs'].includes(pathname)) return net.fetch(pathToFileURL(path.join(__dirname, '../src', pathname.slice(1))).href);
        return new Response('', { status: 404 });
      });
      log({ type: 'config', config });
      for (let pair = 0; pair < config.pairs && !stopping; pair++) {
        let roomId = null;
        for (let side = 0; side < 2; side++) {
          const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false } });
          windows.push({ win, pair, role: side ? 'receiver' : 'sender' });
          await win.loadURL('app://desktop/index.html');
          roomId = await win.webContents.executeJavaScript(`(${participant.toString()})(${JSON.stringify(config)},${JSON.stringify(roomId)})`, true);
          // Stay below the existing 40 API requests/minute limit.
          await wait(1800);
        }
        console.log(`Par ${pair + 1}/${config.pairs} iniciado.`);
      }
      console.log(`Aquecimento: ${config.warmup}s; medição: ${config.duration}s.`);
      for (let i = 0; i < config.warmup && !stopping; i++) await wait(1000);
      const begin = Date.now();
      while (!stopping && Date.now() - begin < config.duration * 1000) {
        const results = await Promise.all(windows.map(async ({ win, pair, role }) => ({ pair, role, ...await win.webContents.executeJavaScript(`(${statistics.toString()})()`) })));
        const incoming = results.filter(r => r.role === 'receiver').flatMap(r => r.peers.flatMap(p => p.streams.filter(s => s.direction === 'inbound-rtp')));
        const receiveMbps = incoming.reduce((sum, s) => sum + (s.mbps || 0), 0);
        const unhealthy = results.filter(r => r.closed || r.errors.length || r.peers.length !== 1 || r.peers.some(p => p.connection !== 'connected' || p.local !== 'relay' || p.remote !== 'relay')).length;
        const stalled = incoming.filter(s => s.kind === 'video' && s.frameDelta === 0).length;
        const generator = app.getAppMetrics().map(m => ({ type: m.type, cpuPercent: m.cpu.percentCPUUsage, workingSetKB: m.memory.workingSetSize }));
        const sample = { type: 'sample', elapsedSeconds: (Date.now() - begin) / 1000, receiveMbps, unhealthy, stalled, generator, results };
        samples.push(sample); log(sample);
        console.log(`${sample.elapsedSeconds.toFixed(0)}s: recebido ${receiveMbps.toFixed(2)} Mbps | participantes com problemas ${unhealthy} | vídeos sem novos frames ${stalled}`);
        await wait(2000);
      }
    } catch (failure) { error = failure.message; console.error(error); }
    finally {
      clearTimeout(deadline);
      for (const { win } of windows) if (!win.isDestroyed()) {
        await Promise.race([win.webContents.executeJavaScript('window.loadState?.client.close(); clearInterval(window.loadState?.timer); clearInterval(window.loadState?.bitrateTimer); window.loadState?.stream?.getTracks().forEach(t=>t.stop()); window.loadState?.audio?.close();').catch(() => {}), wait(1000)]);
        win.destroy();
      }
      const measured = samples.slice(1); // First sample has no bitrate/frame deltas.
      const usable = measured.length && measured.every(s => s.results.length === config.pairs * 2 && s.unhealthy === 0 && s.stalled === 0 && s.results.filter(r => r.role === 'receiver').every(r => r.peers.some(p => p.streams.some(v => v.kind === 'video' && v.frames > 0) && p.streams.some(a => a.kind === 'audio' && a.bytes > 0))));
      const summary = { config, completed: !error && !stopping && !timedOut, connectivityPassed: !!usable && !error && !stopping,
        samples: measured.length, averageReceiveMbps: measured.length ? measured.reduce((sum, s) => sum + s.receiveMbps, 0) / measured.length : 0,
        peakReceiveMbps: Math.max(0, ...measured.map(s => s.receiveMbps)), degradedSamples: measured.filter(s => s.unhealthy || s.stalled).length,
        error, note: 'Não determina capacidade máxima sozinho. Avalie bitrate real, FPS, perdas, RTT, freezes e CPU do gerador/servidor nos relatórios.' };
      fs.writeFileSync(output + '.json', JSON.stringify(summary, null, 2));
      console.log(JSON.stringify(summary, null, 2)); console.log(`Relatórios: ${output}.json e .jsonl`);
      app.exit(summary.connectivityPassed ? 0 : 1);
    }
  });
}

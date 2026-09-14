// Run with Electron (ELECTRON_RUN_AS_NODE unset). Checks real contextBridge + Web Audio.
const { app, BrowserWindow, protocol, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', path.join(require('node:os').tmpdir(), `luxlab-renderer-audio-test-${process.pid}`));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, sending, stopped = false;
const capture = {
  getProcessList: () => [{ pid: 42, name: 'Test tone' }],
  startCapture(_pid, callback) {
    let frame = 0;
    sending = setInterval(() => {
      const buffer = new Float32Array(1920);
      for (let i = 0; i < buffer.length; i += 2) { buffer[i] = buffer[i + 1] = 0.2 * Math.sin(2 * Math.PI * 440 * frame++ / 48000); }
      callback({ buffer, channels: 2, sampleRate: 48000 });
    }, 20);
    return true;
  },
  stopCapture() { clearInterval(sending); stopped = true; }
};
app.whenReady().then(async () => {
  try {
    require('../electron/process-audio.cjs').setupProcessAudio({ ipcMain, app, getWindow: () => window, trusted: frame => frame?.url === 'app://desktop/index.html', loadCapture: () => capture });
    protocol.handle('app', request => new Response(request.url.endsWith('process-audio.mjs') ? fs.readFileSync(path.join(__dirname, '../src/process-audio.mjs')) : '<title>Audio test</title>', { headers: { 'Content-Type': request.url.endsWith('.mjs') ? 'text/javascript' : 'text/html' } }));
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    await window.loadURL('app://desktop/index.html');
    const result = await window.webContents.executeJavaScript(`(async () => {
      const { captureProcessAudio } = await import('./process-audio.mjs');
      await desktop.getAudioProcesses();
      const captured = await captureProcessAudio(desktop, 42);
      const monitor = new AudioContext({ sampleRate: 48000 });
      await monitor.resume();
      const analyser = monitor.createAnalyser();
      monitor.createMediaStreamSource(captured.stream).connect(analyser);
      await new Promise(resolve => setTimeout(resolve, 500));
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      await captured.stop(); await captured.stop();
      await monitor.close();
      return { rms, ended: captured.stream.getTracks().every(track => track.readyState === 'ended') };
    })()`);
    assert.ok(result.rms > 0.05, `PCM must reach the outgoing audio track: ${result.rms}`);
    assert.equal(result.ended, true);
    assert.equal(stopped, true);
    console.log('PASS real sandboxed preload, IPC PCM, outgoing MediaStream audio, and cleanup', result);
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
setTimeout(() => app.exit(1), 15000);

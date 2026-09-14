// Windows integration check. Plays two quiet tones in isolated test apps.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
if (process.argv.includes('--tone')) {
  const { app, BrowserWindow } = require('electron');
  const frequency = Number(process.argv.at(-1));
  app.setPath('userData', path.join(require('node:os').tmpdir(), `luxlab-audio-test-${process.pid}`));
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  let window;
  app.whenReady().then(async () => {
    window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    await window.loadURL('data:text/html,<title>Luxlab audio isolation test</title>');
    await window.webContents.executeJavaScript(`
      window.context = new AudioContext();
      const tone = context.createOscillator(), gain = context.createGain();
      tone.frequency.value = ${frequency}; gain.gain.value = 0.015;
      tone.connect(gain).connect(context.destination); tone.start(); context.resume();
    `);
    process.send({ ready: true });
  });
  process.on('message', () => app.quit());
  setTimeout(() => app.quit(), 20000);
} else {
  const children = [];
  const { audioCapture } = require('process-audio-capture');
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function tone(frequency) {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [__filename, '--tone', String(frequency)], { env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true });
    children.push(child);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Tone startup timeout')), 10000);
      child.once('message', () => { clearTimeout(timeout); resolve(); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Tone exited: ${code}`)); });
    });
    return child;
  }
  function power(samples, frequency) {
    let real = 0, imaginary = 0;
    for (let i = 0; i < samples.length; i++) {
      real += samples[i] * Math.cos(2 * Math.PI * frequency * i / 48000);
      imaginary += samples[i] * Math.sin(2 * Math.PI * frequency * i / 48000);
    }
    return (real * real + imaginary * imaginary) / samples.length ** 2;
  }
  (async () => {
    const first = await tone(440), second = await tone(880);
    await pause(500);
    for (const [child, wanted, excluded] of [[first, 440, 880], [second, 880, 440]]) {
      const samples = [];
      assert.equal(audioCapture.startCapture(child.pid, data => {
        assert.equal(data.channels, 2); assert.equal(data.sampleRate, 48000);
        for (let i = 0; i < data.buffer.length; i += 2) samples.push(data.buffer[i]);
      }), true);
      await pause(1600);
      audioCapture.stopCapture();
      assert.ok(samples.length > 24000, 'Must receive process audio');
      const wantedPower = power(samples, wanted), excludedPower = power(samples, excluded);
      assert.ok(wantedPower > 1e-8, 'Selected tone must be audible');
      assert.ok(wantedPower > excludedPower * 100, 'Other application must be excluded by at least 20 dB');
      console.log(`PASS selected ${wanted} Hz, excluded ${excluded} Hz: ${(10 * Math.log10(wantedPower / Math.max(excludedPower, 1e-20))).toFixed(1)} dB isolation`);
    }
  })().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    audioCapture.stopCapture();
    for (const child of children) if (child.connected) child.send('quit');
  });
}

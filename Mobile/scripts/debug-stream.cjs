/* eslint-env node */
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { existsSync } = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('npm run debug:stream -- [--serial DEVICE]\nRequer app debug atualizado, compartilhando tela. Ctrl+C encerra.');
  process.exit(0);
}
if (args.length && (args.length !== 2 || args[0] !== '--serial' || !args[1])) {
  console.error('Uso: npm run debug:stream -- [--serial DEVICE]');
  process.exit(1);
}
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
  (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
const candidate = sdk && path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const adb = candidate && existsSync(candidate) ? candidate : 'adb';
const device = args.length ? ['-s', args[1]] : [];
console.log('Aguardando metricas de ENVIO do Luxlab (nativo, inclusive em segundo plano) (a cada ~2s). Inicie uma transmissao no app debug atualizado.');
console.log('FPS baixo com tela parada pode ser normal. Perda = total reportado pelo receptor; RTT = ida e volta, nao atraso do video.');
console.log('"--" = metrica indisponivel ou primeira amostra. Ctrl+C para sair.\n');
const child = spawn(adb, [...device, 'logcat', '-T', '1', '-v', 'brief', 'LuxlabStats:I', 'ReactNativeJS:I', '*:S'], { stdio: ['ignore', 'pipe', 'inherit'] });
child.on('error', error => { console.error(`Falha ao iniciar adb: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { if (code) process.exitCode = code; });
const previous = new Map();
const value = (number, suffix = '') => number == null ? '--' : `${typeof number === 'number' ? Math.round(number * 10) / 10 : number}${suffix}`;
createInterface({ input: child.stdout }).on('line', line => {
  const marker = line.includes('[LuxlabSendStats] ') ? '[LuxlabSendStats] ' : '[LuxlabStats] ';
  const index = line.indexOf(marker);
  if (index < 0) return;
  try {
    const sample = JSON.parse(line.slice(index + marker.length));
    if (marker === '[LuxlabSendStats] ') {
      const key = `${sample.peer}:${sample.id}`;
      const old = previous.get(key);
      const seconds = old ? (sample.timestamp - old.timestamp) / 1000 : 0;
      const rate = field => old && seconds > 0 && typeof sample[field] === 'number' && typeof old[field] === 'number' && sample[field] >= old[field] ? (sample[field] - old[field]) / seconds : null;
      const bytes = rate('bytesSent');
      const frames = rate('framesEncoded');
      const packets = rate('packetsSent');
      const encodeTime = rate('totalEncodeTime');
      const sendDelay = rate('totalPacketSendDelay');
      sample.diagnostics = ` | codec ${value(sample.codec)} ${value(sample.fmtp)} | captura ${value(rate('sourceFrames'), ' FPS')} | encode ${value(frames > 0 && encodeTime !== null ? encodeTime / frames * 1000 : null, ' ms/quadro')} | fila ${value(packets > 0 && sendDelay !== null ? sendDelay / packets * 1000 : null, ' ms/pacote')} | rota ${value(sample.route)}/${value(sample.protocol)}/${value(sample.relayProtocol)} | encoder ${value(sample.encoderImplementation)}`;
      sample.video = [{ kbps: bytes === null ? null : bytes * 0.008, fps: rate('framesEncoded'), width: sample.frameWidth, height: sample.frameHeight, rttMs: typeof sample.roundTripTime === 'number' ? sample.roundTripTime * 1000 : null, lostTotal: sample.packetsLost, limitation: sample.qualityLimitationReason }];
      if (previous.size > 256) previous.clear();
      previous.set(key, sample);
    }
    const prefix = `${new Date().toLocaleTimeString()} | ${sample.peer || '--'} | ${sample.state}`;
    if ((!sample.video || !sample.video.length)) { console.log(`${prefix} | sem dados de video enviado`); return; }
    for (const video of sample.video) {
      console.log(`${prefix} | ${value(video.kbps, ' kbps')} | ${value(video.fps, ' FPS')} | ${value(video.width)}x${value(video.height)} | RTT ${value(video.rttMs, ' ms')} | perda total ${value(video.lostTotal)} | limite ${value(video.limitation)}${sample.diagnostics || ''}`);
    }
  } catch (error) { /* Ignore unrelated or truncated Logcat lines. */ }
});
process.on('SIGINT', () => { child.kill(); process.exit(0); });

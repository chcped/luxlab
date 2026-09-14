const { spawn } = require('node:child_process');
const { options } = require('./turn-load-options.cjs');
try {
  const config = options(process.argv.slice(2));
  console.log(JSON.stringify({ ...config, participants: config.pairs * 2, targetVideoMbps: config.pairs * config.mbps }, null, 2));
  if (config.help || !config.run) {
    console.log('Simulação: nenhuma conexão aberta. Acrescente --run para executar.');
    console.log('Opções: --server=https://luxlab.net.br --pairs=2 --duration=60 --warmup=20 --width=1280 --height=720 --fps=30 --mbps=3 --transport=udp');
    console.log('Cada par cria uma sala com emissor/receptor. Bitrate é um teto solicitado, não tráfego garantido.');
  } else {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [require('node:path').join(__dirname, 'test-turn-load.cjs'), ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
    child.on('error', error => { console.error(error.message); process.exitCode = 1; });
    child.on('exit', code => { process.exitCode = code ?? 1; });
    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }

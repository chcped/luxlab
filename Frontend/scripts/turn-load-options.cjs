function options(args) {
  const result = { server: 'https://luxlab.net.br', pairs: 2, duration: 60, warmup: 20, width: 1280, height: 720, fps: 30, mbps: 3, transport: 'udp', run: false };
  for (const arg of args) {
    if (arg === '--run') { result.run = true; continue; }
    if (arg === '--help') { result.help = true; continue; }
    const match = arg.match(/^--([a-z]+)=(.+)$/);
    if (!match || !Object.hasOwn(result, match[1]) || ['run'].includes(match[1])) throw new Error(`Argumento inválido: ${arg}`);
    const key = match[1]; result[key] = ['server', 'transport'].includes(key) ? match[2] : Number(match[2]);
  }
  const ranges = { pairs: [1, 32], duration: [10, 1800], warmup: [5, 120], width: [320, 3840], height: [180, 2160], fps: [5, 60], mbps: [0.1, 30] };
  for (const [key, [min, max]] of Object.entries(ranges)) if (!Number.isFinite(result[key]) || result[key] < min || result[key] > max || (key !== 'mbps' && !Number.isInteger(result[key]))) throw new Error(`${key}: use ${min} a ${max}${key === 'mbps' ? '' : ' (inteiro)'}.`);
  if (!['udp', 'tcp'].includes(result.transport)) throw new Error('transport: use udp ou tcp.');
  const url = new URL(result.server);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('server deve ser uma origem HTTPS ou HTTP local.');
  result.server = url.origin;
  return result;
}
module.exports = { options };

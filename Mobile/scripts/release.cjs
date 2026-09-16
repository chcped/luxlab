const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
process.chdir(root);
const args = process.argv.slice(2);
const draft = args.includes('--draft');
const dryRun = args.includes('--dry-run');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const owner = process.env.GITHUB_OWNER || 'chcped';
const repo = process.env.GITHUB_REPO || 'luxlab';
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const tag = `v${pkg.version}-mobile`;
const apkName = `P2P-Mobile-${pkg.version}-arm64.apk`;
const apkPath = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');

function run(command, argv) {
  const result = spawnSync(command, argv, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} falhou (codigo ${result.status}).`);
}

async function api(endpoint, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${endpoint || 'repositorio'}`);
  return response.json();
}

async function main() {
  if (args.some(arg => !['--draft', '--dry-run'].includes(arg))) throw new Error('Use npm run release -- [--draft] [--dry-run].');
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('A versao Mobile precisa estar em X.Y.Z.');
  if (dryRun) { console.log(`${owner}/${repo}: ${tag} -> ${apkName}`); return; }
  if (process.platform !== 'win32') throw new Error('Execute este script no Windows.');
  if (!token) throw new Error('Defina GH_TOKEN ou GITHUB_TOKEN com permissao Contents: Read and write.');
  for (const name of ['RELEASE_STORE_FILE', 'RELEASE_STORE_PASSWORD', 'RELEASE_KEY_ALIAS', 'RELEASE_KEY_PASSWORD']) {
    if (!process.env[name]) throw new Error(`Defina ${name}; a release nao pode usar debug.keystore.`);
  }
  await api('');
  const releases = await api('/releases?per_page=100');
  if (releases.some(release => release.tag_name === tag)) throw new Error(`${tag} ja existe no GitHub.`);
  run(process.env.ComSpec, ['/d', '/c', 'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'build-release.ps1')]);
  if (!fs.existsSync(apkPath)) throw new Error(`APK nao encontrado: ${apkPath}`);
  const data = fs.readFileSync(apkPath);
  const release = await api('/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, name: tag, draft, prerelease: false, body: `Luxlab Mobile ${pkg.version}\n\nAPK ARM64 assinado.` }) });
  try {
    const url = `${release.upload_url.split('{')[0]}?name=${encodeURIComponent(apkName)}`;
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.android.package-archive' }, body: data, signal: AbortSignal.timeout(15 * 60 * 1000) });
    if (!response.ok) throw new Error(`Upload falhou (HTTP ${response.status}).`);
    const assets = await api(`/releases/${release.id}/assets`);
    const asset = assets.find(item => item.name === apkName && item.state === 'uploaded' && item.size === data.length);
    if (!asset) throw new Error('O GitHub nao confirmou o asset enviado.');
    console.log(`Concluido: ${release.html_url}`);
  } catch (error) {
    console.error(`Rascunho preservado: ${release.html_url}`);
    throw error;
  }
}

main().catch(error => { console.error(`Release Mobile interrompida: ${error.message}`); process.exitCode = 1; });

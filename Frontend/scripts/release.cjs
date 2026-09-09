const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
process.chdir(root);
const args = process.argv.slice(2);
const flags = new Set(args.filter(arg => arg.startsWith('--')));
const versions = args.filter(arg => !arg.startsWith('--'));
const mode = versions[0] || 'patch';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const { owner, repo } = pkg.build.publish;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;

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
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${endpoint || 'acesso ao repositorio'}`);
  return response.json();
}

async function main() {
  if (flags.has('--help')) {
    console.log('npm run release -- [patch|minor|major|current] [--draft] [--dry-run]\nPadrao: patch. Requer Windows e GH_TOKEN com Contents: Read and write.');
    return;
  }
  if (versions.length > 1 || !['patch', 'minor', 'major', 'current'].includes(mode) ||
      [...flags].some(flag => !['--draft', '--dry-run'].includes(flag))) {
    throw new Error('Argumentos invalidos. Use npm run release -- --help.');
  }
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('A versao atual precisa ser estavel (X.Y.Z).');
  const parts = pkg.version.split('.').map(Number);
  if (mode !== 'current') {
    const index = { major: 0, minor: 1, patch: 2 }[mode];
    parts[index]++;
    for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
  }
  const version = parts.join('.');
  const tag = `v${version}`;
  console.log(`${owner}/${repo}: ${pkg.version} -> ${version} (${flags.has('--draft') ? 'rascunho' : 'release publica'})`);
  if (flags.has('--dry-run')) {
    console.log('Simulacao: validar acesso, testar, atualizar package.json/lock, gerar e enviar os 3 artefatos em rascunho, verificar e publicar. Nenhum arquivo alterado.');
    return;
  }
  if (process.platform !== 'win32') throw new Error('Execute este script no Windows.');
  if (!token) throw new Error('Defina GH_TOKEN (ou GITHUB_TOKEN) no ambiente com permissao Contents: Read and write.');
  process.env.GH_TOKEN = token;
  const repository = await api('');
  if (repository.permissions && !repository.permissions.push) throw new Error('Token sem permissao de escrita no repositorio.');
  // Include drafts and paginate, so an existing release is never overwritten.
  let existing;
  for (let page = 1; ; page++) {
    const releases = await api(`/releases?per_page=100&page=${page}`);
    existing = releases.find(release => release.tag_name === tag);
    if (existing || releases.length < 100) break;
  }
  if (existing) throw new Error(`${tag} ja existe (inclusive rascunhos). Revise essa release no GitHub antes de tentar novamente.`);
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Execute usando npm run release.');
  run(process.execPath, [npm, 'test']);
  if (mode !== 'current') run(process.execPath, [npm, 'version', version, '--no-git-tag-version', '--ignore-scripts']);
  const builder = require.resolve('electron-builder/cli.js');
  // Build without publishing; upload only after a successful build.
  run(process.execPath, [builder, '--win', 'nsis', '--x64', '--publish', 'never']);
  const output = path.resolve(root, pkg.build.directories.output);
  const names = [`P2P-Desktop-Setup-${version}.exe`, `P2P-Desktop-Setup-${version}.exe.blockmap`, 'latest.yml'];
  const buffers = names.map(name => fs.readFileSync(path.join(output, name)));
  const manifest = buffers[2].toString('utf8');
  const hash = createHash('sha512').update(buffers[0]).digest('base64');
  if (!manifest.includes(`version: ${version}\n`) || !manifest.includes(`sha512: ${hash}`) || !manifest.includes(`path: ${names[0]}`)) {
    throw new Error('latest.yml nao corresponde ao instalador gerado.');
  }
  const release = await api('/releases', {
    method: 'POST',
    body: JSON.stringify({ tag_name: tag, name: tag, draft: true, prerelease: false, body: `Luxlab Desktop ${version}` }),
  });
  console.log(`Rascunho criado: ${release.html_url}`);
  for (let i = 0; i < names.length; i++) {
    console.log(`Enviando ${names[i]}...`);
    const url = `${release.upload_url.split('{')[0]}?name=${encodeURIComponent(names[i])}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: buffers[i],
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (!response.ok) throw new Error(`Upload falhou: ${names[i]} (HTTP ${response.status}). Rascunho preservado: ${release.html_url}`);
  }
  const assets = await api(`/releases/${release.id}/assets`);
  if (!names.every((name, i) => assets.some(asset => asset.name === name && asset.state === 'uploaded' && asset.size === buffers[i].length))) {
    throw new Error(`Artefatos incompletos. Rascunho preservado: ${release.html_url}`);
  }
  if (!flags.has('--draft')) await api(`/releases/${release.id}`, { method: 'PATCH', body: JSON.stringify({ draft: false }) });
  console.log(`Concluido: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
  console.log('Lembre-se de commitar e enviar package.json e package-lock.json. Este script nao faz commit nem push do codigo.');
}

main().catch(error => {
  console.error(`Release interrompida: ${error.message}`);
  console.error('Se a versao ja foi aumentada, use current na nova tentativa. Se houver rascunho, revise-o no GitHub primeiro.');
  process.exitCode = 1;
});

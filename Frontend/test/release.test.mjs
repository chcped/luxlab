import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const source = fs.readFileSync(new URL('../scripts/release.cjs', import.meta.url), 'utf8');

async function simulate({ failUpload = false, existing = false } = {}) {
  const requests = [];
  const commands = [];
  const installer = Buffer.from('installer');
  const names = ['P2P-Desktop-Setup-0.3.1.exe', 'P2P-Desktop-Setup-0.3.1.exe.blockmap', 'latest.yml'];
  const manifest = Buffer.from(`version: 0.3.1\npath: ${names[0]}\nsha512: ${createHash('sha512').update(installer).digest('base64')}\n`);
  const buffers = [installer, Buffer.from('blockmap'), manifest];
  const fakeProcess = { argv: ['node', 'release.cjs'], env: { GH_TOKEN: 'test-token', npm_execpath: 'npm.cjs' }, platform: 'win32', execPath: 'node', chdir() {} };
  const modules = {
    'node:fs': { readFileSync(file) {
      if (file === 'package.json') return JSON.stringify({ version: '0.3.0', build: { publish: { owner: 'chcped', repo: 'luxlab' }, directories: { output: 'dist' } } });
      return buffers[names.indexOf(path.basename(file))];
    } },
    'node:path': path,
    'node:crypto': { createHash },
    'node:child_process': { spawnSync(command, args) { commands.push(args); return { status: 0 }; } },
  };
  const require = name => modules[name];
  require.resolve = () => 'builder.cjs';
  const context = vm.createContext({
    require, __dirname: path.resolve('scripts'), process: fakeProcess,
    console: { log() {}, error() {} }, AbortSignal,
    fetch: async (url, options) => {
      const method = options.method || 'GET';
      requests.push({ url, method });
      let data = {};
      if (url.includes('?per_page=')) data = existing ? [{ tag_name: 'v0.3.1' }] : [];
      else if (method === 'POST' && url.endsWith('/releases')) data = { id: 1, html_url: 'https://github.com/example', upload_url: 'https://uploads.github.com/example{?name,label}' };
      else if (url.endsWith('/assets')) data = names.map((name, i) => ({ name, state: 'uploaded', size: buffers[i].length }));
      return { ok: !(failUpload && url.startsWith('https://uploads.')), status: 500, json: async () => data };
    },
  });
  await vm.runInContext(source, context);
  return { requests, commands, fakeProcess };
}

test('release publica somente depois dos tres uploads e da verificacao', async () => {
  const { requests, commands, fakeProcess } = await simulate();
  assert.equal(fakeProcess.exitCode, undefined);
  const publish = requests.findIndex(r => r.method === 'PATCH');
  const uploads = requests.filter(r => r.url.startsWith('https://uploads.'));
  assert.equal(uploads.length, 3);
  assert.equal(requests[publish - 1].url.endsWith('/assets'), true);
  assert.equal(publish, requests.length - 1);
  assert.equal(commands.length, 3);
});

test('falha no upload preserva o rascunho sem publicar', async () => {
  const { requests, fakeProcess } = await simulate({ failUpload: true });
  assert.equal(fakeProcess.exitCode, 1);
  assert.equal(requests.some(r => r.method === 'PATCH'), false);
});

test('release existente impede build e alteracao da versao', async () => {
  const { requests, commands, fakeProcess } = await simulate({ existing: true });
  assert.equal(fakeProcess.exitCode, 1);
  assert.equal(commands.length, 0);
  assert.equal(requests.every(r => r.method === 'GET'), true);
});

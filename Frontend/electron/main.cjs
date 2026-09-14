const { app, BrowserWindow, desktopCapturer, ipcMain, protocol, net, session, Tray, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { safeStorage } = require('electron');
const { clipboard } = require('electron');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window;
let selectedSource;
let selectionExpires = 0;
let tray;
let splash;
let booting = true;
const trusted = frame => frame?.url === 'app://desktop/index.html';

// Chromium's profile/cache must not be shared by concurrent app instances.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
}

if (primaryInstance) app.whenReady().then(async () => {
  const processAudio = require('./process-audio.cjs').setupProcessAudio({ ipcMain, getWindow: () => window, trusted, app });
  ipcMain.handle('clipboard:write-text', (event, text) => {
    if (!trusted(event.senderFrame) || event.sender !== window?.webContents) throw new Error('Origem inválida');
    if (typeof text !== 'string' || text.length > 8192) throw new Error('Texto inválido');
    clipboard.writeText(text);
  });
  const accountSessionFile = () => path.join(app.getPath('userData'), 'account-session.bin');
  ipcMain.handle('account-session:get', event => {
    if (!trusted(event.senderFrame) || !safeStorage.isEncryptionAvailable()) return null;
    try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(accountSessionFile()))); } catch { return null; }
  });
  ipcMain.handle('account-session:set', (event, value) => {
    if (!trusted(event.senderFrame) || !safeStorage.isEncryptionAvailable()) throw new Error('Armazenamento protegido indisponível.');
    if (!value || typeof value.accessToken !== 'string' || value.accessToken.length > 256 || typeof value.expiresAt !== 'number') throw new Error('Sessão inválida.');
    fs.writeFileSync(accountSessionFile(), safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 });
  });
  ipcMain.handle('account-session:clear', event => {
    if (!trusted(event.senderFrame)) throw new Error('Origem inválida');
    try { fs.rmSync(accountSessionFile()); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
  ipcMain.handle('startup:get', event => {
    if (!trusted(event.senderFrame)) throw new Error('Origem inválida');
    return { supported: app.isPackaged && process.platform === 'win32', enabled: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle('startup:set', (event, enabled) => {
    if (!trusted(event.senderFrame) || typeof enabled !== 'boolean' || !app.isPackaged || process.platform !== 'win32') throw new Error('Disponível no aplicativo instalado no Windows.');
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--background'] });
  });
  protocol.handle('app', request => {
    const url = new URL(request.url);
    const files = ['/index.html', '/styles.css', '/app.js', '/room-client.mjs', '/playback.mjs', '/process-audio.mjs'];
    if (url.host !== 'desktop' || !files.includes(url.pathname)) return new Response('', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, '../src', url.pathname.slice(1))).href);
  });
  ipcMain.handle('capture:sources', async event => {
    if (!trusted(event.senderFrame)) throw new Error('Origem inválida');
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
    return sources.map(source => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
  });
  ipcMain.handle('capture:select', (event, id) => {
    if (!trusted(event.senderFrame) || typeof id !== 'string' || id.length > 200) throw new Error('Fonte inválida');
    selectedSource = id;
    selectionExpires = Date.now() + 10000;
  });
  const allowCapture = (contents, permission) => require('./permissions.cjs').allowPermission({
    contents, permission, window, selectedSource, selectionExpires, trusted
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) =>
    allowCapture(contents, permission));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
    callback(allowCapture(contents, permission)));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const id = Date.now() < selectionExpires ? selectedSource : undefined;
    selectedSource = undefined;
    selectionExpires = 0;
    if (!trusted(request.frame) || !id) return callback({});
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      const source = sources.find(item => item.id === id);
      if (!source) return callback({});
      callback({ video: source });
    } catch { callback({}); }
  });
  function createWindow() {
    window = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 680, show: !process.argv.includes('--background'),
      backgroundColor: '#101117', autoHideMenuBar: true, icon: path.join(__dirname, '../icone.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('render-process-gone', () => processAudio.stop());
    window.webContents.on('did-start-navigation', () => processAudio.stop());
    window.on('closed', () => { processAudio.stop(); window = null; selectedSource = undefined; });
    window.loadURL('app://desktop/index.html');
  }
  const updater = require('electron-updater').autoUpdater;
  // Avoid an unhandled EventEmitter error between startup and normal mode.
  updater.on('error', error => console.warn('[updates]', error.message));
  const { updateMarker, checkStartup } = require('./startup-update.cjs');
  const marker = updateMarker(app);
  const skipCheck = marker.consume();
  if (app.isPackaged && process.platform === 'win32' && !skipCheck && !process.argv.includes('--background')) {
    splash = new BrowserWindow({ width: 440, height: 470, frame: false, resizable: false, show: false,
      icon: path.join(__dirname, '../icone.png'), backgroundColor: '#030711',
      webPreferences: { preload: path.join(__dirname, 'splash-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    splash.webContents.on('will-navigate', event => event.preventDefault());
    await splash.loadFile(path.join(__dirname, 'splash.html'));
    splash.show();
    await checkStartup({ updater, marker, render: state => { if (!splash?.isDestroyed()) splash.webContents.send('splash:state', state); } });
  }
  createWindow();
  splash?.destroy(); splash = null; booting = false;
  require('./updates.cjs').setupUpdates({
    app, ipcMain, updater,
    getWindow: () => window, trusted, startupChecked: !process.argv.includes('--background')
  });
  app.getFileIcon(process.execPath).then(icon => {
    tray = new Tray(icon);
    tray.setToolTip('Luxlab Desktop');
    const show = () => { window?.show(); window?.focus(); };
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir Luxlab Desktop', click: show }, { label: 'Sair e encerrar captura', click: () => app.quit() }]));
    tray.on('double-click', show);
  }).catch(() => window?.show());
  app.on('activate', () => { if (!window) createWindow(); });
});
app.on('window-all-closed', () => { if (!booting) app.quit(); });


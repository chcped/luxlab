const { app, BrowserWindow, desktopCapturer, ipcMain, protocol, net, session, Tray, Menu } = require('electron');
const path = require('node:path');
const { clipboard } = require('electron');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window;
let selectedSource;
let selectionExpires = 0;
let tray;
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

if (primaryInstance) app.whenReady().then(() => {
  ipcMain.handle('clipboard:write-text', (event, text) => {
    if (!trusted(event.senderFrame) || event.sender !== window?.webContents) throw new Error('Origem inválida');
    if (typeof text !== 'string' || text.length > 8192) throw new Error('Texto inválido');
    clipboard.writeText(text);
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
    const files = ['/index.html', '/styles.css', '/app.js', '/room-client.mjs'];
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
  const allowCapture = (contents, permission) => !!contents &&
    contents === window?.webContents && trusted(contents.mainFrame) &&
    (permission === 'display-capture' || permission === 'media') &&
    !!selectedSource && Date.now() < selectionExpires;
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
      callback({ video: source, ...(request.audioRequested ? { audio: 'loopback' } : {}) });
    } catch { callback({}); }
  });
  function createWindow() {
    window = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 680, show: !process.argv.includes('--background'),
      backgroundColor: '#101117', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('closed', () => { window = null; selectedSource = undefined; });
    window.loadURL('app://desktop/index.html');
  }
  createWindow();
  require('./updates.cjs').setupUpdates({
    app, ipcMain, updater: require('electron-updater').autoUpdater,
    getWindow: () => window, trusted
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
app.on('window-all-closed', () => app.quit());


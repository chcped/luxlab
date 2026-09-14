const CHECK_INTERVAL = 4 * 60 * 60 * 1000;

function setupUpdates({ app, ipcMain, updater, getWindow, trusted, startupChecked = false }) {
  const enabled = app.isPackaged && process.platform === 'win32';
  let state = { status: enabled ? 'idle' : 'disabled' };
  let checking = false;
  let installing = false;
  const publish = value => {
    state = value;
    const contents = getWindow()?.webContents;
    if (contents && !contents.isDestroyed()) contents.send('updates:state', state);
  };
  const authorize = event => {
    if (event.sender !== getWindow()?.webContents || !trusted(event.senderFrame)) throw new Error('Origem inválida');
  };
  ipcMain.handle('updates:get', event => { authorize(event); return state; });
  ipcMain.handle('updates:install', event => {
    authorize(event);
    if (!enabled || state.status !== 'downloaded' || installing) return false;
    installing = true;
    // Reply to the renderer before closing the application.
    setImmediate(() => {
      try {
        require('./startup-update.cjs').updateMarker(app).write(state.version);
        updater.quitAndInstall(true, true);
      }
      catch (error) { installing = false; reportError(error); }
    });
    return true;
  });
  function reportError(error) {
    console.warn('[updates]', error?.message || error);
    installing = false;
    publish({ status: 'error' });
  }
  if (!enabled) return;

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.on('error', reportError);
  updater.on('update-available', info => publish({ status: 'downloading', version: info.version }));
  updater.on('update-not-available', () => publish({ status: 'idle' }));
  updater.on('update-downloaded', info => publish({ status: 'downloaded', version: info.version }));
  async function check() {
    if (checking || installing || state.status === 'downloading' || state.status === 'downloaded') return;
    checking = true;
    try { await updater.checkForUpdates(); }
    catch (error) { reportError(error); }
    finally { checking = false; }
  }
  const initialTimer = setTimeout(check, startupChecked ? CHECK_INTERVAL : 15000);
  const interval = setInterval(check, CHECK_INTERVAL);
  initialTimer.unref();
  interval.unref();
  app.once('before-quit', () => { clearTimeout(initialTimer); clearInterval(interval); });
}

module.exports = { setupUpdates };

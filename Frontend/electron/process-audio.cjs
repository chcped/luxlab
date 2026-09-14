// Only explicit process capture is allowed; never fall back to system loopback.
function setupProcessAudio({ ipcMain, getWindow, trusted, app, loadCapture = () => require('process-audio-capture').audioCapture }) {
  let capture, owner, token, allowed = new Set();
  function authorize(event) {
    if (event.sender !== getWindow()?.webContents || !trusted(event.senderFrame)) throw new Error('Origem inválida');
  }
  function backend() {
    if (process.platform !== 'win32' || Number(require('node:os').release().split('.')[2]) < 20348) throw new Error('Áudio por aplicativo requer Windows build 20348 ou superior.');
    return capture ||= loadCapture();
  }
  function stop() {
    token = undefined;
    owner = undefined;
    capture?.stopCapture();
  }
  ipcMain.handle('audio:processes', event => {
    authorize(event);
    const list = backend().getProcessList().filter(item => item.pid > 0 && item.pid !== process.pid);
    allowed = new Set(list.map(item => item.pid));
    return list.map(({ pid, name, description }) => ({ pid, name: description || name }));
  });
  ipcMain.handle('audio:start', (event, pid, requestToken) => {
    authorize(event);
    if (!Number.isSafeInteger(pid) || !allowed.has(pid) || typeof requestToken !== 'string' || requestToken.length > 100) throw new Error('Selecione um aplicativo de áudio.');
    stop();
    if (!backend().getProcessList().some(item => item.pid === pid)) throw new Error('O aplicativo selecionado foi fechado. Selecione novamente.');
    owner = event.sender;
    token = requestToken;
    try {
      if (!backend().startCapture(pid, data => {
        if (token === requestToken && owner && !owner.isDestroyed()) owner.send('audio:data', { ...data, token });
      })) throw new Error('Não foi possível capturar o áudio desse aplicativo.');
    } catch (error) { stop(); throw error; }
    return true;
  });
  ipcMain.handle('audio:stop', (event, requestToken) => {
    authorize(event);
    if (token === requestToken) stop();
  });
  app.on('before-quit', stop);
  return { stop };
}
module.exports = { setupProcessAudio };

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  copyText: text => ipcRenderer.invoke('clipboard:write-text', text),
  getSources: () => ipcRenderer.invoke('capture:sources'),
  selectSource: id => ipcRenderer.invoke('capture:select', id),
  getStartup: () => ipcRenderer.invoke('startup:get'),
  setStartup: enabled => ipcRenderer.invoke('startup:set', enabled),
  getUpdateState: () => ipcRenderer.invoke('updates:get'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('updates:state', listener);
    return () => ipcRenderer.removeListener('updates:state', listener);
  }
});

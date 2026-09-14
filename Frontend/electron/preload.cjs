const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  copyText: text => ipcRenderer.invoke('clipboard:write-text', text),
  getAccountSession: () => ipcRenderer.invoke('account-session:get'),
  setAccountSession: value => ipcRenderer.invoke('account-session:set', value),
  clearAccountSession: () => ipcRenderer.invoke('account-session:clear'),
  getSources: () => ipcRenderer.invoke('capture:sources'),
  selectSource: id => ipcRenderer.invoke('capture:select', id),
  getAudioProcesses: () => ipcRenderer.invoke('audio:processes'),
  startProcessAudio: (pid, token) => ipcRenderer.invoke('audio:start', pid, token),
  stopProcessAudio: token => ipcRenderer.invoke('audio:stop', token),
  onProcessAudio: callback => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('audio:data', listener);
    return () => ipcRenderer.removeListener('audio:data', listener);
  },
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

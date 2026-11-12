const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  on: (channel, fn) => ipcRenderer.on(channel, (_e, data) => fn(data))
});
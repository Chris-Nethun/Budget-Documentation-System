const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('budgetDesktop', {
  request: (request) => ipcRenderer.invoke('budget:request', request),
  openFile: (name, reveal) => ipcRenderer.invoke('budget:open-file', name, reveal),
  showDatabase: () => ipcRenderer.invoke('budget:show-database'),
});

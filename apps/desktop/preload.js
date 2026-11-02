// Tells the page it runs as the desktop app and how many helper engines to start (one per spare core, up to 6).
// (The preload is sandboxed: system details come from the main process.)
const { contextBridge, ipcRenderer } = require('electron');
const info = ipcRenderer.sendSync('desktop-info') || {};
contextBridge.exposeInMainWorld('DRAFTWORK_DESKTOP', {
  helpers: Math.max(1, Math.min(6, (info.cores || 2) - 1)),
  cores: info.cores,
  memoryGB: info.memoryGB,
  version: info.version,
  // files opened with Draftwork (double-click a .step/.stl or drag onto the icon)
  onOpenFile: cb => ipcRenderer.on('open-file', (_e, file) => cb(file)),
  ready: () => ipcRenderer.send('page-ready'),
});

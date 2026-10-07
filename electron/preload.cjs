/** Exposes a tiny, safe bridge to the game page (window.blackeyeDesktop). */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blackeyeDesktop', {
  desktop: true,
  platform: process.platform,
  quit: () => ipcRenderer.send('app:quit'),
  toggleFullscreen: () => ipcRenderer.send('app:fullscreen'),
  achievement: (id) => ipcRenderer.send('steam:achievement', String(id)),
});

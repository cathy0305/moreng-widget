// preload.js — 렌더러에 안전한 API만 노출
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  fetchEvents: (offset, force) => ipcRenderer.invoke('fetch-events', { offset: offset || 0, force: !!force }),
  getTodos: () => ipcRenderer.invoke('get-todos'),
  saveTodos: (list) => ipcRenderer.invoke('save-todos', list),
  resize: (w, h) => ipcRenderer.send('resize', { w, h }),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  openLink: (url) => ipcRenderer.send('open-link', url),
  onRefresh: (cb) => ipcRenderer.on('refresh', () => cb()),
});

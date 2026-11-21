'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['state', 'refresh', 'openPm', 'copy', 'close']);
contextBridge.exposeInMainWorld('alerts', Object.freeze({
  invoke: (action, payload = {}) => actions.has(action) ? ipcRenderer.invoke('alerts:command', action, payload) : Promise.reject(new Error('지원하지 않는 알림 동작')),
  onState: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('alerts:state', handler);
    return () => ipcRenderer.removeListener('alerts:state', handler);
  }
}));

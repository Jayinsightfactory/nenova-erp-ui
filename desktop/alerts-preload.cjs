'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['state', 'refresh', 'openPm', 'close']);
contextBridge.exposeInMainWorld('alerts', Object.freeze({
  invoke: action => actions.has(action) ? ipcRenderer.invoke('alerts:command', action) : Promise.reject(new Error('지원하지 않는 알림 동작')),
  onState: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('alerts:state', handler);
    return () => ipcRenderer.removeListener('alerts:state', handler);
  }
}));

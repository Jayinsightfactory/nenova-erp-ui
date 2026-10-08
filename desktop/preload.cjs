'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const actions = new Set(['state','appUpdate','cancelUpdate','sync','open','activate','close','reorder','detach','move','menu','tools','favorite','menuFavorite','navigate','reload','zoom','print','newWindow','closeWindow','quit','dragEnd','rename']);
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  invoke: (action, payload = {}) => actions.has(action) ? ipcRenderer.invoke('desktop:command', action, payload) : Promise.reject(new Error('지원하지 않는 동작')),
  onState: callback => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('desktop:state', handler);
    return () => ipcRenderer.removeListener('desktop:state', handler);
  }
}));

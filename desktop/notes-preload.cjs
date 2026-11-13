'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const actions=new Set(['state','draft','home','quit','shortcut','workspace','pin','reminder','copy']);
contextBridge.exposeInMainWorld('notes',Object.freeze({invoke:(action,payload={})=>actions.has(action)?ipcRenderer.invoke('notes:command',action,payload):Promise.reject(new Error('지원하지 않는 메모장 동작'))}));

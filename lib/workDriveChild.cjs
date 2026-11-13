'use strict';
// Supervised, low-priority child with a private IPC channel. It has no database
// or ERP credentials. Each child exits on parent disconnect (including reload).
const {fork}=require('node:child_process'),os=require('node:os');
function launch(filename,settings){
 const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','TZ','LANG','LC_ALL','NODE_ENV'])if(process.env[k])env[k]=process.env[k];
 const child=fork(filename,[JSON.stringify(settings)],{env,execArgv:['--max-old-space-size=256'],stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced',windowsHide:true});
 let finished=false;const closed=new Promise(r=>child.once('close',()=>{finished=true;r()}));
 return {pid:child.pid,on:(event,cb)=>child.on(event,cb),unref(){child.unref();child.channel?.unref()},ref(){child.ref();child.channel?.ref()},postMessage(value){child.send(value,e=>{if(e&&!finished)child.kill('SIGKILL')})},terminate(){if(!finished)child.kill('SIGKILL');return closed}};
}
function endpoint(){
 if(!process.send)throw Error('IPC_REQUIRED');
 const settings=JSON.parse(process.argv[2]);let deliver;const pending=[];
 process.on('message',m=>{if(deliver)deliver(m);else pending.push(m)});
 process.once('disconnect',()=>process.exit(0));
 try{os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL)}catch{}
 return {workerData:settings,parentPort:{postMessage:m=>{if(process.connected)process.send(m)},on:(_,fn)=>{deliver=fn;for(const m of pending.splice(0))fn(m)}}};
}
module.exports={launch,endpoint};

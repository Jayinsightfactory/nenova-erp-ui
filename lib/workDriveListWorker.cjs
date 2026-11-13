'use strict';
const {endpoint}=require('./workDriveChild.cjs'),{workerData,parentPort}=endpoint();
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
require('node:module').register(pathToFileURL(path.join(workerData.projectRoot,'scripts/work-drive-esm-loader.mjs')));
const MAX_INDEX_BYTES=64*1024*1024;
(async()=>{
 const {readDriveListRows,driveUsage}=await import(pathToFileURL(path.join(workerData.projectRoot,'lib/workDrive.js')));
 const index=path.join(process.cwd(),'data/drive/index.jsonl');let cache=null,indexReads=0,diskWalks=0;
 function signature(){try{const s=fs.statSync(index,{bigint:true});if(s.size>BigInt(MAX_INDEX_BYTES))throw Error('INDEX_TOO_LARGE');return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');}catch(e){if(e.code==='ENOENT')return 'missing';throw e;}}
 function snapshot(){
  for(let attempt=0;attempt<2;attempt++){
   const before=signature();if(cache?.signature===before)return cache;
   const rows=readDriveListRows();indexReads++;const after=signature();
   if(before!==after){cache=null;continue;}
   const latest=new Map();for(const row of rows)latest.set(row.id,row);
   cache={signature:after,auditRows:rows,rows:[...latest.values()]};return cache;
  }
  throw Error('INDEX_CHANGED');
 }
 parentPort.on('message',message=>{
  try{
   const view=snapshot();let usage;
   // On-disk figures remain a fresh complete scan, never a stale quota cache.
   // The index side is the same immutable audit snapshot used by the file list.
   if(message.includeUsage===true){usage=driveUsage(view.auditRows);diskWalks++;}
   // Exact stat validation still runs on every call. Reuse unchanged rows over
   // IPC, while always returning newly scanned admin disk usage.
   const unchanged=message.knownSignature===view.signature;
   parentPort.postMessage(message.usageOnly===true
    ? {id:message.id,ok:true,snapshot:{usage},stats:{indexReads,diskWalks}}
    : {id:message.id,ok:true,signature:view.signature,unchanged,snapshot:{...(!unchanged?{rows:view.rows}:{}),...(usage?{usage}:{})},stats:{indexReads,diskWalks}});
  }catch{cache=null;parentPort.postMessage({id:message.id,ok:false});}
 });
})().catch(()=>process.exit(1));

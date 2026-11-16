'use strict';
const {endpoint}=require('./workDriveChild.cjs'),{workerData,parentPort}=endpoint();
const path=require('node:path'),{pathToFileURL}=require('node:url');
require('node:module').register(pathToFileURL(path.join(workerData.projectRoot,'scripts/work-drive-esm-loader.mjs')));
const MAX_INDEX_BYTES=64*1024*1024;
(async()=>{
 const {readDriveListRows,driveUsage,previewLatestVisible,searchLatestVisible}=await import(pathToFileURL(path.join(workerData.projectRoot,'lib/workDrive.js')));
 const index=path.join(process.cwd(),'data/drive/index.jsonl');let cache=null,indexReads=0,diskWalks=0;
 const {captureDriveIndex} = require('./workDriveIndexCapture.cjs');
 function snapshot() {
  const capture = captureDriveIndex(index, MAX_INDEX_BYTES, cache?.signature);
  if (capture.unchanged) return cache;
  const rows = readDriveListRows(capture.bytes);
  indexReads++;
  const latest = new Map();
  for (const row of rows) latest.set(row.id, row);
  cache = {signature:capture.signature, auditRows:rows, rows:[...latest.values()]};
  return cache;
 }
 parentPort.on('message',message=>{
  try{
   const view=snapshot();let usage;
   // On-disk figures remain a fresh complete scan, never a stale quota cache.
   // The index side is the same immutable audit snapshot used by the file list.
   if(message.includeUsage===true){usage=driveUsage(view.auditRows);diskWalks++;}
   // Exact stat validation still runs on every call. Reuse unchanged rows over
   // IPC, while always returning newly scanned admin disk usage.
   const previews=message.viewers?.map(viewer => viewer.searchQuery !== undefined ? searchLatestVisible(viewer,view.rows,viewer.searchQuery,viewer.searchCriteria) : previewLatestVisible(viewer,view.rows));
   if(message.previewOnly) {
    parentPort.postMessage({id:message.id,ok:true,previews,stats:{indexReads,diskWalks}});
    return;
   }
   const unchanged=message.knownSignature===view.signature;
   parentPort.postMessage(message.usageOnly===true
    ? {id:message.id,ok:true,snapshot:{usage},stats:{indexReads,diskWalks}}
    : {id:message.id,ok:true,...(previews?{previews}:{}),signature:view.signature,unchanged,snapshot:{...(!unchanged?{rows:view.rows}:{}),...(usage?{usage}:{})},stats:{indexReads,diskWalks}});
  }catch{cache=null;parentPort.postMessage({id:message.id,ok:false});}
 });
})().catch(()=>process.exit(1));

'use strict';
const {parentPort,workerData}=require('node:worker_threads'),path=require('node:path'),{pathToFileURL}=require('node:url'),fs=require('node:fs');
(async()=>{
 const {recomputePairs}=await import(pathToFileURL(path.join(workerData.projectRoot,'lib/workDrivePairs.js')).href);
 const {acquireOwnerLock,releaseOwnerLock}=await import(pathToFileURL(path.join(workerData.projectRoot,'lib/personalHomeStore.js')).href);
 const XLSX=require('xlsx');XLSX.CFB.utils.use_zlib(require('node:zlib'));
 let reads=0;const xlsxLib={read:(...args)=>{reads++;return XLSX.read(...args);}},lock=path.join(workerData.rootDir,'pairs-worker.lock');
 parentPort.on('message',async message=>{
  let owner;const start=reads;
  try{fs.mkdirSync(workerData.rootDir,{recursive:true});owner=await acquireOwnerLock(lock);const doc=recomputePairs({xlsxLib,rootDir:workerData.rootDir});await releaseOwnerLock(lock,owner);owner=null;parentPort.postMessage({id:message.id,ok:true,doc,stats:{workbooksRead:reads-start}});}
  catch{if(owner)await releaseOwnerLock(lock,owner).catch(()=>{});parentPort.postMessage({id:message.id,ok:false});}
 });
})().catch(()=>process.exit(1));

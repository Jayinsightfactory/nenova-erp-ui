'use strict';
const {parentPort,workerData}=require('./workDriveChild.cjs').endpoint(),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
require('node:module').register(pathToFileURL(path.join(workerData.projectRoot,'scripts/work-drive-esm-loader.mjs')));
const {enqueuePairJob}=require('./workDrivePairQueue.cjs');
(async()=>{
 const {ingestFile}=await import(pathToFileURL(path.join(workerData.projectRoot,'lib/workDrive.js')));
 const {isInvoiceFile,isResultWorkbook}=await import(pathToFileURL(path.join(workerData.projectRoot,'lib/workDrivePairs.js')));
 const {REMIT_FILE_RE,parseRemitRequestWorkbook}=await import(pathToFileURL(path.join(workerData.projectRoot,'lib/farmRemitImport.js')));
 const XLSX=require('xlsx');XLSX.CFB.utils.use_zlib(require('node:zlib'));
 parentPort.on('message',async message=>{
  try{
   if(message.type==='replayMirrors'){
    const dir=path.join(process.cwd(),'data','drive','mirror-jobs');let jobs=[];
    try{jobs=fs.readdirSync(dir).filter(n=>/^[a-f0-9-]+\.json$/.test(n)).slice(0,8);}catch(e){if(e.code!=='ENOENT')throw e;}
    for(const name of jobs){
     const meta=path.join(dir,name),file=meta.replace(/\.json$/,'.bin');
     try{const input=JSON.parse(fs.readFileSync(meta,'utf8')),buffer=fs.readFileSync(file),result=ingestFile({...input,buffer,lockToken:workerData.token});if(result.ok){fs.unlinkSync(meta);fs.unlinkSync(file);}}catch{}
    }
    parentPort.postMessage({id:message.id,ok:true,replayed:true});return;
   }
   const input=message.input,buffer=fs.readFileSync(input.filepath),filename=input.filename||'';
   const pairing=isInvoiceFile({filename})||isResultWorkbook({filename});
   let parsedRows,remitError;
   if(REMIT_FILE_RE.test(filename)&&/\.xlsx?$/i.test(filename)){
    try{parsedRows=parseRemitRequestWorkbook(buffer,XLSX);}catch(e){remitError=e.message;}
   }
   let result;
   for(let attempt=0;attempt<80;attempt++){
    result=ingestFile({...input,buffer,lockToken:workerData.token,beforeStore:pairing?()=>enqueuePairJob(path.join(process.cwd(),'data','drive')):null});
    if(result.status!==503)break;
    await new Promise(resolve=>setTimeout(resolve,25));
   }
   parentPort.postMessage({id:message.id,ok:true,result,parsedRows,remitError});
  }catch(e){parentPort.postMessage({id:message.id,ok:false,status:e.status||500,error:'업무 파일 저장 실패'});}
 });
})().catch(()=>process.exit(1));

'use strict';
const {parentPort,workerData}=require('./workDriveChild.cjs').endpoint();
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),XLSX=require('xlsx');
const url=file=>pathToFileURL(path.join(workerData.projectRoot,file)).href;
require('node:module').register(url('scripts/work-drive-esm-loader.mjs'));
(async()=>{
 const [{parseOrderImportWorkbook},{mirrorWebUpload}]=await Promise.all([import(url('lib/orderImportParse.js')),import(url('lib/workDrive.js'))]);
 parentPort.on('message',({id,input})=>{
  try {
   const buf=fs.readFileSync(input.filepath);
   mirrorWebUpload({buffer:buf,filename:input.sourceName,user:{userName:input.uploaderName},source:'orders/import-parse'});
   const book=XLSX.read(buf,{type:'buffer',cellDates:false,cellNF:false,cellStyles:false});
   const parsed=parseOrderImportWorkbook(XLSX,book,{sourceName:input.sourceName||'upload.xlsx',sheetName:input.sheetName||undefined});
   parentPort.postMessage({id,ok:true,parsed});
  } catch {parentPort.postMessage({id,ok:false,error:'주문 파일을 읽을 수 없습니다. 파일 형식과 시트를 확인해 주세요.'});}
 });
})().catch(()=>process.exit(1));

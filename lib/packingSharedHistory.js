// Web-only immutable recovery snapshots. No ERP SQL or generated write tokens.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {normalizePackingWorkSnapshot} from './packingWorkDraft.js';
const ROOT=path.join(process.cwd(),'data/runtime/import-team/packing-uploads');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const MAX=50*1024*1024;
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function safe(value,depth=0){
 if(depth>30)fail('보관 자료 구조가 너무 깊습니다.');
 if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))fail('허용하지 않는 필드입니다.');safe(v,depth+1);}
}
function checkSource(value,expected){
 if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
  if((key==='sourceHash'||key==='pdfSourceHash')&&typeof item==='string'&&item.toLowerCase()!==expected)fail('분석 결과와 원본 파일이 다릅니다.');
  checkSource(item,expected);
 }
}
async function publish(file,bytes){
 const temp=file+'.'+randomUUID()+'.tmp';
 await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600});
 try{await fs.link(temp,file);}catch(e){if(e.code!=='EEXIST')throw e;}finally{await fs.unlink(temp).catch(()=>{});}
}
function summary(record){return {id:record.id,uploadId:record.uploadId,at:record.at,actor:record.actor,fileName:record.snapshot.fileName,country:record.snapshot.country,sourceHash:record.sourceHash,hasAnalysis:Boolean(record.snapshot.lastExtraction?.result?.invoices?.length),reviewConfirmed:record.snapshot.reviewConfirmed};}
export async function savePackingUpload(input,actor,{root=ROOT,now=()=>new Date()}={}){
 if(!actor||!UUID.test(input?.id||'')||!UUID.test(input?.uploadId||'')||!HASH.test(input?.sourceHash||''))fail('업로드 이력 식별자를 확인하세요.');
 safe(input.snapshot);
 if(Buffer.byteLength(JSON.stringify(input.snapshot||{}))>2*1024*1024)fail('분석 보관 자료는 2MiB 이하여야 합니다.',413);
 await fs.mkdir(path.join(root,'files'),{recursive:true});await fs.mkdir(path.join(root,'records'),{recursive:true});await fs.mkdir(path.join(root,'summaries'),{recursive:true});
 const filePath=path.join(root,'files',input.sourceHash);
 if(input.fileBase64!==undefined){
  if(typeof input.fileBase64!=='string'||input.fileBase64.length>Math.ceil(MAX/3)*4||input.fileBase64.length%4!==0||/[^A-Za-z0-9+/=]/.test(input.fileBase64))fail('원본 파일 형식 또는 크기를 확인하세요.',413);
  const bytes=Buffer.from(input.fileBase64,'base64');if(!bytes.length||bytes.length>MAX||hash(bytes)!==input.sourceHash)fail('원본 파일 해시가 일치하지 않습니다.');
  if(bytes.toString('base64')!==input.fileBase64)fail('원본 파일 인코딩을 확인하세요.');
  await publish(filePath,bytes);
 }
 let bytes;try{bytes=await fs.readFile(filePath);}catch(e){if(e.code==='ENOENT')fail('원본 파일을 먼저 보관하세요.',409);throw e;}
 if(bytes.length>MAX||hash(bytes)!==input.sourceHash)fail('보관 원본 검증에 실패했습니다.',409);
 const snapshot=normalizePackingWorkSnapshot({...input.snapshot,file:new Blob([bytes],{type:input.snapshot?.fileType||''})});
 if(!/\.(pdf|xlsx)$/i.test(snapshot.fileName))fail('PDF 또는 XLSX만 보관할 수 있습니다.');
 if(snapshot.lastExtraction?.sourceHash&&snapshot.lastExtraction.sourceHash!==input.sourceHash)fail('분석 결과와 원본 파일이 다릅니다.');
 checkSource(snapshot.lastExtraction,input.sourceHash);
 delete snapshot.file;
 const requestHash=hash(JSON.stringify({uploadId:input.uploadId,sourceHash:input.sourceHash,snapshot,actor:String(actor)}));
 const record={id:input.id,uploadId:input.uploadId,sourceHash:input.sourceHash,requestHash,at:now().toISOString(),actor:String(actor),snapshot};
 const recordPath=path.join(root,'records',input.id+'.json');
 await publish(recordPath,JSON.stringify(record));
 const saved=JSON.parse(await fs.readFile(recordPath,'utf8'));
 if(saved.requestHash!==requestHash)fail('같은 보관 요청의 내용이 다릅니다.',409);
 await publish(path.join(root,'summaries',input.id+'.json'),JSON.stringify(summary(saved)));
 return summary(saved);
}
export async function listPackingUploads({root=ROOT}={}){
 let names;try{names=await fs.readdir(path.join(root,'summaries'));}catch(e){if(e.code==='ENOENT')return [];throw e;}
 const latest=new Map();
 for(const name of names.filter(n=>UUID.test(n.slice(0,-5))&&n.endsWith('.json'))){
  const record=JSON.parse(await fs.readFile(path.join(root,'summaries',name),'utf8'));
  if(!latest.has(record.uploadId)||latest.get(record.uploadId).at<record.at)latest.set(record.uploadId,record);
 }
 return [...latest.values()].sort((a,b)=>b.at.localeCompare(a.at));
}
export async function readPackingUpload(id,{root=ROOT}={}){
 if(!UUID.test(id||''))fail('이력 식별자를 확인하세요.');
 let record;try{record=JSON.parse(await fs.readFile(path.join(root,'records',id+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')fail('보관된 업로드를 찾을 수 없습니다.',404);throw e;}
 if(!HASH.test(record.sourceHash))fail('보관된 원본 식별자가 잘못되었습니다.',409);
 const bytes=await fs.readFile(path.join(root,'files',record.sourceHash));
 if(bytes.length>MAX||hash(bytes)!==record.sourceHash)fail('원본 파일 검증에 실패했습니다.',409);
 return {...summary(record),snapshot:record.snapshot,fileBase64:bytes.toString('base64')};
}

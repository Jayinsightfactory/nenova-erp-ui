import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parsePackingResponse} from './importPackingResponse.js';

export const PDF_ANALYSIS_MODEL='claude-sonnet-4-6';
const MAX_CACHE_BYTES=5*1024*1024;
const TTL=30*24*3600000;
const digest=value=>createHash('sha256').update(value).digest('hex');
export function packingPdfCacheKey({country,pdfBase64,prompt}) {
  return digest(JSON.stringify(['packing-v2',PDF_ANALYSIS_MODEL,country,prompt,digest(Buffer.from(pdfBase64,'base64'))]));
}
function cacheDir(userId,root){return path.join(root,digest(String(userId)));}
const defaultRoot=path.join(process.cwd(),'data/runtime/import-team/pdf-cache');
export async function readPackingPdfCache(userId,key,{root=defaultRoot,now=Date.now()}={}) {
  if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid cache key');
  try{
    const file=path.join(cacheDir(userId,root),key+'.json');
    if((await fs.stat(file)).size>MAX_CACHE_BYTES)return null;
    const record=JSON.parse(await fs.readFile(file,'utf8'));
    if(record.key!==key||!Number.isFinite(record.at)||record.at>now||now-record.at>TTL)return null;
    if(parsePackingResponse(record.data,record.country).wasTruncated)return null;
    return record.data;
  }catch{return null;}
}
export async function writePackingPdfCache(userId,key,country,data,{root=defaultRoot,now=Date.now()}={}) {
  if(!/^[a-f0-9]{64}$/.test(key))throw Error('Invalid cache key');
  if(data.stop_reason!=='end_turn'||parsePackingResponse(data,country).wasTruncated)return false;
  const value=JSON.stringify({key,country,at:now,data:{content:data.content,stop_reason:data.stop_reason}});
  if(Buffer.byteLength(value)>MAX_CACHE_BYTES)return false;
  const dir=cacheDir(userId,root);await fs.mkdir(dir,{recursive:true,mode:0o700});
  const tmp=path.join(dir,key+'.'+randomUUID()+'.tmp');
  try{await fs.writeFile(tmp,value,{flag:'wx',mode:0o600});await fs.rename(tmp,path.join(dir,key+'.json'));}
  finally{await fs.unlink(tmp).catch(()=>{});}
  // Bound retained results per account; original PDFs are never persisted.
  const files=await Promise.all((await fs.readdir(dir)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(async name=>{
    try{return {name,mtime:(await fs.stat(path.join(dir,name))).mtimeMs};}catch{return null;}
  }));
  const ordered=files.filter(Boolean).sort((a,b)=>b.mtime-a.mtime);
  await Promise.all(ordered.filter((f,i)=>i>=100||now-f.mtime>TTL).map(f=>fs.unlink(path.join(dir,f.name)).catch(()=>{})));
  return true;
}

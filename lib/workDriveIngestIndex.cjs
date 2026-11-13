'use strict';
const fs=require('node:fs');
function createIngestIndexReader({fsApi=fs,maxFiles=8}={}){
 const entries=new Map();let parses=0;
 const sig=file=>{try{const s=fsApi.statSync(file,{bigint:true});return {key:[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':'),dev:s.dev,ino:s.ino,size:s.size};}catch(e){if(e.code==='ENOENT')return {key:'missing',size:0n};throw e;}};
 const countKey=(name,owner)=>JSON.stringify([name,owner]);
 function add(state,raw){
  const r=state.normalize(raw);if(!r||r.type==='download')return;
  if(typeof r!=='object'||Array.isArray(r)||typeof r.id!=='string'||!r.id||!(r.size==null||typeof r.size==='number'&&Number.isFinite(r.size)))throw Error('UNSUPPORTED_INDEX_ROW');
  const size=r.size||0,old=state.latest.get(r.id);if(old&&!old.deleted)state.used-=old.size;
  state.latest.set(r.id,{size,deleted:!!r.deleted});if(!r.deleted)state.used+=size;
  if(r.sha&&!state.sha.has(r.sha))state.sha.set(r.sha,r.id);
  if(!r.deleted){const key=countKey(r.filename,r.uploaderName);state.versions.set(key,(state.versions.get(key)||0)+1);}
 }
 function make(normalize){const state={normalize,used:0,latest:new Map(),sha:new Map(),versions:new Map(),signature:null};state.view=Object.freeze({get used(){return state.used;},duplicate(sha){const id=state.sha.get(sha);return id===undefined?null:{id};},versionCount(name,owner){return state.versions.get(countKey(name,owner))||0;}});return state;}
 function read(file,normalize=x=>x){
  const before=sig(file),old=entries.get(file);if(old?.signature===before.key)return old.view;
  const state=make(normalize);
  if(before.key!=='missing'){
   const text=fsApi.readFileSync(file,'utf8');parses++;
   try{for(const line of text.split('\n')){if(!line)continue;let row;try{row=JSON.parse(line);}catch{continue;}if(row)add(state,row);}}catch(e){if(e.message==='UNSUPPORTED_INDEX_ROW'){entries.delete(file);return null;}throw e;}
  }
  const after=sig(file);if(after.key!==before.key){entries.delete(file);return null;}
  state.signature=after.key;entries.set(file,state);if(entries.size>maxFiles)entries.delete(entries.keys().next().value);return state.view;
 }
 function beforeAppend(file){try{return sig(file);}catch{entries.delete(file);return null;}}
 function appended(file,row,before,bytes){
  const state=entries.get(file);if(!state)return;
  try{const after=sig(file);if(!before||state.signature!==before.key||after.key==='missing'||after.size!==before.size+BigInt(bytes)||(before.key!=='missing'&&(after.dev!==before.dev||after.ino!==before.ino))){entries.delete(file);return;}
   add(state,row);state.signature=after.key;
  }catch{entries.delete(file);}
 }
 return {read,beforeAppend,appended,invalidate:file=>entries.delete(file),stats:()=>({parses,files:entries.size})};
}
function sharedIngestIndex(){const key=Symbol.for('nenova.drive-ingest-index.v1');if(!globalThis[key])globalThis[key]=createIngestIndexReader();return globalThis[key];}
module.exports={createIngestIndexReader,sharedIngestIndex};

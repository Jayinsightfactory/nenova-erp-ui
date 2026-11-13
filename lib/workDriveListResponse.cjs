'use strict';
// Avoid one multi-megabyte stringify blocking login/other requests, and respect
// response backpressure so a slow or disconnected browser does not queue it all.
const {setImmediate:yieldTurn}=require('node:timers/promises');
const {encodeDriveFileTable}=require('./workDriveListTable.cjs');
async function sendDriveListJson(res,payload,{chunkBytes=64*1024,table=false}={}){
 const {files,...metadata}=payload;
 let closed=false,chunk='',size=0;
 const onClose=()=>{closed=true;};res.on('close',onClose);
 async function flush(){
  if(closed||res.destroyed)return false;
  const output=chunk;chunk='';size=0;
  if(!res.write(output))await new Promise((resolve,reject)=>{
   const cleanup=()=>{res.off('drain',onDrain);res.off('close',onClosed);res.off('error',onError);};
   const onDrain=()=>{cleanup();resolve();},onClosed=()=>{cleanup();closed=true;resolve();},onError=error=>{cleanup();reject(error);};
   res.once('drain',onDrain);res.once('close',onClosed);res.once('error',onError);
  });
  await yieldTurn();return !closed&&!res.destroyed;
 }
 async function append(value){chunk+=value;size+=Buffer.byteLength(value);return size<chunkBytes||await flush();}
 async function array(values){
  if(!await append('['))return false;
  for(let i=0;i<values.length;i++)if(!await append((i?',':'')+JSON.stringify(values[i])))return false;
  return append(']');
 }
 try{
  const stopped=()=>closed || res.destroyed;
  if(stopped())return;
  const encoded=table?await encodeDriveFileTable(files,stopped):null;
  if(stopped())return;
  res.statusCode=200;res.setHeader('Content-Type','application/json; charset=utf-8');
  if(!await append(JSON.stringify(metadata).slice(0,-1)))return;
  if(encoded){
   if(!await append(',"fileTable":{"version":1,"columns":'+JSON.stringify(encoded.columns)+',"strings":'))return;
   if(!await array(encoded.strings)||!await append(',"rows":')||!await array(encoded.rows)||!await append('}'))return;
  }else if(!await append(',"files":')||!await array(files))return;
  if(!await append('}'))return;if(chunk&&!await flush())return;res.end();
 }finally{res.off('close',onClose);}
}
module.exports={sendDriveListJson};

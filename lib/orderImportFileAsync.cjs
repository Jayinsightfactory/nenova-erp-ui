'use strict';
const path=require('node:path');
const {launch}=require('./workDriveChild.cjs');
const overload=()=>Object.assign(Error('다른 주문 파일을 처리하고 있습니다. 잠시 뒤 다시 시도해 주세요.'),{statusCode:503});
// Only server-side Formidable paths go into this FIFO. Never retain an uploaded
// Buffer, request, bearer token or database credentials in a queued slot.
function createOrderFileReader({projectRoot=process.cwd(),start=launch,timeoutMs=45000,queueMs=20000,maxQueued=20,idleMs=20000}={}){
 let worker,active,idle,seq=0;const pending=[];
 function fail(w){
  if(w!==worker)return;worker=null;clearTimeout(idle);
  if(active){clearTimeout(active.timer);active.reject(overload());active=null;}
  for(const j of pending.splice(0)){clearTimeout(j.timer);j.reject(overload());}
  return w.terminate();
 }
 function pump(){
  if(active||!pending.length)return;
  clearTimeout(idle);
  if(!worker){
   try{worker=start(path.join(projectRoot,'lib/orderImportFileWorker.cjs'),{projectRoot});}
   catch{for(const j of pending.splice(0)){clearTimeout(j.timer);j.reject(overload());}return;}
   const w=worker;
   w.on('error',()=>fail(w));w.on('exit',()=>fail(w));
   w.on('message',m=>{
    if(w!==worker||!active||m.id!==active.id)return;
    const j=active;active=null;clearTimeout(j.timer);w.unref();
    if(m.ok)j.resolve(m.parsed);else j.reject(Error(m.error||'주문 파일을 읽을 수 없습니다.'));
    if(pending.length)pump();else{idle=setTimeout(()=>fail(w),idleMs);idle.unref();}
   });
  }
  const j=active=pending.shift(),w=worker;clearTimeout(j.timer);
  j.timer=setTimeout(()=>fail(w),timeoutMs);j.timer.unref();
  try{w.ref();w.postMessage({id:j.id,input:j.input});}catch{fail(w);}
 }
 function run({filepath,sourceName,sheetName,uploaderName}){
  if(pending.length>=maxQueued&&active)return Promise.reject(overload());
  return new Promise((resolve,reject)=>{
   const j={id:++seq,input:{filepath,sourceName,sheetName,uploaderName},resolve,reject};
   j.timer=setTimeout(()=>{const i=pending.indexOf(j);if(i>=0){pending.splice(i,1);reject(overload());}},queueMs);j.timer.unref();
   pending.push(j);pump();
  });
 }
 return {run,close:async()=>{if(worker)await fail(worker);}};
}
const key=Symbol.for('nenova.order-file-reader.v1');
module.exports={createOrderFileReader,readOrderUpload:input=>(globalThis[key]||=createOrderFileReader()).run(input)};

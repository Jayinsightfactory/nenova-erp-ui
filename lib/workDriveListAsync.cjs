'use strict';
const path=require('node:path'),{launch}=require('./workDriveChild.cjs');
function createDriveListReader({projectRoot=process.cwd(),timeoutMs=10000,idleMs=60000,maxWaiters=64,launchChild=launch,clock=()=>performance.now()}={}){
 let worker=null,active=null,pending=[],waiters=0,sequence=0,closed=false,recovering=false,retiring=null,idle,lastStats,cachedSnapshot=null;
 const fail=code=>Object.assign(Error(code),{statusCode:503});
 function terminate(instance){try{return Promise.resolve(instance.terminate()).catch(()=>{});}catch{return Promise.resolve();}}
 function settle(batch,error,message){if(!batch)return;clearTimeout(batch.timer);for(const job of batch.jobs){if(job.done)continue;job.done=true;clearTimeout(job.timer);waiters--;error?job.reject(error):job.resolve(message.snapshot);}}
 function discard(instance,error){if(worker!==instance)return;worker=null;cachedSnapshot=null;recovering=true;const batch=active;active=null;settle(batch,error);retiring=terminate(instance).finally(()=>{recovering=false;retiring=null;if(!closed)kick();});}
 function kick(){
  if(closed||recovering||active||!pending.length)return;clearTimeout(idle);
  const now=clock(),queued=pending.splice(0),expired=queued.filter(job=>now-job.queuedAt>=timeoutMs),jobs=queued.filter(job=>now-job.queuedAt<timeoutMs);
  settle({jobs:expired},fail('DRIVE_LIST_TIMEOUT'));if(!jobs.length)return;
  const batch={id:++sequence,jobs};active=batch;
  try{
  if(!worker){
   const instance=launchChild(path.join(projectRoot,'lib/workDriveListWorker.cjs'),{projectRoot});worker=instance;instance.unref();
   instance.on('message',message=>{
    if(worker!==instance||!active||message.id!==active.id)return;
    const batch=active;active=null;lastStats=message.stats;instance.unref();
    if(message.ok&&message.signature){
     if(message.unchanged&&cachedSnapshot?.signature!==message.signature)message.ok=false;
     else{if(message.unchanged)message.snapshot={...message.snapshot,rows:cachedSnapshot.rows};cachedSnapshot={signature:message.signature,rows:message.snapshot.rows};}
    }
    if(!message.ok)cachedSnapshot=null;settle(batch,message.ok?null:fail('DRIVE_LIST_READ_FAILED'),message);
    if(pending.length)kick();else idle=setTimeout(()=>{if(worker===instance&&!active){worker=null;cachedSnapshot=null;void terminate(instance);}},idleMs).unref();
   });
   instance.on('error',()=>discard(instance,fail('DRIVE_LIST_CHILD_FAILED')));
   instance.on('exit',()=>discard(instance,fail('DRIVE_LIST_CHILD_EXITED')));
  }
  // Calls arriving after dispatch form the next batch: never attach a new caller
  // to a snapshot which may predate a just-completed correction or upload.
  const remaining=Math.max(1,timeoutMs-(clock()-Math.min(...jobs.map(job=>job.queuedAt)))),instance=worker;
  batch.timer=setTimeout(()=>{if(active===batch)discard(instance,fail('DRIVE_LIST_TIMEOUT'));},remaining).unref();
  worker.ref();worker.postMessage({id:batch.id,includeUsage:jobs.some(job=>job.includeUsage),...(cachedSnapshot?{knownSignature:cachedSnapshot.signature}:{})});
  }catch{
   if(worker)discard(worker,fail('DRIVE_LIST_CHILD_FAILED'));
   else{active=null;settle(batch,fail('DRIVE_LIST_CHILD_FAILED'));if(pending.length)queueMicrotask(kick);}
  }
 }
 function read({includeUsage=false}={}){
  if(closed)return Promise.reject(fail('DRIVE_LIST_CLOSED'));
  if(waiters>=maxWaiters)return Promise.reject(fail('DRIVE_LIST_BUSY'));
  waiters++;return new Promise((resolve,reject)=>{
   const job={includeUsage:includeUsage===true,queuedAt:clock(),resolve,reject};pending.push(job);
   // A slow OS termination must not extend queued HTTP calls indefinitely.
   job.timer=setTimeout(()=>{const i=pending.indexOf(job);if(i>=0)pending.splice(i,1);settle({jobs:[job]},fail('DRIVE_LIST_TIMEOUT'));},timeoutMs).unref();queueMicrotask(kick);
  });
 }
 async function close(){closed=true;cachedSnapshot=null;clearTimeout(idle);settle(active,fail('DRIVE_LIST_CLOSED'));active=null;settle({jobs:pending.splice(0)},fail('DRIVE_LIST_CLOSED'));const instance=worker;worker=null;if(instance)await terminate(instance);if(retiring)await retiring;}
 return {read,close,stats:()=>lastStats,status:()=>({waiters,active:!!active,pending:pending.length})};
}
function readDriveListAsync(options){const key=Symbol.for('nenova.drive-list-reader.v1');const reader=globalThis[key]||(globalThis[key]=createDriveListReader());return reader.read(options);}
module.exports={createDriveListReader,readDriveListAsync};

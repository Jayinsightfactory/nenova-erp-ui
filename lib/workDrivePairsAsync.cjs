'use strict';
const {launch}=require('./workDriveChild.cjs'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
function createDrivePairsRunner({projectRoot=process.cwd(),rootDir=path.join(process.cwd(),'data','drive'),timeoutMs=600000,idleMs=60000}={}){
 let worker=null,active=null,pending=[],closed=false,recovering=false,id=0,idle=null;let lastStats=null;
 const lock=path.join(rootDir,'pairs-worker.lock');
 async function releaseOwnedLock(instance){try{const owner=JSON.parse(await fs.promises.readFile(path.join(lock,'owner.json'),'utf8'));if(owner.pid===instance?.pid){const store=await import(pathToFileURL(path.join(projectRoot,'lib/personalHomeStore.js')).href);await store.releaseOwnerLock(lock,owner);}}catch{}}
 function fail(error){const batch=active;active=null;if(batch){clearTimeout(batch.timer);batch.waiters.forEach(w=>w.reject(error));}}
 async function discard(instance){recovering=true;if(worker===instance)worker=null;try{await instance.terminate();}catch{}await releaseOwnedLock(instance);recovering=false;if(!closed)kick();}
 function kick(){
  if(closed||recovering||active||!pending.length)return;clearTimeout(idle);
  if(!worker){
   const instance=launch(path.join(projectRoot,'lib/workDrivePairsWorker.cjs'),{projectRoot,rootDir});worker=instance;instance.unref();
   instance.on('message',message=>{if(worker!==instance||!active||message.id!==active.id)return;const batch=active;active=null;clearTimeout(batch.timer);lastStats=message.stats||null;instance.unref();
    if(message.ok)batch.waiters.forEach(w=>w.resolve(message.doc));else batch.waiters.forEach(w=>w.reject(Error('PAIR_RECOMPUTE_FAILED')));
    if(pending.length)kick();else idle=setTimeout(()=>{if(!active&&worker===instance){worker=null;void instance.terminate();}},idleMs).unref();
   });
   instance.on('error',()=>{if(worker===instance){fail(Error('PAIR_WORKER_FAILED'));void discard(instance);}});
   instance.on('exit',()=>{if(worker===instance){fail(Error('PAIR_WORKER_EXITED'));void discard(instance);}});
  }
  const batch={id:++id,waiters:pending.splice(0)};active=batch;batch.timer=setTimeout(()=>{if(active===batch){const instance=worker;fail(Error('PAIR_WORKER_TIMEOUT'));if(instance)void discard(instance);}},timeoutMs).unref();worker.ref();worker.postMessage({id:batch.id});
 }
 function run(){if(closed)return Promise.reject(Error('PAIR_QUEUE_CLOSED'));if(pending.length>=128)return Promise.reject(Error('PAIR_QUEUE_BUSY'));return new Promise((resolve,reject)=>{pending.push({resolve,reject});queueMicrotask(kick);});}
 async function close(){closed=true;clearTimeout(idle);fail(Error('PAIR_QUEUE_CLOSED'));pending.splice(0).forEach(w=>w.reject(Error('PAIR_QUEUE_CLOSED')));const instance=worker;worker=null;if(instance)await discard(instance);}
 return {run,close,stats:()=>lastStats};
}
function recomputeDrivePairsAsync(){const key=Symbol.for('nenova.drive-pairs-runner.v1');if(!globalThis[key])globalThis[key]=createDrivePairsRunner();return globalThis[key].run();}
module.exports={createDrivePairsRunner,recomputeDrivePairsAsync};

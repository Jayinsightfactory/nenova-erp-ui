'use strict';
const {launch}=require('./workDriveChild.cjs'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {createPairQueue}=require('./workDrivePairQueue.cjs');
const {recomputeDrivePairsAsync}=require('./workDrivePairsAsync.cjs');
function createDriveIngestService({projectRoot=process.cwd(),pairRun=()=>recomputeDrivePairsAsync({includeResult:false}),maxAdmitted=2}={}){
 let worker=null,active=null,pending=[],admitted=0,sequence=0,closed=false;
 const rootDir=path.join(process.cwd(),'data','drive');
 const pairs=createPairQueue({rootDir,run:pairRun,onError:code=>console.error('[drive-ingest]',code)});pairs.start();
 // Wait on the socket before multipart parsing, not with a file buffer in memory.
 const waiters=[];
 function admit(){if(closed||admitted>=maxAdmitted)return null;admitted++;let released=false;return()=>{if(!released){released=true;admitted--;waiters.shift()?.grant();}};}
 function acquire(req){
  if(req.aborted||req.destroyed)return Promise.resolve(null);
  const immediate=admit();if(immediate||closed||waiters.length>=24)return Promise.resolve(immediate);
  return new Promise(resolve=>{
   let timer;
   const done=release=>{clearTimeout(timer);req.off('aborted',abort);req.socket?.off('close',abort);const i=waiters.indexOf(entry);if(i>=0)waiters.splice(i,1);resolve(release);};
   const abort=()=>done(null),entry={grant:()=>done(admit()),abort};waiters.push(entry);
   timer=setTimeout(abort,15000);timer.unref();req.once('aborted',abort);req.socket?.once('close',abort);
  });
 }
 function fail(instance){
  if(worker!==instance)return;worker=null;
  if(active){clearTimeout(active.timer);active.reject(Error('INGEST_WORKER_FAILED'));active=null;}
  pending.splice(0).forEach(job=>job.reject(Error('INGEST_WORKER_FAILED')));
  // Only this worker's storage lock may be released after its thread has exited.
  void instance.terminate().then(async()=>{const file=path.join(rootDir,'ingest-owner.json');try{const owner=JSON.parse(await fs.promises.readFile(file,'utf8'));if(owner.pid===instance.pid&&owner.token===instance.ingestToken)await fs.promises.unlink(file);}catch{}});
 }
 function kick(){
  if(closed||active||!pending.length)return;
  if(!worker){const token=crypto.randomUUID(),instance=launch(path.join(projectRoot,'lib/workDriveIngestWorker.cjs'),{projectRoot,token});worker=instance;instance.ingestToken=token;instance.unref();
   instance.on('error',()=>fail(instance));instance.on('exit',()=>fail(instance));
   instance.on('message',message=>{if(worker!==instance||!active||message.id!==active.id)return;const job=active;clearTimeout(job.timer);active=null;instance.unref();if(message.ok)job.resolve(message);else job.reject(Object.assign(Error(message.error),{status:message.status}));void pairs.drain();kick();});
  }
  active=pending.shift();const instance=worker;active.timer=setTimeout(()=>fail(instance),45000);active.timer.unref();worker.ref();worker.postMessage({id:active.id,input:active.input,type:active.type});
 }
 function ingest(input){if(closed)return Promise.reject(Error('INGEST_CLOSED'));if(pending.length>=maxAdmitted)return Promise.reject(Error('INGEST_BUSY'));return new Promise((resolve,reject)=>{pending.push({id:++sequence,input,resolve,reject});kick();});}
 function replayMirrors(){if(closed||active||pending.length)return Promise.resolve();return new Promise((resolve,reject)=>{pending.push({id:++sequence,type:'replayMirrors',resolve,reject});kick();});}
 const mirrorTimer=setInterval(()=>void replayMirrors().catch(()=>{}),5000);mirrorTimer.unref();void replayMirrors().catch(()=>{});
 async function close(){closed=true;for(const w of [...waiters])w.abort();clearInterval(mirrorTimer);pending.splice(0).forEach(job=>job.reject(Error('INGEST_CLOSED')));if(active){clearTimeout(active.timer);active.reject(Error('INGEST_CLOSED'));active=null;}const instance=worker;if(instance){fail(instance);await instance.terminate();}await pairs.close();}
 return {admit,acquire,ingest,close,replayMirrors,drainPairs:pairs.drain,status:()=>({admitted,waiting:waiters.length,active:!!active,pending:pending.length})};
}
function startDriveIngestService(){const key=Symbol.for('nenova.drive-ingest-service.v1');return globalThis[key]||(globalThis[key]=createDriveIngestService());}
module.exports={createDriveIngestService,startDriveIngestService};

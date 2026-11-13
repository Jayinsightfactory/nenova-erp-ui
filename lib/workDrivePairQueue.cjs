'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const QUEUE_MAX=256;
const queueDir=root=>path.join(root,'pair-jobs');
// Called while the shared ingest lock is held. Markers contain no file metadata.
function enqueuePairJob(root){
 const dir=queueDir(root);fs.mkdirSync(dir,{recursive:true});
 if(fs.readdirSync(dir).filter(n=>n.endsWith('.job')).length>=QUEUE_MAX)throw Object.assign(Error('PAIR_QUEUE_BUSY'),{status:503});
 const target=path.join(dir,crypto.randomUUID()+'.job'),fd=fs.openSync(target,'wx',0o600);
 try{fs.writeFileSync(fd,'1\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return target;
}
function createPairQueue({rootDir,run,intervalMs=5000,onError=()=>{}}){
 let running=null,closed=false,timer;
 async function drain(){
  if(closed||running)return running;
  running=(async()=>{
   const dir=queueDir(rootDir);
   let jobs;try{jobs=(await fs.promises.readdir(dir)).filter(n=>/^[a-f0-9-]+\.job$/.test(n));}catch(e){if(e.code==='ENOENT')return;throw e;}
   if(!jobs.length)return;
   // A marker can precede its index row. Never consume it while storage is active.
   try{
    const owner=JSON.parse(await fs.promises.readFile(path.join(rootDir,'ingest-owner.json'),'utf8'));
    if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)return;
    try{process.kill(owner.pid,0);return;}catch(e){if(e.code!=='ESRCH')return;}
   }catch(e){if(e.code!=='ENOENT')throw e;}
   await run();
   await Promise.all(jobs.map(n=>fs.promises.unlink(path.join(dir,n)).catch(e=>{if(e.code!=='ENOENT')throw e;})));
  })().catch(()=>onError('PAIR_JOB_RETRY')).finally(()=>{running=null;});
  return running;
 }
 function start(){if(timer||closed)return;timer=setInterval(()=>void drain(),intervalMs);timer.unref();void drain();}
 async function close(){closed=true;clearInterval(timer);await running;}
 return {start,drain,close};
}
module.exports={enqueuePairJob,createPairQueue,QUEUE_MAX};

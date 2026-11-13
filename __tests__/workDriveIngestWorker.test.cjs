const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {createDriveIngestService}=require('../lib/workDriveIngestAsync.cjs');
const {createPairQueue,enqueuePairJob,QUEUE_MAX}=require('../lib/workDrivePairQueue.cjs');
const projectRoot=process.cwd();
require('node:module').register(pathToFileURL(path.join(projectRoot,'scripts/work-drive-esm-loader.mjs')));
function fixture(){return fs.mkdtempSync(path.join(os.tmpdir(),'nenova-ingest-test-'));}
function cleanup(dir){if(!path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(dir).startsWith('nenova-ingest-test-'))throw Error('Unsafe fixture');fs.rmSync(dir,{recursive:true,force:true});}
test('real storage worker: bounded admission, ack after persistence, dedup/version, durable pair replay, timers and mirror contention',async()=>{
 const tmp=fixture(),prior=process.cwd();process.chdir(tmp);let service;
 try{
  service=createDriveIngestService({projectRoot,pairRun:async()=>{throw Error('fixture failure');}});
  const a=service.admit(),b=service.admit();assert(a&&b);assert.equal(service.admit(),null);a();a();assert(service.admit());b();
  const filepath=path.join(tmp,'fixture.bin');fs.writeFileSync(filepath,Buffer.alloc(12*1024*1024,41));let ticks=0;const timer=setInterval(()=>ticks++,1);
  const first=await service.ingest({filepath,filename:'2026 40-1 invoice.pdf',userName:'fixture'});clearInterval(timer);
  assert(first.result.ok&&!first.result.duplicate);assert(ticks>0);
  const drive=path.join(tmp,'data','drive'),rows=()=>fs.readFileSync(path.join(drive,'index.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows().length,1);assert.equal(fs.statSync(path.join(drive,rows()[0].rel)).size,12*1024*1024);
  const dup=await service.ingest({filepath,filename:'different.pdf',userName:'other'});assert(dup.result.duplicate);assert.equal(dup.result.id,first.result.id);assert.equal(rows().length,1);
  fs.writeFileSync(filepath,'new fixture version');const second=await service.ingest({filepath,filename:'2026 40-1 invoice.pdf',userName:'fixture'});assert.equal(second.result.version,2);
  await service.drainPairs();assert(fs.readdirSync(path.join(drive,'pair-jobs')).some(n=>n.endsWith('.job')),'failed background work remains durable');
  // Main-process mirror cannot wait synchronously on storage: its bytes must survive.
  const {mirrorWebUpload,acquireDriveIngestLock,releaseDriveIngestLock}=await import(pathToFileURL(path.join(projectRoot,'lib/workDrive.js')));
  const owner=acquireDriveIngestLock();assert(owner);
  const mirror=mirrorWebUpload({buffer:Buffer.from('mirror fixture'),filename:'mirror.txt',user:{userName:'fixture'},source:'test'});assert(mirror.ok&&mirror.queued);releaseDriveIngestLock(owner);
  await service.replayMirrors();assert(rows().some(r=>r.filename==='mirror.txt'));assert.equal(fs.readdirSync(path.join(drive,'mirror-jobs')).length,0);
  await service.close();service=null;
  // Fresh service discovers durable pair jobs without another upload.
  let runs=0;service=createDriveIngestService({projectRoot,pairRun:async()=>{runs++;}});await service.drainPairs();assert(runs>0);assert.equal(fs.readdirSync(path.join(drive,'pair-jobs')).length,0);
 }finally{if(service)await service.close();process.chdir(prior);cleanup(tmp);}
});
test('durable pair queue keeps crash-before-storage intent, retries errors, bounds admission and never consumes an active store',async()=>{
 const root=fixture();let queue;
 try{
  enqueuePairJob(root);fs.writeFileSync(path.join(root,'ingest-owner.json'),JSON.stringify({pid:process.pid,token:'fixture'}));let runs=0;
  queue=createPairQueue({rootDir:root,run:async()=>{runs++;}});await queue.drain();assert.equal(runs,0);
  fs.unlinkSync(path.join(root,'ingest-owner.json'));await queue.drain();assert.equal(runs,1);assert.equal(fs.readdirSync(path.join(root,'pair-jobs')).length,0);
  for(let i=0;i<QUEUE_MAX;i++)enqueuePairJob(root);assert.throws(()=>enqueuePairJob(root),/PAIR_QUEUE_BUSY/);
  await queue.close();queue=createPairQueue({rootDir:root,run:async()=>{throw Error('fixture');}});await queue.drain();assert.equal(fs.readdirSync(path.join(root,'pair-jobs')).length,QUEUE_MAX);
 }finally{if(queue)await queue.close();cleanup(root);}
});
test('actual process exit after storage leaves original and pair intent recoverable without another upload',async()=>{
 const root=fixture(),drive=path.join(root,'data','drive');let queue;
 try{
  const script=`const {pathToFileURL}=require('node:url'),path=require('node:path');const project=${JSON.stringify(projectRoot)};process.chdir(${JSON.stringify(root)});require('node:module').register(pathToFileURL(path.join(project,'scripts/work-drive-esm-loader.mjs')));(async()=>{const {ingestFile}=await import(pathToFileURL(path.join(project,'lib/workDrive.js')));const {enqueuePairJob}=require(path.join(project,'lib/workDrivePairQueue.cjs'));const result=ingestFile({buffer:Buffer.from('crash fixture'),filename:'invoice.pdf',userName:'fixture',beforeStore:()=>enqueuePairJob(path.join(process.cwd(),'data','drive'))});process.exit(result.ok?0:2);})().catch(()=>process.exit(3));`;
  const child=require('node:child_process').spawnSync(process.execPath,['-e',script],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
  const row=JSON.parse(fs.readFileSync(path.join(drive,'index.jsonl'),'utf8').trim());assert.equal(fs.readFileSync(path.join(drive,row.rel),'utf8'),'crash fixture');
  let recovered=0;queue=createPairQueue({rootDir:drive,run:async()=>{recovered++;}});await queue.drain();assert.equal(recovered,1);assert.equal(fs.readdirSync(path.join(drive,'pair-jobs')).length,0);
 }finally{if(queue)await queue.close();cleanup(root);}
});

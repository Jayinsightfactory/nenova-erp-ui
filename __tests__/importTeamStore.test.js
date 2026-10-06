import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readImportTeamRecord,writeImportTeamRecord,listImportTeamHistory,validateImportTeamKey} from '../lib/importTeamStore.js';

const actor={userId:'staff',userName:'Staff'};
const hash=key=>createHash('sha256').update(key).digest('hex');
const lockFile=(root,key)=>path.join(root,hash(key)+'.json.lock');
const ownerFile=(root,key,token)=>path.join(lockFile(root,key),'owner-'+token+'.json');
const doneFile=(root,key,token)=>path.join(lockFile(root,key),'done-'+token+'.json');

async function createLock(root,key,owner,{finished=false}={}) {
 await fs.mkdir(lockFile(root,key));
 await fs.writeFile(ownerFile(root,key,owner.token),JSON.stringify(owner));
 if(finished)await fs.writeFile(doneFile(root,key,owner.token),JSON.stringify({token:owner.token,pid:owner.pid,finishedAt:new Date().toISOString()}));
}

async function withRoot(run) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nenova-import-team-test-'));
 try{return await run(root);}finally{await fs.rm(root,{recursive:true,force:true});}
}

test('shared records preserve actor history, reject stale writes and isolate year/date',()=>withRoot(async root=>{
 const key='checklist.day.2026-10-06';
 assert.equal((await readImportTeamRecord(key,{root})).revision,0);
 const created=await writeImportTeamRecord(key,{expectedRevision:0,value:{task:true},actor},{root});
 assert.equal(created.commitStatus,'committed');
 await assert.rejects(writeImportTeamRecord(key,{expectedRevision:0,value:{task:false},actor},{root}),e=>e.statusCode===409);
 assert.deepEqual((await readImportTeamRecord(key,{root})).value,{task:true});
 assert.equal((await readImportTeamRecord('checklist.day.2025-10-06',{root})).value,null);
 await writeImportTeamRecord(key,{expectedRevision:1,value:null,actor},{root});
 const history=await listImportTeamHistory({root});assert.equal(history.length,2);assert(history.every(e=>e.userId==='staff'));
 const attempts=await Promise.allSettled([1,2].map(n=>writeImportTeamRecord('checklist.pending',{expectedRevision:0,value:[{id:'pending-'+n,text:'업무 '+n,done:false}],actor},{root})));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await readImportTeamRecord('checklist.pending',{root})).revision,1);
}));

test('history metadata stays bounded and evicted events are archived',()=>withRoot(async root=>{
 const key='checklist.day.2026-10-07';
 for(let revision=0;revision<501;revision+=1) {
  await writeImportTeamRecord(key,{expectedRevision:revision,value:{['task-'+revision]:true},actor},{root});
 }
 const record=await readImportTeamRecord(key,{root});
 assert.equal(record.revision,501);
 assert.equal(record.history.length,500);
 assert.equal(record.history[0].revision,2);
 assert.deepEqual(record.historyArchive,{eventCount:1,throughRevision:1});
 const archived=JSON.parse(await fs.readFile(path.join(root,'history',hash(key),'000000000001.json'),'utf8'));
 assert.equal(archived.revision,1);
 assert.equal(archived.userId,'staff');
 assert.equal((await listImportTeamHistory({root})).length,500);
}));

test('a live lock is never expired, while a proven dead or finished owner is recovered',()=>withRoot(async root=>{
 const liveKey='checklist.pending';
 const liveLock=lockFile(root,liveKey);
 await createLock(root,liveKey,{version:1,token:'live-owner',pid:process.pid,host:os.hostname(),createdAt:new Date(0).toISOString()});
 await assert.rejects(writeImportTeamRecord(liveKey,{expectedRevision:0,value:[],actor},{root}),e=>e.statusCode===409);
 assert.equal(JSON.parse(await fs.readFile(ownerFile(root,liveKey,'live-owner'),'utf8')).token,'live-owner');
 await fs.rm(liveLock,{recursive:true});

 const deadKey='checklist.flights';
 await createLock(root,deadKey,{version:1,token:'dead-owner',pid:2147483647,host:os.hostname(),createdAt:new Date(0).toISOString()});
 const flight=text=>[{id:'flight',text,llegado:false,banib:false}];
 const attempts=await Promise.allSettled(Array.from({length:8},(_,index)=>writeImportTeamRecord(deadKey,{expectedRevision:0,value:flight('일정 '+index),actor},{root})));
 assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
 assert.equal((await readImportTeamRecord(deadKey,{root})).revision,1);
 assert.equal((await writeImportTeamRecord(deadKey,{expectedRevision:1,value:flight('next'),actor},{root})).revision,2);

 const finishedKey='checklist.planting',token=randomUUID();
 await createLock(root,finishedKey,{version:1,token,pid:process.pid,host:os.hostname(),createdAt:new Date(0).toISOString()},{finished:true});
 assert.equal((await writeImportTeamRecord(finishedKey,{expectedRevision:0,value:[],actor},{root})).revision,1);
}));

test('a stale recovery snapshot cannot unlink a replacement owner directory',()=>withRoot(async root=>{
 const key='checklist.flights';
 await createLock(root,key,{version:1,token:'dead-owner',pid:2147483647,host:os.hostname(),createdAt:new Date(0).toISOString()});
 let announceStaleReader,announceReplacement;
 const staleReaderSeen=new Promise(resolve=>{announceStaleReader=resolve;});
 const replacementInstalled=new Promise(resolve=>{announceReplacement=resolve;});
 const flight=text=>[{id:'flight',text,llegado:false,banib:false}];
 const staleReader=writeImportTeamRecord(key,{expectedRevision:0,value:flight('stale-reader'),actor},{
  root,
  _lockHooks:{afterRead:async state=>{
   if(state.kind==='owned'&&state.owner.token==='dead-owner'){
    announceStaleReader();
    await replacementInstalled;
   }
  }}
 });
 await staleReaderSeen;
 const replacement=writeImportTeamRecord(key,{expectedRevision:0,value:flight('replacement'),actor},{
  root,
  _lockHooks:{afterInstall:()=>announceReplacement()}
 });
 const attempts=await Promise.allSettled([staleReader,replacement]);
 assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
 assert.equal((await readImportTeamRecord(key,{root})).revision,1);
 assert.equal((await writeImportTeamRecord(key,{expectedRevision:1,value:flight('after-race'),actor},{root})).revision,2);
}));

test('an unreadable lock is preserved instead of being guessed stale',()=>withRoot(async root=>{
 const key='checklist.pending',lock=lockFile(root,key);
 await fs.mkdir(lock);
 await fs.writeFile(ownerFile(root,key,'corrupt-owner'),'not valid lock metadata');
 await assert.rejects(writeImportTeamRecord(key,{expectedRevision:0,value:[],actor},{root}),e=>e.statusCode===500);
 assert.equal(await fs.readFile(ownerFile(root,key,'corrupt-owner'),'utf8'),'not valid lock metadata');
}));

test('a committed write remains a success when lock cleanup reports failure',()=>withRoot(async root=>{
 const warning={code:'LOCK_RELEASE_FAILED',message:'test cleanup failure'};
 const result=await writeImportTeamRecord('checklist.vacations.2026',{expectedRevision:0,value:[],actor},{root,_releaseLock:async()=>warning});
 assert.equal(result.commitStatus,'committed');
 assert.deepEqual(result.cleanupWarning,warning);
 assert.equal((await readImportTeamRecord('checklist.vacations.2026',{root})).revision,1);
}));

test('invalid paths, dates and oversized object keys are rejected',async()=>{
 for(const key of ['../../env','checklist.day.2026-02-30','checklist.month.2026-13','nenova_api_key'])assert.throws(()=>validateImportTeamKey(key));
 await withRoot(root=>assert.rejects(writeImportTeamRecord('packing.aliases',{expectedRevision:0,value:{['x'.repeat(513)]:'item'},actor},{root}),e=>e.statusCode===400));
});

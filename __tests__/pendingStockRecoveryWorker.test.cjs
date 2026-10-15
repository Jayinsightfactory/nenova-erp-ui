const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {createJournal,startRecoveryWorker} = require('../lib/pendingStockRecoveryWorker.cjs');
const scope = {orderYear:'2026',orderWeek:'40-02',ownerToken:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',lockedAt:'2026-10-15T09:14:31.200Z',action:'FIX'};
const retryFile = value => 'retry-'+require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex')+'.json';
function setup(options={}) {
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pending-worker-')), children=[];
 const journal=createJournal(directory);
 const worker=startRecoveryWorker({directory,journal,intervalMs:100000, forkFn:(file,args,opts)=>{
  assert(file.endsWith('pending-stock-recovery-child.cjs'));assert.equal(opts.windowsHide,true);
  const child=new EventEmitter();child.sent=[];child.send=value=>child.sent.push(value);child.kill=()=>{child.killed=true;};children.push(child);return child;
 },...options});
 return {directory,journal,worker,children,async cleanup(){if(worker.active())children.at(-1).emit('close',1,'SIGKILL');await worker.stop();fs.rmSync(directory,{recursive:true,force:true});}};
}
test('only one child; durable attempt precedes allow; success records scope and clears retry',async()=>{
 const s=setup();try{s.worker.tick();s.worker.tick();assert.equal(s.children.length,1);const c=s.children[0];c.emit('message',{type:'candidate',scope});assert.equal(c.sent[0].allow,true);assert.equal(s.journal.read(retryFile(scope)).attempts,1);assert(fs.readFileSync(path.join(s.directory,'attempts.jsonl'),'utf8').includes('started'));const other={...scope,ownerToken:'other-token'};s.journal.save(retryFile(other),{attempts:3});c.emit('message',{type:'result',result:{status:'recovered',scope}});c.emit('close',0,null);assert.deepEqual(s.journal.read(retryFile(scope)),{});assert.equal(s.journal.read(retryFile(other)).attempts,3);}finally{await s.cleanup();}
});
test('same pending token backoff and five-attempt cap; new token can proceed',async()=>{
 let now=0;const s=setup({now:()=>now});try{
 for(let i=0;i<5;i++){s.worker.tick();const c=s.children.at(-1);c.emit('message',{type:'candidate',scope});assert.equal(c.sent[0].allow,true);c.emit('message',{type:'result',result:{status:'failed',code:'FIXTURE'}});c.emit('close',1,null);now+=300001;}
 s.worker.tick();let c=s.children.at(-1);c.emit('message',{type:'candidate',scope});assert.equal(c.sent[0].allow,false);c.emit('message',{type:'result',result:{status:'skipped'}});c.emit('close',0,null);
 s.worker.tick();c=s.children.at(-1);c.emit('message',{type:'candidate',scope:{...scope,ownerToken:'new-token'}});assert.equal(c.sent[0].allow,true);c.emit('close',1,null);
 }finally{await s.cleanup();}
});
test('deadline kills isolated process but does not overlap until confirmed close',async()=>{
 const s=setup({deadlineMs:15});try{s.worker.tick();await new Promise(r=>setTimeout(r,30));assert.equal(s.children[0].killed,true);s.worker.tick();assert.equal(s.children.length,1);s.children[0].emit('close',null,'SIGKILL');s.worker.tick();assert.equal(s.children.length,2);}finally{await s.cleanup();}
});
test('journal failure denies native calculation',async()=>{
 const s=setup({journal:{read:()=>({}),append:()=>{throw Error('disk');},save:()=>{throw Error('disk');}}});try{s.worker.tick();const c=s.children[0];c.emit('message',{type:'candidate',scope});assert.equal(c.sent[0].allow,false);}finally{await s.cleanup();}
});

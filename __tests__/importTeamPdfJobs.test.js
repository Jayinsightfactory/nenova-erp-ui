import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {startPackingPdfJob,getPackingPdfJob,markPackingPdfAttempt,finishPackingPdfJob,findPackingPdfJobByKey,packingPdfMutationAddress,PDF_JOB_TIMEOUT_MS} from '../lib/importTeamPdfJobs.js';

const key='a'.repeat(64),otherKey='b'.repeat(64);
async function tempRoot(fn) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pdf-jobs-'));
  try{return await fn(root);}finally{await fs.rm(root,{recursive:true,force:true});}
}
async function simulateDead(root){
  const dir=path.join(root,(await fs.readdir(root))[0]),file=path.join(dir,'active.lock');
  const lock=JSON.parse(await fs.readFile(file,'utf8'));
  await fs.writeFile(file,JSON.stringify({...lock,pid:99999999}));
}

test('concurrent same-key admission creates one job; different key is BUSY',()=>tempRoot(async root=>{
  const opts={root,now:1000};
  const calls=await Promise.all(Array.from({length:8},()=>startPackingPdfJob('alice',key,opts)));
  assert.equal(calls.filter(call=>call.kind==='CREATED').length,1);
  const id=calls[0].job.jobId;
  assert(calls.every(call=>call.job?.jobId===id));
  assert.equal((await startPackingPdfJob('alice',otherKey,opts)).kind,'BUSY');
  assert.equal((await startPackingPdfJob('bob',otherKey,opts)).kind,'CREATED');
  assert.equal(await getPackingPdfJob('bob',id,opts),null);
  const owner=calls.find(call=>call.kind==='CREATED');
  assert.equal(await markPackingPdfAttempt('alice',id,owner.token,opts),true);
  assert.equal(await markPackingPdfAttempt('alice',id,owner.token,opts),false);
  const result={content:[{type:'text',text:'{}'}],stop_reason:'end_turn',source:'ai',cacheSaved:true};
  assert.equal((await finishPackingPdfJob('alice',id,owner.token,{result},opts)).status,'SUCCEEDED');
  assert.deepEqual(await getPackingPdfJob('alice',id,opts),{jobId:id,status:'SUCCEEDED',result});
  assert.deepEqual(await findPackingPdfJobByKey('alice',key,opts),{jobId:id,status:'SUCCEEDED',result});
  assert.equal((await startPackingPdfJob('alice',key,opts)).kind,'TERMINAL');
  assert.equal((await startPackingPdfJob('alice',otherKey,opts)).kind,'CREATED');
}));

test('live overdue owner stays RUNNING; dead attempted owner becomes uncertain',()=>tempRoot(async root=>{
  const opts={root,now:1000};
  const started=await startPackingPdfJob('alice',key,opts),id=started.job.jobId;
  await markPackingPdfAttempt('alice',id,started.token,opts);
  assert.equal((await getPackingPdfJob('alice',id,{root,now:1000+PDF_JOB_TIMEOUT_MS+1})).status,'RUNNING');
  await simulateDead(root);
  const failed=await getPackingPdfJob('alice',id,{root,now:1000+PDF_JOB_TIMEOUT_MS+2});
  assert.equal(failed.status,'FAILED');assert.equal(failed.error.code,'PDF_ANALYSIS_UNCERTAIN');assert.equal(failed.error.retryJobId,id);
  assert.equal((await startPackingPdfJob('alice',key,{root,now:1000+PDF_JOB_TIMEOUT_MS+3})).kind,'TERMINAL');
  const successor=await startPackingPdfJob('alice',key,{root,now:1000+PDF_JOB_TIMEOUT_MS+4,retryJobId:id});
  assert.equal(successor.kind,'CREATED');
  assert.equal(await finishPackingPdfJob('alice',id,started.token,{result:{content:[]}},{root}),null);
  assert.equal((await getPackingPdfJob('alice',successor.job.jobId,{root,now:1000+PDF_JOB_TIMEOUT_MS+5})).status,'RUNNING');
}));

test('dead pre-dispatch owner is known failure, invalid IDs and users stay hidden',()=>tempRoot(async root=>{
  const started=await startPackingPdfJob('alice',key,{root,now:1000});
  await simulateDead(root);
  const failed=await getPackingPdfJob('alice',started.job.jobId,{root,now:1000+PDF_JOB_TIMEOUT_MS+1});
  assert.equal(failed.status,'FAILED');assert.equal(failed.error.code,undefined);
  assert.equal((await startPackingPdfJob('alice',key,{root,now:1000+PDF_JOB_TIMEOUT_MS+2})).kind,'CREATED');
  assert.equal(await getPackingPdfJob('bob',started.job.jobId,{root}),null);
  assert.equal(await getPackingPdfJob('alice','../active.lock',{root}),null);
}));

test('cleanup never removes a RUNNING record even when old',()=>tempRoot(async root=>{
  const first=await startPackingPdfJob('alice',key,{root});
  await finishPackingPdfJob('alice',first.job.jobId,first.token,{error:{message:'known failure'}},{root});
  const dir=path.join(root,(await fs.readdir(root))[0]),id=randomUUID(),file=path.join(dir,`${id}.json`);
  await fs.writeFile(file,JSON.stringify({jobId:id,key:otherKey,status:'RUNNING',createdAt:1000,updatedAt:1000,deadline:2000}));
  await fs.utimes(file,new Date(1000),new Date(1000));
  const next=await startPackingPdfJob('alice','c'.repeat(64),{root});
  assert.equal(next.kind,'CREATED');
  assert.equal((await fs.stat(file)).isFile(),true);
}));

test('storage failure fails closed before a job is created',()=>tempRoot(async root=>{
  const blocked=path.join(root,'blocked');await fs.writeFile(blocked,'not a directory');
  await assert.rejects(()=>startPackingPdfJob('alice',key,{root:blocked}));
}));

test('GET reconciliation racing terminal write cannot overwrite a live owner success',()=>tempRoot(async root=>{
  const first=await startPackingPdfJob('alice',key,{root,now:1000});
  await markPackingPdfAttempt('alice',first.job.jobId,first.token,{root,now:1000});
  const [read,finish]=await Promise.all([
    getPackingPdfJob('alice',first.job.jobId,{root,now:1000+PDF_JOB_TIMEOUT_MS+1}),
    finishPackingPdfJob('alice',first.job.jobId,first.token,{result:{content:[1]}},{root,now:1000+PDF_JOB_TIMEOUT_MS+1})
  ]);
  assert(['RUNNING','SUCCEEDED'].includes(read.status));
  assert.equal(finish.status,'SUCCEEDED');
  assert.equal((await getPackingPdfJob('alice',first.job.jobId,{root,now:1000+PDF_JOB_TIMEOUT_MS+2})).status,'SUCCEEDED');
}));

test('OS mutex fails closed while another process owns it, then kernel releases on kill',{skip:!['win32','linux'].includes(process.platform)},()=>tempRoot(async root=>{
  const dir=path.join(root,createHash('sha256').update('alice').digest('hex'));
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'operations.guard'),'legacy dead guard');
  await fs.writeFile(path.join(dir,'operations.recovery'),'legacy dead recovery');
  const address=await packingPdfMutationAddress('alice',{root});
  assert.equal(process.platform==='win32'?address.startsWith('\\\\.\\pipe\\'):address.startsWith('\0'),true);
  const moduleUrl=new URL('../lib/importTeamPdfJobs.js',import.meta.url).href;
  const script="const net=require('node:net');(async()=>{const jobs=await import(process.argv[1]);const address=await jobs.packingPdfMutationAddress('alice',{root:process.argv[2]});const server=net.createServer(socket=>socket.destroy());server.listen({path:address,exclusive:true},()=>process.stdout.write('READY\\n'));})().catch(error=>{process.stderr.write(String(error));process.exitCode=1});";
  const child=spawn(process.execPath,['-e',script,moduleUrl,root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{
      child.once('exit',code=>reject(Error(`holder exited ${code}`)));
      child.stdout.once('data',chunk=>String(chunk).includes('READY')?resolve():reject(Error(`holder output ${chunk}`)));
    });
    await assert.rejects(()=>startPackingPdfJob('alice',key,{root}),error=>error.code==='JOB_STORAGE_BUSY');
    const exited=once(child,'exit');child.kill();await exited;
    const successor=await startPackingPdfJob('alice',key,{root});
    assert.equal(successor.kind,'CREATED');
    assert.equal((await getPackingPdfJob('alice',successor.job.jobId,{root})).status,'RUNNING');
  }finally{if(child.exitCode===null)child.kill();}
}));

test('durable terminal result clears a leftover active lock without another provider attempt',()=>tempRoot(async root=>{
  const first=await startPackingPdfJob('alice',key,{root});
  await finishPackingPdfJob('alice',first.job.jobId,first.token,{result:{content:[]}},{root});
  const dir=path.join(root,(await fs.readdir(root))[0]);
  await fs.writeFile(path.join(dir,'active.lock'),JSON.stringify({jobId:first.job.jobId,key,pid:process.pid,token:first.token}));
  const next=await startPackingPdfJob('alice',otherKey,{root});
  assert.equal(next.kind,'CREATED');
  assert.notEqual(next.job.jobId,first.job.jobId);
}));

test('rapid successive owner close/rebind never turns an admitted job into a pre-dispatch failure',()=>tempRoot(async root=>{
  for(let i=0;i<60;i++){
    const nextKey=i.toString(16).padStart(64,'0');
    const admitted=await startPackingPdfJob('alice',nextKey,{root});
    assert.equal(admitted.kind,'CREATED');
    assert.equal(await markPackingPdfAttempt('alice',admitted.job.jobId,admitted.token,{root}),true);
    const result=await finishPackingPdfJob('alice',admitted.job.jobId,admitted.token,{result:{content:[]}},{root});
    assert.equal(result.status,'SUCCEEDED');
  }
}));

test('Windows transient EPERM replacing a job record retries without losing the durable result',{skip:process.platform!=='win32'},()=>tempRoot(async root=>{
  const admitted=await startPackingPdfJob('alice',key,{root});
  const originalRename=fs.rename;
  let denied=0;
  fs.rename=async(from,to)=>{
    if(!denied&&to.endsWith(`${admitted.job.jobId}.json`)){
      denied++;
      throw Object.assign(Error('simulated open reader'),{code:'EPERM'});
    }
    return originalRename(from,to);
  };
  try{
    assert.equal(await markPackingPdfAttempt('alice',admitted.job.jobId,admitted.token,{root}),true);
    const finished=await finishPackingPdfJob('alice',admitted.job.jobId,admitted.token,{result:{content:[]}},{root});
    assert.equal(finished.status,'SUCCEEDED');
    assert.equal((await getPackingPdfJob('alice',admitted.job.jobId,{root})).status,'SUCCEEDED');
    assert.equal(denied,1);
  }finally{fs.rename=originalRename;}
}));

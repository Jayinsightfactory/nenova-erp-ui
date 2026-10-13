import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';

export const PDF_JOB_TIMEOUT_MS=10*60*1000;
const TTL=30*24*60*60*1000,MAX_BYTES=5*1024*1024,MAX_JOBS=100;
const defaultRoot=path.join(process.cwd(),'data/runtime/import-team/pdf-jobs');
const instanceId=randomUUID();
const userDir=(uid,root)=>path.join(root,createHash('sha256').update(String(uid)).digest('hex'));
const validId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const validKey=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const jobPath=(dir,id)=>path.join(dir,`${id}.json`);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function alive(pid) {
  if(!Number.isSafeInteger(pid)||pid<=0)return true; // Unknown owner: fail closed.
  try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}
}
async function readJson(file) {
  try{
    if((await fs.stat(file)).size>MAX_BYTES)throw Error('Oversized PDF job record');
    return JSON.parse(await fs.readFile(file,'utf8'));
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function atomicJson(file,value) {
  const json=JSON.stringify(value);
  if(Buffer.byteLength(json)>MAX_BYTES)throw Error('PDF job record is too large');
  const tmp=`${file}.${randomUUID()}.tmp`;
  try{await fs.writeFile(tmp,json,{flag:'wx',mode:0o600});await fs.rename(tmp,file);}
  finally{await fs.unlink(tmp).catch(()=>{});}
}
// Same-host PM2 workers share this OS-owned address. It is not a distributed lock.
// Abstract Unix sockets and Windows named pipes leave no filesystem lock to recover.
async function mutationAddress(dir){
  const physical=path.normalize(await fs.realpath(dir));
  const canonical=process.platform==='win32'?physical.toLowerCase():physical;
  const name=`nenova-pdf-job-${createHash('sha256').update(canonical).digest('hex')}`;
  if(process.platform==='win32')return `\\\\.\\pipe\\${name}`;
  if(process.platform==='linux')return `\0${name}`;
  throw Object.assign(Error('PDF job mutex is unsupported on this platform'),{code:'JOB_MUTEX_UNSUPPORTED'});
}
export const packingPdfMutationAddress=(uid,{root=defaultRoot}={})=>mutationAddress(userDir(uid,root));
async function guarded(dir,fn) {
  const address=await mutationAddress(dir);
  const deadline=Date.now()+1500;
  let owner,sockets;
  while(Date.now()<deadline){
    const connections=new Set();
    const candidate=net.createServer(socket=>{
      connections.add(socket);socket.once('close',()=>connections.delete(socket));socket.destroy();
    });
    const error=await new Promise(resolve=>{
      candidate.once('error',resolve);
      candidate.listen({path:address,exclusive:true},()=>resolve(null));
    });
    if(!error){owner=candidate;sockets=connections;break;}
    // Windows can report EACCES while the previous named-pipe listener closes.
    // A persistent denial still fails closed at the bounded deadline.
    if(error.code!=='EADDRINUSE'&&!(process.platform==='win32'&&error.code==='EACCES'))throw error;
    await sleep(10+Math.floor(Math.random()*15));
  }
  if(!owner)throw Object.assign(Error('PDF job admission is busy'),{code:'JOB_STORAGE_BUSY'});
  try{return await fn();}
  finally{
    for(const socket of sockets)socket.destroy();
    await new Promise((resolve,reject)=>owner.close(error=>error?reject(error):resolve()));
  }
}
function publicJob(row) {
  const result={jobId:row.jobId,status:row.status};
  if(row.status==='SUCCEEDED')result.result=row.result;
  if(row.status==='FAILED'){
    result.error={message:row.error?.message||'PDF 분석을 완료하지 못했습니다. 파일은 유지됩니다.'};
    if(row.error?.code==='PDF_ANALYSIS_UNCERTAIN'){
      result.error.code='PDF_ANALYSIS_UNCERTAIN';result.error.retryJobId=row.jobId;result.retryJobId=row.jobId;
    }
  }
  return result;
}
async function prune(dir,now) {
  const names=(await fs.readdir(dir)).filter(name=>name.endsWith('.json')&&validId(name.slice(0,-5)));
  const entries=(await Promise.all(names.map(async name=>{
    try{return {name,mtime:(await fs.stat(path.join(dir,name))).mtimeMs,row:await readJson(path.join(dir,name))};}catch{return null;}
  }))).filter(Boolean).sort((a,b)=>b.mtime-a.mtime);
  const terminal=entries.filter(entry=>entry.row?.status==='SUCCEEDED'||entry.row?.status==='FAILED');
  await Promise.all(terminal.filter((entry,index)=>index>=MAX_JOBS||now-entry.mtime>TTL).map(entry=>fs.unlink(path.join(dir,entry.name)).catch(()=>{})));
}
async function readLock(dir) {
  const file=path.join(dir,'active.lock');
  for(let i=0;i<20;i++){
    try{return await readJson(file);}catch(e){if(!(e instanceof SyntaxError))throw e;await sleep(10);}
  }
  throw Error('Unreadable PDF job lock');
}
async function latestForKey(dir,key,now) {
  let names;
  try{names=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  const matches=[];
  for(const name of names){
    if(!name.endsWith('.json')||!validId(name.slice(0,-5)))continue;
    const row=await readJson(path.join(dir,name));
    if(row?.key===key&&now-row.createdAt<=TTL&&['SUCCEEDED','FAILED'].includes(row.status))matches.push(row);
  }
  matches.sort((a,b)=>b.updatedAt-a.updatedAt);
  return matches[0]||null;
}
async function recoverDeadOwner(dir,lock,row,now) {
  if(!lock||alive(lock.pid))return false;
  if(row?.status==='RUNNING'){
    const attempted=Boolean(row.providerAttemptStartedAt);
    await atomicJson(jobPath(dir,row.jobId),{...row,status:'FAILED',updatedAt:now,error:{message:attempted?'PDF 분석 작업이 중단되어 호출 결과를 확인할 수 없습니다. 재호출하지 않습니다. 추가 비용을 확인하고 재시도하세요.':'PDF 분석 시작 전 작업이 중단되었습니다. 파일은 유지됩니다.',...(attempted?{code:'PDF_ANALYSIS_UNCERTAIN'}:{})}});
  }
  // The OS mutex excludes new owners while this fixed lock is quarantined.
  const quarantine=path.join(dir,`${lock.jobId}.${randomUUID()}.stale`);
  await fs.rename(path.join(dir,'active.lock'),quarantine);
  if((await readJson(quarantine))?.token!==lock.token)throw Error('PDF job lock owner changed during recovery');
  await fs.unlink(quarantine);
  return true;
}
export async function getPackingPdfJob(uid,id,{root=defaultRoot,now=Date.now()}={}) {
  if(!validId(id))return null;
  const dir=userDir(uid,root),row=await readJson(jobPath(dir,id));
  if(!row||row.jobId!==id||!validKey(row.key)||!Number.isFinite(row.createdAt)||now-row.createdAt>TTL)return null;
  if(row.status==='RUNNING'&&row.deadline<=now){
    return guarded(dir,async()=>{
      const current=await readJson(jobPath(dir,id)),lock=await readLock(dir);
      if(current?.status==='RUNNING'&&lock?.jobId===id)await recoverDeadOwner(dir,lock,current,now);
      return publicJob(await readJson(jobPath(dir,id)));
    });
  }
  return publicJob(row);
}
export async function findPackingPdfJobByKey(uid,key,{root=defaultRoot,now=Date.now()}={}) {
  if(!validKey(key))throw Error('Invalid PDF job key');
  const row=await latestForKey(userDir(uid,root),key,now);
  return row?publicJob(row):null;
}
export async function startPackingPdfJob(uid,key,{root=defaultRoot,now=Date.now(),retryJobId=null}={}) {
  if(!validKey(key))throw Error('Invalid PDF job key');
  if(retryJobId!=null&&!validId(retryJobId))return {kind:'INVALID_RETRY'};
  const dir=userDir(uid,root);await fs.mkdir(dir,{recursive:true,mode:0o700});
  return guarded(dir,async()=>{
    const lock=await readLock(dir);
    if(lock){
      const current=validId(lock.jobId)?await readJson(jobPath(dir,lock.jobId)):null;
      if(current?.status==='RUNNING'){
        if(!alive(lock.pid))await recoverDeadOwner(dir,lock,current,now);
        else return retryJobId?{kind:'INVALID_RETRY'}:current.key===key?{kind:'REUSED',job:publicJob(current)}:{kind:'BUSY'};
      }else if(current&&['SUCCEEDED','FAILED'].includes(current.status)&&current.owner?.token===lock.token){
        // A terminal result is durable; a failed prior unlink must not block the account.
        await fs.unlink(path.join(dir,'active.lock'));
      }else if(!alive(lock.pid))await recoverDeadOwner(dir,lock,current,now);
      else return {kind:'BUSY'};
    }
    const prior=await latestForKey(dir,key,now);
    if(retryJobId&&(!prior||prior.jobId!==retryJobId||prior.status!=='FAILED'))return {kind:'INVALID_RETRY'};
    if(prior){
      if(prior.status==='SUCCEEDED'||(prior.providerAttemptStartedAt&&!retryJobId))return {kind:'TERMINAL',job:publicJob(prior)};
    }
    const jobId=randomUUID(),token=randomUUID();
    const row={jobId,key,status:'RUNNING',createdAt:now,updatedAt:now,deadline:now+PDF_JOB_TIMEOUT_MS,owner:{pid:process.pid,instanceId,token}};
    const claim={jobId,key,deadline:row.deadline,pid:process.pid,instanceId,token};
    try{
      await fs.writeFile(path.join(dir,'active.lock'),JSON.stringify(claim),{flag:'wx',mode:0o600});
      await atomicJson(jobPath(dir,jobId),row);
      await prune(dir,now);
      return {kind:'CREATED',job:publicJob(row),token};
    }catch(e){
      const held=await readLock(dir).catch(()=>null);
      if(held?.token===token)await fs.unlink(path.join(dir,'active.lock')).catch(()=>{});
      await fs.unlink(jobPath(dir,jobId)).catch(()=>{});
      throw e;
    }
  });
}
export async function markPackingPdfAttempt(uid,id,token,{root=defaultRoot,now=Date.now()}={}) {
  const dir=userDir(uid,root);
  return guarded(dir,async()=>{
    const lock=await readLock(dir),row=await readJson(jobPath(dir,id));
    if(lock?.jobId!==id||lock.token!==token||row?.status!=='RUNNING'||row.owner?.token!==token||row.providerAttemptStartedAt)return false;
    await atomicJson(jobPath(dir,id),{...row,providerAttemptStartedAt:now,attemptId:randomUUID(),updatedAt:now});
    return true;
  });
}
export async function finishPackingPdfJob(uid,id,token,{result,error},{root=defaultRoot,now=Date.now()}={}) {
  const dir=userDir(uid,root);
  return guarded(dir,async()=>{
    const lock=await readLock(dir),row=await readJson(jobPath(dir,id));
    if(lock?.jobId!==id||lock.token!==token||row?.status!=='RUNNING'||row.owner?.token!==token)return null;
    const terminal={...row,status:error?'FAILED':'SUCCEEDED',updatedAt:now};
    if(error)terminal.error={message:String(error.message||error),...(error.code?{code:error.code}:{})};
    else terminal.result=result;
    await atomicJson(jobPath(dir,id),terminal);
    await fs.unlink(path.join(dir,'active.lock'));
    return publicJob(terminal);
  });
}
export async function markPackingPdfCacheSaved(uid,id,token,{root=defaultRoot,now=Date.now()}={}) {
  const dir=userDir(uid,root);
  return guarded(dir,async()=>{
    const row=await readJson(jobPath(dir,id));
    if(row?.status!=='SUCCEEDED'||row.owner?.token!==token)return null;
    const updated={...row,updatedAt:now,result:{...row.result,cacheSaved:true}};
    await atomicJson(jobPath(dir,id),updated);
    return publicJob(updated);
  });
}

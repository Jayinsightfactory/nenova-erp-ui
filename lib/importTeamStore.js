import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const IMPORT_TEAM_ROOT = path.join(process.cwd(), 'data', 'runtime', 'import-team');
const KEYS = /^(packing\.(aliases|catalog)|checklist\.(pending|flights|planting|day\.\d{4}-\d{2}-\d{2}|month\.\d{4}-\d{2}|vacations\.\d{4}))$/;
const MAX_VALUE_BYTES = 5 * 1024 * 1024;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_OBJECT_KEY_BYTES = 512;
const MAX_HISTORY_FIELD_BYTES = 120;
const HISTORY_LIMIT = 500;
const LOCK_VERSION = 1;
const LOCK_RECOVERY_ATTEMPTS = 5;

export function validateImportTeamKey(key) {
  if (typeof key !== 'string' || !KEYS.test(key)) throw Object.assign(new Error('지원하지 않는 업무 저장 항목입니다.'), { statusCode:400 });
  if (key.includes('.day.')) {
    const date=key.slice(-10), d=new Date(date+'T00:00:00Z');
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==date) throw Object.assign(new Error('날짜를 확인하세요.'),{statusCode:400});
  }
  if (key.includes('.month.') && !/-(0[1-9]|1[0-2])$/.test(key)) throw Object.assign(new Error('월을 확인하세요.'),{statusCode:400});
  return key;
}

const fail=(message,statusCode)=>Object.assign(new Error(message),{statusCode});

export function validateImportTeamValue(key,value) {
  if(value===null)return;
  const object=value&&typeof value==='object'&&!Array.isArray(value);
  if(key==='packing.aliases'&&(!object||Object.entries(value).some(([k,v])=>!k.trim()||typeof v!=='string'||!v.trim())))throw fail('매칭표 형식을 확인하세요.',400);
  if(key==='packing.catalog'&&(!object||!Array.isArray(value.items)||value.items.some(v=>!v||typeof v.name!=='string'||!v.name.trim())))throw fail('품목 카탈로그 형식을 확인하세요.',400);
  if(/^checklist\.(day|month)\./.test(key)&&(!object||Object.values(value).some(v=>typeof v!=='boolean')))throw fail('체크 상태 형식을 확인하세요.',400);
  if(/^checklist\.(pending|flights|planting|vacations)/.test(key)&&!Array.isArray(value))throw fail('업무 목록 형식을 확인하세요.',400);
  const scan=(v,depth=0)=>{
    if(depth>20)throw fail('저장 자료 구조가 너무 깊습니다.',400);
    if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){
      if(['__proto__','constructor','prototype'].includes(k))throw fail('허용하지 않는 자료 필드입니다.',400);
      if(Buffer.byteLength(k)>MAX_OBJECT_KEY_BYTES)throw fail('자료 필드 이름이 너무 깁니다.',400);
      scan(x,depth+1);
    }
  };
  scan(value);
}

function keyHash(key) { return createHash('sha256').update(validateImportTeamKey(key)).digest('hex'); }
function fileFor(root,key) { return path.join(root,keyHash(key)+'.json'); }
function archiveDirFor(root,key) { return path.join(root,'history',keyHash(key)); }
function lockOwnerFile(lock,token) { return path.join(lock,'owner-'+token+'.json'); }
function lockFinishedFile(lock,token) { return path.join(lock,'done-'+token+'.json'); }

function validArchiveMetadata(value) {
  return value&&Number.isSafeInteger(value.eventCount)&&value.eventCount>=0&&Number.isSafeInteger(value.throughRevision)&&value.throughRevision>=0;
}

function validateStoredRecord(item,key) {
  if(!item||item.key!==key||!Number.isSafeInteger(item.revision)||item.revision<0||!Array.isArray(item.history))throw Error('invalid record');
  if(item.historyArchive!==undefined&&!validArchiveMetadata(item.historyArchive))throw Error('invalid history archive metadata');
  if(item.history.some(event=>!event||!Number.isSafeInteger(event.revision)||event.revision<1||typeof event.at!=='string'))throw Error('invalid history event');
}

async function readRaw(root,key) {
  try {
    const item=JSON.parse(await fs.readFile(fileFor(root,key),'utf8'));
    validateStoredRecord(item,key);
    return item;
  } catch(e) {
    if(e.code==='ENOENT') return {key,value:null,revision:0,history:[],historyArchive:{eventCount:0,throughRevision:0}};
    throw fail('저장 자료를 읽지 못했습니다. 덮어쓰지 않고 중단합니다.',500);
  }
}

export async function readImportTeamRecord(key,{root=IMPORT_TEAM_ROOT}={}) { return readRaw(root,validateImportTeamKey(key)); }

function clipUtf8(value,maxBytes) {
  const text=String(value);
  const bytes=Buffer.from(text);
  if(bytes.length<=maxBytes)return text;
  return bytes.subarray(0,Math.max(0,maxBytes-3)).toString('utf8').replace(/\uFFFD$/,'')+'…';
}

function summarizeChangedFields(before,after) {
  const a=before&&typeof before==='object'?before:{value:before},b=after&&typeof after==='object'?after:{value:after};
  const digest=createHash('sha256');
  const visibleFields=[];
  let changedCount=0,fieldsTruncated=false;
  const add=field=>{
    const visible=clipUtf8(field,MAX_HISTORY_FIELD_BYTES);
    changedCount+=1;
    digest.update(String(Buffer.byteLength(field))).update(':').update(field).update(';');
    if(visibleFields.length<30)visibleFields.push(visible);else fieldsTruncated=true;
    if(visible!==field)fieldsTruncated=true;
  };
  for(const field in a)if(Object.prototype.hasOwnProperty.call(a,field)&&JSON.stringify(a[field])!==JSON.stringify(b[field]))add(field);
  for(const field in b)if(Object.prototype.hasOwnProperty.call(b,field)&&!Object.prototype.hasOwnProperty.call(a,field))add(field);
  return {visibleFields,changedCount,fieldsTruncated,digest:fieldsTruncated?digest.digest('hex'):null};
}

function buildHistoryEvent(key,revision,current,value,actor) {
  const fields=summarizeChangedFields(current.value,value);
  return {
    key,
    revision,
    at:new Date().toISOString(),
    userId:clipUtf8(actor.userId,160),
    userName:clipUtf8(actor.userName||actor.userId,160),
    action:value===null?'초기화':current.revision?'수정':'등록',
    beforeCount:count(current.value),
    afterCount:count(value),
    changedCount:fields.changedCount,
    changedFields:fields.visibleFields,
    ...(fields.fieldsTruncated?{changedFieldsTruncated:true,changedFieldsDigest:fields.digest}:{})
  };
}

async function writeExclusiveJson(filename,value) {
  const temporary=filename+'.'+randomUUID()+'.candidate';
  await fs.writeFile(temporary,JSON.stringify(value),{encoding:'utf8',mode:0o600,flag:'wx'});
  try {
    await fs.link(temporary,filename);
    return true;
  } catch(e) {
    if(e.code==='EEXIST')return false;
    throw e;
  } finally {
    await fs.unlink(temporary).catch(()=>{});
  }
}

async function archiveHistoryEvents(root,key,events) {
  if(!events.length)return;
  const directory=archiveDirFor(root,key);
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  for(const event of events) {
    if(!Number.isSafeInteger(event.revision)||event.revision<1)throw fail('수정 이력 자료가 손상되어 저장을 중단합니다.',500);
    const filename=path.join(directory,String(event.revision).padStart(12,'0')+'.json');
    const serialized=JSON.stringify(event);
    const created=await writeExclusiveJson(filename,event);
    if(!created) {
      const existing=await fs.readFile(filename,'utf8');
      if(existing!==serialized)throw fail('수정 이력 보관 자료가 충돌하여 저장을 중단합니다.',500);
    }
  }
}

function validLockOwner(owner) {
  return owner&&owner.version===LOCK_VERSION&&typeof owner.token==='string'&&owner.token.length>0&&Number.isSafeInteger(owner.pid)&&owner.pid>0&&typeof owner.host==='string'&&owner.host.length>0;
}

function tokenFromFilename(name,prefix) {
  const match=new RegExp('^'+prefix+'-([A-Za-z0-9-]{1,100})\\.json$').exec(name);
  return match?.[1]||null;
}

async function readLockState(lock) {
  let entries;
  try {
    entries=await fs.readdir(lock,{withFileTypes:true});
  } catch(e) {
    if(e.code==='ENOENT')return {kind:'missing'};
    throw fail('공동 저장 잠금 정보를 확인할 수 없습니다. 잠금을 임의 해제하지 않습니다.',500);
  }
  if(entries.some(entry=>!entry.isFile()))throw fail('공동 저장 잠금 정보를 확인할 수 없습니다. 잠금을 임의 해제하지 않습니다.',500);
  if(entries.length===0)return {kind:'empty'};
  const ownerEntries=entries.filter(entry=>tokenFromFilename(entry.name,'owner'));
  if(ownerEntries.length>1)throw fail('공동 저장 잠금 정보를 확인할 수 없습니다. 잠금을 임의 해제하지 않습니다.',500);
  if(ownerEntries.length===1) {
    const ownerToken=tokenFromFilename(ownerEntries[0].name,'owner');
    let owner;
    try { owner=JSON.parse(await fs.readFile(lockOwnerFile(lock,ownerToken),'utf8')); }
    catch(e) { throw fail('공동 저장 잠금 정보를 확인할 수 없습니다. 잠금을 임의 해제하지 않습니다.',500); }
    if(!validLockOwner(owner)||owner.token!==ownerToken)throw fail('공동 저장 잠금 정보를 확인할 수 없습니다. 잠금을 임의 해제하지 않습니다.',500);
    const allowed=new Set(['owner-'+ownerToken+'.json','done-'+ownerToken+'.json']);
    if(entries.some(entry=>!allowed.has(entry.name)))throw fail('공동 저장 잠금 정보를 확인할 수 없습니다. 잠금을 임의 해제하지 않습니다.',500);
    let finished=false;
    if(entries.some(entry=>entry.name==='done-'+ownerToken+'.json')) {
      try {
        const marker=JSON.parse(await fs.readFile(lockFinishedFile(lock,ownerToken),'utf8'));
        finished=marker?.token===ownerToken&&marker?.pid===owner.pid;
      } catch(e) {
        finished=false;
      }
    }
    return {kind:'owned',owner,finished};
  }
  if(entries.length===1) {
    const token=tokenFromFilename(entries[0].name,'done');
    if(token) {
      try {
        const marker=JSON.parse(await fs.readFile(lockFinishedFile(lock,token),'utf8'));
        if(marker?.token===token&&Number.isSafeInteger(marker?.pid)&&marker.pid>0)return {kind:'finished',token,marker};
      } catch(e) {}
    }
  }
  throw fail('공동 저장 잠금 정보를 확인할 수 없습니다. 잠금을 임의 해제하지 않습니다.',500);
}

async function ownerIsAlive(owner) {
  if(owner.host!==os.hostname())return true;
  try {
    process.kill(owner.pid,0);
    return true;
  } catch(e) {
    if(e.code==='ESRCH')return false;
    if(e.code==='EPERM')return true;
    throw e;
  }
}

async function installLockDirectory(lock,owner) {
  const candidate=lock+'.candidate.'+owner.token;
  const candidateOwner=lockOwnerFile(candidate,owner.token);
  await fs.mkdir(candidate,{mode:0o700});
  try {
    await fs.writeFile(candidateOwner,JSON.stringify(owner),{encoding:'utf8',mode:0o600,flag:'wx'});
    try {
      await fs.rename(candidate,lock);
      return true;
    } catch(e) {
      if(e.code==='EEXIST'||e.code==='ENOTEMPTY')return false;
      if(e.code==='EPERM') {
        try { if((await fs.stat(lock)).isDirectory())return false; } catch(check) { if(check.code!=='ENOENT')throw check; }
      }
      throw e;
    }
  } finally {
    await fs.unlink(candidateOwner).catch(()=>{});
    await fs.rmdir(candidate).catch(()=>{});
  }
}

async function unlinkExact(filename) {
  try {
    await fs.unlink(filename);
    return true;
  } catch(e) {
    if(e.code==='ENOENT')return false;
    throw e;
  }
}

async function removeClaimedLockDirectory(lock,token) {
  await fs.unlink(lockFinishedFile(lock,token)).catch(e=>{if(e.code!=='ENOENT')throw e;});
  try {
    await fs.rmdir(lock);
    return true;
  } catch(e) {
    if(e.code==='ENOENT')return true;
    if(e.code==='ENOTEMPTY'||e.code==='EEXIST')throw fail('공동 저장 잠금 안에 예상하지 못한 자료가 있어 임의 해제하지 않습니다.',500);
    throw e;
  }
}

async function recoverLock(lock,state) {
  if(state.kind==='empty') {
    try { await fs.rmdir(lock); return true; }
    catch(e) { if(e.code==='ENOENT')return true;if(e.code==='ENOTEMPTY'||e.code==='EEXIST')return false;throw e; }
  }
  if(state.kind==='finished') {
    if(!await unlinkExact(lockFinishedFile(lock,state.token)))return false;
    return removeClaimedLockDirectory(lock,state.token);
  }
  if(state.kind!=='owned')return false;
  if(!state.finished&&await ownerIsAlive(state.owner))return false;
  if(!await unlinkExact(lockOwnerFile(lock,state.owner.token)))return false;
  return removeClaimedLockDirectory(lock,state.owner.token);
}

async function acquireLock(lock,hooks) {
  const owner={version:LOCK_VERSION,token:randomUUID(),pid:process.pid,host:os.hostname(),createdAt:new Date().toISOString()};
  for(let attempt=0;attempt<LOCK_RECOVERY_ATTEMPTS;attempt+=1) {
    if(await installLockDirectory(lock,owner)) {
      await hooks?.afterInstall?.(owner);
      return owner;
    }
    const state=await readLockState(lock);
    await hooks?.afterRead?.(state);
    if(state.kind==='missing')continue;
    if(state.kind==='owned'&&!state.finished&&await ownerIsAlive(state.owner))throw fail('다른 직원의 저장 처리 중입니다. 잠시 후 다시 저장하세요.',409);
    if(await recoverLock(lock,state))continue;
  }
  throw fail('공동 저장 잠금이 변경되어 저장을 시작하지 못했습니다. 다시 시도하세요.',409);
}

async function markOwnerFinished(lock,owner) {
  const marker={token:owner.token,pid:owner.pid,finishedAt:new Date().toISOString()};
  const filename=lockFinishedFile(lock,owner.token);
  try {
    await fs.writeFile(filename,JSON.stringify(marker),{encoding:'utf8',mode:0o600,flag:'wx'});
  } catch(e) {
    if(e.code!=='EEXIST')throw e;
    const existing=JSON.parse(await fs.readFile(filename,'utf8'));
    if(existing?.token!==owner.token||existing?.pid!==owner.pid)throw Error('lock completion marker mismatch');
  }
  return filename;
}

async function releaseLock(lock,owner) {
  let marker;
  try {
    marker=await markOwnerFinished(lock,owner);
    if(!await unlinkExact(lockOwnerFile(lock,owner.token)))throw Error('lock owner was not claimed by releaser');
    await fs.unlink(marker);
    marker=null;
    await fs.rmdir(lock);
  } catch(e) {
    return {code:'LOCK_RELEASE_FAILED',message:'저장은 완료되었지만 잠금 정리가 지연되었습니다. 다음 저장 요청에서 완료 표식을 확인해 복구합니다.'};
  }
  return null;
}

export async function writeImportTeamRecord(key,{value,expectedRevision,actor},{root=IMPORT_TEAM_ROOT,_releaseLock=releaseLock,_lockHooks}={}) {
  validateImportTeamKey(key);
  if (!Number.isSafeInteger(expectedRevision)||expectedRevision<0) throw fail('자료 버전을 다시 조회하세요.',400);
  if (!actor?.userId) throw fail('로그인이 필요합니다.',401);
  if (value===undefined) throw fail('저장할 값이 없습니다.',400);
  validateImportTeamValue(key,value);
  const serialized=JSON.stringify(value);
  if(Buffer.byteLength(serialized)>MAX_VALUE_BYTES) throw fail('저장 자료는 5MB 이하여야 합니다.',413);
  await fs.mkdir(root,{recursive:true});
  const filename=fileFor(root,key), lock=filename+'.lock';
  const owner=await acquireLock(lock,_lockHooks);
  const temporary=filename+'.'+randomUUID()+'.tmp';
  let result,operationError,commitStatus='unchanged',temporaryWarning=null;
  try {
    const current=await readRaw(root,key);
    if(current.revision!==expectedRevision) throw fail('다른 직원이 먼저 수정했습니다. 새로고침하여 변경 내역을 확인하세요.',409);
    if(JSON.stringify(current.value)===serialized) {
      result=current;
    } else {
      const revision=current.revision+1;
      const event=buildHistoryEvent(key,revision,current,value,actor);
      const combined=[...current.history,event];
      const evicted=combined.slice(0,Math.max(0,combined.length-HISTORY_LIMIT));
      const history=combined.slice(-HISTORY_LIMIT);
      const previousArchive=validArchiveMetadata(current.historyArchive)?current.historyArchive:{eventCount:0,throughRevision:0};
      const historyArchive=evicted.length?{
        eventCount:previousArchive.eventCount+evicted.length,
        throughRevision:Math.max(previousArchive.throughRevision,...evicted.map(item=>item.revision))
      }:previousArchive;
      const next={key,value,revision,history,historyArchive};
      const nextSerialized=JSON.stringify(next);
      if(Buffer.byteLength(nextSerialized)>MAX_RECORD_BYTES)throw fail('수정 이력을 포함한 저장 자료가 너무 큽니다.',413);
      await archiveHistoryEvents(root,key,evicted);
      await fs.writeFile(temporary,nextSerialized,{encoding:'utf8',mode:0o600,flag:'wx'});
      await fs.rename(temporary,filename);
      result=next;
      commitStatus='committed';
    }
  } catch(e) {
    operationError=e;
  }
  try {
    await fs.unlink(temporary);
  } catch(e) {
    if(e.code!=='ENOENT')temporaryWarning={code:'TEMP_CLEANUP_FAILED',message:'임시 저장 파일 정리가 지연되었습니다.'};
  }
  let lockWarning=null;
  try {
    lockWarning=await _releaseLock(lock,owner);
  } catch(e) {
    lockWarning={code:'LOCK_RELEASE_FAILED',message:'잠금 정리가 지연되었습니다.'};
  }
  const cleanupWarning=temporaryWarning||lockWarning;
  if(operationError) {
    if(cleanupWarning)operationError.cleanupWarning=cleanupWarning;
    throw operationError;
  }
  return {...result,commitStatus,...(cleanupWarning?{cleanupWarning}:{})};
}

function count(value) { return Array.isArray(value)?value.length:value&&typeof value==='object'?Object.keys(value).length:value==null?0:1; }

export async function listImportTeamHistory({root=IMPORT_TEAM_ROOT}={}) {
  let names; try {names=await fs.readdir(root);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  const rows=[];
  for(const name of names.filter(n=>/^[a-f0-9]{64}\.json$/.test(n))) {
    const record=JSON.parse(await fs.readFile(path.join(root,name),'utf8'));
    validateStoredRecord(record,validateImportTeamKey(record.key));
    rows.push(...record.history);
  }
  return rows.sort((a,b)=>b.at.localeCompare(a.at)).slice(0,HISTORY_LIMIT);
}

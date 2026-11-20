import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { countryOrderHistoryScope, countryOrderHistoryScopeKey } from './countryOrderReconciliation.js';
import {acquireOwnerLock,releaseOwnerLock} from './personalHomeStore.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const error=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
const idOf=id=>{if(typeof id!=='string'||!UUID.test(id))throw error('INVALID_HISTORY_ID','이력 번호를 확인하세요.',400);return id;};
const actorOf=actor=>{if(typeof actor!=='string'||!actor.trim()||actor.length>128)throw error('MISSING_ACTOR','로그인이 필요합니다.',403);return hash(actor);};
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));

// Reuses the existing server-private runtime filesystem, not ERP tables or public/.
// Roots may be injected only by server/test construction; no request controls paths.
export function createCountryOrderHistoryStore({root=path.resolve('data/runtime/country-order-history'),now=()=>new Date()}={}) {
  const directory=scope=>path.join(root,hash(countryOrderHistoryScopeKey(scope)));
  async function readJson(file) {
    try {const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024)throw Error('invalid file');return JSON.parse(await fs.readFile(file,'utf8'));}
    catch(e){if(e.code==='ENOENT')return null;throw error('HISTORY_CORRUPT','발주 원본 이력을 읽지 못했습니다. 자동으로 다시 만들지 마세요.',500);}
  }
  async function publish(file,bytes) {
    const temporary=`${file}.${randomUUID()}.tmp`;
    try {const handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
      try{await fs.link(temporary,file);return true;}catch(e){if(e.code==='EEXIST')return false;throw e;}
    }finally{await fs.unlink(temporary).catch(()=>{});}
  }
  async function read(scope,id,metadataOnly=false) {
    const dir=directory(scope),record=await readJson(path.join(dir,`${idOf(id)}.json`));
    if(!record)throw error('HISTORY_NOT_FOUND','보관된 발주 원본이 없습니다.',404);
    if(record.version!==1||record.id!==id||countryOrderHistoryScopeKey(record.scope)!==countryOrderHistoryScopeKey(scope)||!stamp(record.downloadedAt)||!stamp(record.queriedAt)||!Array.isArray(record.rows)||!Array.isArray(record.sourceKeys))throw error('HISTORY_CORRUPT','이력 범위·형식을 확인하지 못했습니다.',500);
    const {version:_,id:recordId,digest,actorHash,downloadedAt,...content}=record;
    if(hash(JSON.stringify(content))!==digest)throw error('HISTORY_CORRUPT','보관된 행 snapshot 지문이 다릅니다.',500);
    const file=path.join(dir,`${id}.xlsx`),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==record.size)throw error('HISTORY_CORRUPT','보관된 Excel 크기가 다릅니다.',500);
    const bytes=metadataOnly?null:await fs.readFile(file);
    if(bytes&&hash(bytes)!==record.sha256)throw error('HISTORY_CORRUPT','보관된 Excel 해시가 다릅니다.',500);
    const delivery=await readJson(path.join(dir,`${id}.delivered.json`));
    if(delivery&&(delivery.version!==1||delivery.id!==id||delivery.sha256!==record.sha256||!stamp(delivery.deliveredAt)))throw error('HISTORY_CORRUPT','전달 이력 형식이 다릅니다.',500);
    return {...record,deliveredAt:delivery?.deliveredAt??null,bytes};
  }
  async function list(scope) {
    let names;try{names=await fs.readdir(directory(scope));}catch(e){if(e.code==='ENOENT')return [];throw e;}
    const result=[];
    for(const name of names.filter(name=>UUID.test(name.slice(0,-5))&&name.endsWith('.json'))){const {bytes,...record}=await read(scope,name.slice(0,-5),true);result.push(record);}
    return result.sort((a,b)=>b.downloadedAt.localeCompare(a.downloadedAt)||a.id.localeCompare(b.id));
  }
  async function save({scope,id,filename,bytes,rows,sourceKeys,queriedAt,actor,evidence=[],erpRows=rows,pendingSources=[],requestDigest=null,batchId=id,expectedFiles=[filename]}) {
    scope=countryOrderHistoryScope(scope);idOf(id);const actorHash=actorOf(actor);
    if(!Buffer.isBuffer(bytes)||bytes.length<4||bytes.length>5*1024*1024||bytes.readUInt32LE(0)!==0x04034b50||typeof filename!=='string'||!filename.endsWith('.xlsx')||/[\\/\x00-\x1f]/.test(filename)||filename.length>200||!Array.isArray(rows)||!Array.isArray(sourceKeys)||!stamp(queriedAt))throw error('INVALID_HISTORY','보관할 Excel·행·조회 시각을 확인하세요.',400);
    idOf(batchId);
    if(!Array.isArray(expectedFiles)||!expectedFiles.length||new Set(expectedFiles).size!==expectedFiles.length||!expectedFiles.includes(filename))throw error('INVALID_HISTORY','파일 세트를 확인하세요.',400);
    const content={scope,filename,sha256:hash(bytes),size:bytes.length,rows,sourceKeys,queriedAt,evidence,erpRows,pendingSources,requestDigest,batchId,expectedFiles};
    const digest=hash(JSON.stringify(content));
    const dir=directory(scope);await fs.mkdir(dir,{recursive:true,mode:0o700});
    const record={version:1,id,...content,digest,actorHash,downloadedAt:now().toISOString()};
    const encoded=JSON.stringify(record);
    if(Buffer.byteLength(encoded)>8*1024*1024)throw error('HISTORY_TOO_LARGE','이력 크기가 너무 큽니다.',413);
    // A directory claim serializes one explicit operation without replacing any bytes.
    const claim=path.join(dir,`${id}.claim`);
    try{await fs.mkdir(claim);}catch(e){if(e.code!=='EEXIST')throw e;
      const existing=await readJson(path.join(dir,`${id}.json`));
      if(!existing)throw error('HISTORY_PENDING','같은 보관 요청이 진행 중이거나 결과 확인이 필요합니다. 새 작업으로 다시 저장하지 마세요.');
      if(existing.digest!==digest)throw error('HISTORY_ID_CONFLICT','같은 작업 번호의 내용이 달라 저장하지 않았습니다.');
      return read(scope,id);
    }
    await publish(path.join(dir,`${id}.xlsx`),bytes);
    await publish(path.join(dir,`${id}.json`),encoded);
    return read(scope,id);
  }
  async function markDelivered({scope,id,sha256,actor,confirmed}) {
    const actorHash=actorOf(actor);
    if(confirmed!==true)throw error('CONFIRM_REQUIRED','농장 전달 완료를 명시적으로 확인하세요.',400);
    const original=await read(scope,id);
    if(original.sha256!==sha256)throw error('HISTORY_STALE','선택한 원본이 달라 전달 체크하지 않았습니다.');
    await publish(path.join(directory(scope),`${id}.delivered.json`),JSON.stringify({version:1,id,sha256,actorHash,deliveredAt:now().toISOString()}));
    return read(scope,id);
  }
  async function latestDelivered(scope) {return latestCompleteCountryOrderDelivery(await list(scope));}
  async function withScopeLock(scope,operation){const dir=directory(scope);await fs.mkdir(dir,{recursive:true,mode:0o700});const lock=path.join(dir,'scope.lock'),owner=await acquireOwnerLock(lock);try{return await operation();}finally{await releaseOwnerLock(lock,owner);}}
  return {read,list,save,markDelivered,latestDelivered,withScopeLock};
}
export function latestCompleteCountryOrderDelivery(history) {
  const batches=new Map();
  for(const record of history){const key=record.batchId??record.id;if(!batches.has(key))batches.set(key,[]);batches.get(key).push(record);}
  const complete=[];
  for(const records of batches.values()){
    const first=records[0],expected=first.expectedFiles??[first.filename];
    if(records.some(record=>JSON.stringify(record.expectedFiles??[record.filename])!==JSON.stringify(expected)))continue;
    const sent=expected.map(filename=>records.find(record=>record.filename===filename&&record.deliveredAt));
    if(sent.some(record=>!record))continue;
    if(sent.some(record=>JSON.stringify(record.rows)!==JSON.stringify(first.rows)||JSON.stringify(record.sourceKeys)!==JSON.stringify(first.sourceKeys)))continue;
    complete.push({...first,deliveredAt:sent.map(record=>record.deliveredAt).sort().at(-1)});
  }
  return complete.sort((a,b)=>b.deliveredAt.localeCompare(a.deliveredAt)||a.id.localeCompare(b.id))[0]??null;
}

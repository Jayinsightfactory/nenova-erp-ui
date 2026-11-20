import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const sha=value=>createHash('sha256').update(value).digest('hex');
const fail=(message,statusCode=422)=>{throw Object.assign(Error(message),{statusCode});};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const stable=value=>JSON.stringify(canonical(value));
const rootDefault=()=>path.join(process.cwd(),'data','cost-workbook-history','colombia-week');
function location({owner,scope,versionHash,root=rootDefault()}){
 if(typeof owner!=='string'||!owner.trim()||owner.length>200||scope?.country!=='CO'||!/^\d{4}$/.test(scope.orderYear??'')||!/^(?:0[1-9]|[1-4]\d|5[0-3])-(?:0[1-9]|[1-9]\d)$/.test(scope.orderWeek??'')||!/^[a-f0-9]{64}$/.test(versionHash??''))fail('통합 원가 보관 사용자·연도·차수·버전을 확인하세요.');
 const dir=path.join(root,sha(stable([owner,scope.country,scope.orderYear,scope.orderWeek])));
 return {dir,file:path.join(dir,`${versionHash}.json`)};
}
async function load(file,scope,versionHash){
 let saved;try{saved=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(saved.schema!==1||stable(saved.scope)!==stable(scope)||saved.versionHash!==versionHash||typeof saved.xlsx!=='string')fail('보관된 원가 버전의 범위가 일치하지 않습니다.',409);
 const bytes=Buffer.from(saved.xlsx,'base64');
 if(bytes.length!==saved.bytes||sha(bytes)!==saved.sha256)fail('보관된 원가 파일 무결성 검증에 실패했습니다.',409);
 return {bytes,metadata:{schema:saved.schema,scope:saved.scope,versionHash,sha256:saved.sha256,bytes:saved.bytes,createdAt:saved.createdAt,snapshot:saved.snapshot}};
}

/** Owner-scoped immutable file archive, not an ERP write. Each atomic envelope
 * contains the original XLSX and its exact row/input snapshot. No retention
 * deletion, historical overwrite, delivery status, or implicit recalculation.
 */
export async function readColombiaWeekCostVersion(options){
 const {file}=location(options);return load(file,options.scope,options.versionHash);
}
export async function listColombiaWeekCostVersions(options){
 const {dir}=location({...options,versionHash:'0'.repeat(64)});
 let files;try{files=await fs.readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const names=files.filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
 if(names.length>1000)fail('보관 버전이 많아 별도 조회가 필요합니다.',409);
 const rows=[];for(const name of names){const saved=await load(path.join(dir,name),options.scope,name.slice(0,-5));const {snapshot,...metadata}=saved.metadata;rows.push({...metadata,receiptCount:snapshot.rows?.length??null});}
 return rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.versionHash.localeCompare(b.versionHash));
}
export async function preserveColombiaWeekCostVersion(options){
 const {owner,scope,versionHash,snapshot,createWorkbook}=options;
 const {dir,file}=location(options);
 if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||typeof createWorkbook!=='function')fail('입고행·계산 입력 스냅샷과 생성 함수가 필요합니다.');
 const existing=await load(file,scope,versionHash);
 if(existing){if(stable(existing.metadata.snapshot)!==stable(snapshot))fail('같은 원가 버전에 다른 근거가 전달되었습니다.',409);return {...existing,reused:true};}
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const lockPath=path.join(dir,`${versionHash}.lock`);let lock;
 try{lock=await fs.open(lockPath,'wx',0o600);}catch(error){if(error.code==='EEXIST')fail('동일 원가 버전을 생성 중입니다. 자동 재시도 없이 완료 후 다시 확인하세요.',409);throw error;}
 let temporary;
 try{
  const raced=await load(file,scope,versionHash);
  if(raced){if(stable(raced.metadata.snapshot)!==stable(snapshot))fail('동일 버전 근거가 변경되었습니다.',409);return {...raced,reused:true};}
  const bytes=await createWorkbook();
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>12*1024*1024)fail('생성된 통합 원가 파일 크기를 확인하세요.');
  const envelope={schema:1,scope,versionHash,sha256:sha(bytes),bytes:bytes.length,createdAt:new Date().toISOString(),snapshot,xlsx:bytes.toString('base64')};
  temporary=path.join(dir,`${versionHash}.${randomUUID()}.tmp`);
  await fs.writeFile(temporary,JSON.stringify(envelope),{mode:0o600});
  // link is atomic and refuses an existing destination on Windows and Unix.
  // Readers never see a partial envelope and existing originals never change.
  await fs.link(temporary,file);
  return {...await load(file,scope,versionHash),reused:false};
 }finally{
  if(temporary)await fs.unlink(temporary).catch(()=>{});
  await lock.close();await fs.unlink(lockPath);
 }
}

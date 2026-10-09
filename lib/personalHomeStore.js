import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const PERSONAL_HOME_ROOT = path.join(process.cwd(), 'data/runtime/personal-home');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
export function homeDate(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value+'T00:00:00Z')) || new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) throw fail('날짜를 확인하세요.');
  return value;
}
export function kstHomeDate(now = new Date()) { return new Date(now.getTime()+9*3600000).toISOString().slice(0,10); }
const nextDay = date => new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
function ownerKey(owner) {
  if (typeof owner !== 'string' || !owner.trim() || owner.length>200 || /[\x00-\x1f\x7f]/.test(owner)) throw fail('로그인이 필요합니다.',401);
  return createHash('sha256').update(owner).digest('hex');
}
function title(value) { if(typeof value!=='string'||!value.trim()||value.trim().length>300||/[\x00-\x1f\x7f]/.test(value))throw fail('업무 제목은 1~300자로 입력하세요.');return value.trim(); }
function days(value) {if(!Array.isArray(value)||value.length>7||value.some(v=>!Number.isInteger(v)||v<0||v>6)||new Set(value).size!==value.length)throw fail('반복 요일을 확인하세요.');return [...value].sort();}
const fresh = ownerId => ({schemaVersion:1,ownerId,revision:0,rules:[],reads:{},requests:{}});
export async function readPersonalHome(ownerId,{root=PERSONAL_HOME_ROOT}={}) {
  const file=path.join(root,ownerKey(ownerId)+'.json');
  try {const stat=await fs.stat(file);if(stat.size>16*1024*1024)throw fail('개인 업무 저장 크기를 확인하세요.',503);const data=JSON.parse(await fs.readFile(file,'utf8'));if(data.ownerId!==ownerId||data.schemaVersion!==1||!Array.isArray(data.rules)||data.rules.length>200||!Number.isSafeInteger(data.revision)||!data.reads||!data.requests||data.rules.some(r=>!r.id||!Array.isArray(r.versions)||!r.versions.length||!r.occurrences||r.versions.some(v=>!v.effectiveFrom||!v.startDate||!Array.isArray(v.weekdays))))throw fail('개인 업무 저장본을 확인하세요.',503);return data;}catch(e){if(e.code==='ENOENT')return fresh(ownerId);throw e;}
}
function versionAt(rule,date) {return rule.versions.filter(v=>v.effectiveFrom<=date).at(-1);}
function occurrence(rule,date) {if(rule.occurrences[date]?.snapshot)return rule.occurrences[date].snapshot;const v=versionAt(rule,date);if(!v||date<v.startDate||(rule.stoppedFrom&&date>=rule.stoppedFrom))return null;const weekday=new Date(date+'T00:00:00Z').getUTCDay();if(v.weekdays.length?!v.weekdays.includes(weekday):date!==v.startDate)return null;return v;}
export function personalHomeTasks(record,date,{offset=0,limit=200}={}) {
  homeDate(date);offset=Number(offset);limit=Number(limit);if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>500)throw fail('목록 범위를 확인하세요.');
  const tasks=[];let totalTasks=0;
  const first=record.rules.reduce((min,r)=>r.versions[0].effectiveFrom<min?r.versions[0].effectiveFrom:min,date);
  const rules=[...record.rules].sort((a,b)=>a.id.localeCompare(b.id));
  for(let day=first;day<=date;day=nextDay(day))for(const rule of rules) {
    const v=occurrence(rule,day);if(!v)continue;const event=rule.occurrences[day]||{};
    if(event.done&&day!==date&&!event.archived)continue;
    if(totalTasks>=offset&&tasks.length<limit)tasks.push({id:rule.id,title:event.title||v.title,startDate:v.startDate,weekdays:v.weekdays,occurrenceDate:day,done:!!event.done,archived:!!event.archived,carried:day<date,stopped:!!rule.stoppedFrom,revision:record.revision});
    totalTasks++;
  }
  return {tasks,totalTasks,nextOffset:offset+limit<totalTasks?offset+limit:null};
}
export async function mutatePersonalHome(ownerId,input,{root=PERSONAL_HOME_ROOT,now=()=>new Date(),validateRead=()=>false}={}) {
  const key=ownerKey(ownerId);await fs.mkdir(root,{recursive:true,mode:0o700});
  const lock=path.join(root,key+'.lock');let acquired=false;
  for(let n=0;n<80;n++){try{await fs.mkdir(lock);acquired=true;break;}catch(e){if(e.code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,25));}}
  if(!acquired)throw fail('다른 창에서 저장 중입니다. 잠시 후 다시 시도하세요.',409);
  try {
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail('요청을 확인하세요.');
    const allowed=['action','expectedRevision','requestId','date','taskId','title','startDate','weekdays','done','sourceKey'];if(Object.keys(input).some(k=>!allowed.includes(k)))throw fail('지원하지 않는 요청 항목입니다.');
    const {action,requestId}=input;if(!['create','update','complete','archive','restore','stop','read'].includes(action))throw fail('지원하지 않는 동작입니다.');
    if(typeof requestId!=='string'||! /^[A-Za-z0-9_-]{8,100}$/.test(requestId))throw fail('요청 식별자가 필요합니다.');
    const record=await readPersonalHome(ownerId,{root});const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    if(record.requests[requestId]){if(record.requests[requestId]!==hash)throw fail('같은 요청 식별자로 다른 작업을 저장할 수 없습니다.',409);return record;}
    if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==record.revision)throw fail('다른 창에서 변경했습니다. 최신 자료를 다시 확인하세요.',409);
    if(Object.keys(record.requests).length>=20000)throw fail('개인 업무 요청 보관 용량을 확인하세요.',503);
    const date=homeDate(input.date);const timestamp=now().toISOString();
    if(action==='read') {
      if(typeof input.sourceKey!=='string'||input.sourceKey.length>350||!await validateRead(input.sourceKey))throw fail('현재 볼 수 있는 원문을 확인하세요.',403);
      record.reads[input.sourceKey]=timestamp;
      const keys=Object.keys(record.reads).sort((a,b)=>record.reads[b].localeCompare(record.reads[a]));for(const old of keys.slice(500))delete record.reads[old];
    } else if(action==='create') {
      if(record.rules.length>=200)throw fail('개인 업무는 최대 200개입니다.');
      const startDate=homeDate(input.startDate||date);
      record.rules.push({id:randomUUID(),createdAt:timestamp,versions:[{effectiveFrom:startDate,startDate,title:title(input.title),weekdays:days(input.weekdays||[])}],occurrences:{}});
    } else {
      const rule=record.rules.find(r=>r.id===input.taskId);if(!rule)throw fail('개인 업무를 찾을 수 없습니다.',404);
      const current=occurrence(rule,date);if(!current)throw fail('해당 날짜의 실행 건이 없습니다.',404);
      const entry=rule.occurrences[date]||{snapshot:{...current}};
      if(action==='update') {
        entry.title=title(input.title);const effectiveFrom=nextDay(date>kstHomeDate(now())?date:kstHomeDate(now()));const startDate=homeDate(input.startDate||current.startDate);const weekdays=days(input.weekdays??current.weekdays);
        rule.versions=rule.versions.filter(v=>v.effectiveFrom<effectiveFrom);
        rule.versions.push({effectiveFrom,startDate,title:entry.title,weekdays});
      } else if(action==='complete'){if(typeof input.done!=='boolean')throw fail('완료 상태를 확인하세요.');entry.done=input.done;}
      else if(action==='archive')entry.archived=true;
      else if(action==='restore')entry.archived=false;
      else if(action==='stop')rule.stoppedFrom=nextDay(date>kstHomeDate(now())?date:kstHomeDate(now()));
      entry.updatedAt=timestamp;rule.occurrences[date]=entry;
    }
    record.revision++;record.requests[requestId]=hash;
    const serialized=JSON.stringify(record);if(Buffer.byteLength(serialized)>16*1024*1024)throw fail('개인 업무 저장 용량을 확인하세요.',503);
    const file=path.join(root,key+'.json'),temp=path.join(root,key+'.'+randomUUID()+'.tmp');
    try {const handle=await fs.open(temp,'wx',0o600);try{await handle.writeFile(serialized);await handle.sync();}finally{await handle.close();}await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    return record;
  } finally {await fs.rmdir(lock);}
}

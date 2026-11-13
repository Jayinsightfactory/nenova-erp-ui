// Shared Nenova calendar. File-only; no ERP connection or personal-home mutation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {homeDate,acquireOwnerLock,releaseOwnerLock} from './personalHomeStore.js';
import {isOrbitReportViewer} from './orbitReportAccess.js';
const actorKey=value=>createHash('sha256').update('nenova-company-author\0'+value).digest('hex');
const ROOT=path.join(process.cwd(),'data/runtime/company-calendar');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const error=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const actor=user=>{if(typeof user?.userId!=='string'||!user.userId||user.userId.length>128||user.accountActive===false||user.service===true)throw error('활성 로그인 계정이 필요합니다.',403);return user.userId;};
function fields(input){
  if(typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>120||/[\u0000-\u001f\u007f]/.test(input.title))throw error('공통 일정 제목을 120자 이내로 입력하세요.');
  const time=value=>{if(typeof value!=='string'||value!==''&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))throw error('시간을 확인하세요.');return value;};
  const startTime=time(input.startTime??''),endTime=time(input.endTime??'');
  if(endTime&&(!startTime||endTime<=startTime))throw error('종료 시간은 시작 시간 이후로 입력하세요.');
  if(typeof(input.note??'')!=='string'||(input.note||'').length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.note||''))throw error('일정 메모를 2000자 이내로 입력하세요.');
  return {title:input.title.trim(),date:homeDate(input.date),startTime,endTime,note:(input.note||'').trim()};
}
async function read(root){
  const file=path.join(root,'calendar.json');
  try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16*1024*1024)throw error('공통 일정 저장본을 확인하세요.',503);
    const value=JSON.parse(await fs.readFile(file,'utf8'));
    if(value.schemaVersion!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!Array.isArray(value.events)||value.events.length>5000||!value.requests||typeof value.requests!=='object'||Array.isArray(value.requests))throw error('공통 일정 저장본을 확인하세요.',503);
    const ids=new Set();for(const event of value.events){if(!UUID.test(event.id)||ids.has(event.id)||typeof event.createdBy!=='string'||!/^[a-f0-9]{64}$/.test(event.createdBy)||!Number.isFinite(Date.parse(event.createdAt))||!Number.isFinite(Date.parse(event.updatedAt)))throw error('공통 일정 저장본을 확인하세요.',503);fields(event);ids.add(event.id);}
    return value;
  }catch(e){if(e.code==='ENOENT')return {schemaVersion:1,revision:0,events:[],requests:{}};if(e.statusCode===503)throw e;throw error('공통 일정 저장본을 읽지 못했습니다. 관리자에게 확인을 요청하세요.',503);}
}
function project(record,user,query){
  if(!query||typeof query!=='object'||Array.isArray(query))throw error('조회할 날짜를 선택하세요.');
  const ranges=[];
  if(query.month!==undefined){if(typeof query.month!=='string'||!/^(?:20\d{2}|2100)-(?:0[1-9]|1[0-2])$/.test(query.month))throw error('달력 연월을 확인하세요.');ranges.push([query.month+'-01',query.month+'-31']);}
  if(query.week!==undefined){const date=homeDate(query.week),at=new Date(date+'T12:00:00Z');at.setUTCDate(at.getUTCDate()-(at.getUTCDay()+6)%7);const start=at.toISOString().slice(0,10);at.setUTCDate(at.getUTCDate()+6);ranges.push([start,at.toISOString().slice(0,10)]);}
  if(query.date!==undefined){const date=homeDate(query.date);ranges.push([date,date]);}
  if(!ranges.length)throw error('조회할 날짜를 선택하세요.');
  const canEdit=event=>event.createdBy===actorKey(user.userId)||isOrbitReportViewer(user);
  const events=record.events.filter(event=>!event.deletedAt&&ranges.some(([a,b])=>event.date>=a&&event.date<=b)).sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'99:99').localeCompare(b.startTime||'99:99')||a.createdAt.localeCompare(b.createdAt));
  const priority=query.date?[...events.filter(event=>event.date===query.date),...events.filter(event=>event.date!==query.date)]:events,projected=[];let bytes=1024;
  for(const event of priority){if(projected.length>=1000)break;const value={id:event.id,...fields(event),createdAt:event.createdAt,updatedAt:event.updatedAt,canEdit:canEdit(event)},size=Buffer.byteLength(JSON.stringify(value),'utf8')+1;if(bytes+size>1500*1024)break;bytes+=size;projected.push(value);}
  projected.sort((a,b)=>a.date.localeCompare(b.date)||(a.startTime||'99:99').localeCompare(b.startTime||'99:99')||a.createdAt.localeCompare(b.createdAt));
  return {success:true,schemaVersion:1,ownerId:user.userId,revision:record.revision,total:events.length,truncated:projected.length<events.length,events:projected};
}
export async function companyCalendar(user,query,command=null,{root=ROOT,now=()=>new Date()}={}){
  const userId=actor(user);project({events:[],revision:0},user,query); // validate before any mutation
  if(!command)return project(await read(root),user,query);
  if(!command||typeof command!=='object'||Array.isArray(command)||Object.keys(command).some(key=>!['action','requestId','expectedRevision','id','title','date','startTime','endTime','note'].includes(key)))throw error('공통 일정 요청을 확인하세요.');
  if(!['create','update','delete'].includes(command.action)||!UUID.test(command.requestId)||!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<0)throw error('공통 일정 저장 요청을 확인하세요.');
  if(command.action!=='create'&&!UUID.test(command.id))throw error('공통 일정 번호를 확인하세요.');
  const values=command.action==='delete'?null:fields(command);
  await fs.mkdir(root,{recursive:true,mode:0o700});const lock=path.join(root,'calendar.lock'),lease=await acquireOwnerLock(lock);
  try{const record=await read(root),key=createHash('sha256').update(userId+'\0'+command.requestId).digest('hex'),digest=createHash('sha256').update(JSON.stringify(command)).digest('hex');
    if(Object.hasOwn(record.requests,key)){if(record.requests[key]!==digest)throw error('같은 요청 번호의 내용이 다릅니다.',409);return project(record,user,query);}
    if(record.revision!==command.expectedRevision)throw error('다른 직원이 공통 일정을 변경했습니다. 새로 확인한 뒤 다시 저장하세요.',409);
    const stamp=now().toISOString();
    if(command.action==='create'){if(record.events.length>=5000)throw error('공통 일정 저장 한도를 확인하세요.',503);record.events.push({id:randomUUID(),...values,createdBy:actorKey(userId),createdAt:stamp,updatedBy:actorKey(userId),updatedAt:stamp});}
    else{const event=record.events.find(row=>row.id===command.id&&!row.deletedAt);if(!event)throw error('공통 일정을 찾을 수 없습니다.',404);if(event.createdBy!==actorKey(userId)&&!isOrbitReportViewer(user))throw error('등록자 또는 관리자만 수정·삭제할 수 있습니다.',403);
      if(command.action==='delete')event.deletedAt=stamp;else Object.assign(event,values);event.updatedBy=actorKey(userId);event.updatedAt=stamp;
    }
    if(Object.keys(record.requests).length>=20000)throw error('공통 일정 요청 보관 한도를 확인하세요.',503);
    record.revision++;record.requests[key]=digest;
    const temporary=path.join(root,'calendar.'+randomUUID()+'.tmp');
    try{const handle=await fs.open(temporary,'wx',0o600);try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}await fs.rename(temporary,path.join(root,'calendar.json'));}finally{await fs.unlink(temporary).catch(()=>{});}
    return project(record,user,query);
  }finally{await releaseOwnerLock(lock,lease);}
}

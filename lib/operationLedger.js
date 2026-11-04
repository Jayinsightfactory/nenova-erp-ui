import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {readPersonalHome, mutatePersonalHome, personalHomeTasks, homeDate, kstHomeDate} from './personalHomeStore.js';

export const OPERATION_ROOT = path.join(process.cwd(), 'data/runtime/operations');
const fail = (code, message, statusCode=400) => Object.assign(new Error(message), {code,statusCode});
const dateField={type:'string',format:'date',description:'업무 날짜 (YYYY-MM-DD)'};
const taskField={type:'string',format:'uuid',description:'개인 업무 번호'};
const titleField={type:'string',minLength:1,maxLength:300,description:'업무 제목'};
const frequencyField={type:'string',enum:['once','daily','weekly','monthly'],description:'반복 기준. 매월은 시작일과 같은 날짜이며 짧은 달은 말일'};
const schema=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const tools = Object.freeze({
  'personal-home.list': {label:'내 업무 조회',mode:'read',confirmation:false,inputSchema:schema({date:dateField})},
  'personal-home.create': {label:'내 업무 추가',mode:'write',confirmation:true,inputSchema:schema({date:dateField,title:titleField,startDate:dateField,frequency:frequencyField,weekdays:{type:'array',items:{type:'integer',minimum:0,maximum:6},maxItems:7}},['title'])},
  'personal-home.update': {label:'내 업무 수정',mode:'write',confirmation:true,inputSchema:schema({date:dateField,taskId:taskField,title:titleField,startDate:dateField,frequency:frequencyField,weekdays:{type:'array',items:{type:'integer',minimum:0,maximum:6},maxItems:7}},['date','taskId','title'])},
  'personal-home.archive': {label:'내 업무 삭제',mode:'write',confirmation:true,inputSchema:schema({date:dateField,taskId:taskField},['date','taskId'])},
  'personal-home.restore': {label:'삭제한 업무 복구',mode:'write',confirmation:true,inputSchema:schema({date:dateField,taskId:taskField},['date','taskId'])},
});
const key = userId => createHash('sha256').update(userId).digest('hex');
const validId = value => typeof value==='string' && /^[a-f0-9-]{36}$/i.test(value);
const copy = value => JSON.parse(JSON.stringify(value));
function owner(user) {if(!user?.userId||user.accountActive===false)throw fail('ACCOUNT_INACTIVE','활성 로그인 계정이 필요합니다.',403);return user.userId;}
function directory(user, root) {return path.join(root,key(owner(user)));}
function publicRecord(record) {const {ownerId,requestId,...safe}=record;return safe;}
async function atomic(file, record) {const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(record),{flag:'wx',mode:0o600});try{await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}}
async function withLock(dir, id, fn) {
  const lock=path.join(dir,id+'.lock');
  for(let attempt=0;attempt<80;attempt++){
    try {
      await fs.mkdir(lock);
      const marker={hostname:os.hostname(),pid:process.pid,token:randomUUID()};
      try{await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify(marker),{flag:'wx',mode:0o600});}
      catch(error){await fs.rmdir(lock).catch(()=>{});throw error;}
      try{return await fn();}finally{await fs.unlink(path.join(lock,'owner.json'));await fs.rmdir(lock);}
    }catch(error){
      if(error.code!=='EEXIST')throw error;
      try{
        const marker=JSON.parse(await fs.readFile(path.join(lock,'owner.json'),'utf8'));
        if(marker.hostname===os.hostname()&&Number.isSafeInteger(marker.pid)&&marker.pid>0){
          try{process.kill(marker.pid,0);}catch(e){if(e.code==='ESRCH'){
            const quarantine=lock+'.dead-'+randomUUID();await fs.rename(lock,quarantine);
            await fs.unlink(path.join(quarantine,'owner.json'));await fs.rmdir(quarantine);
          }}
        }
      }catch(e){if(!['ENOENT','EEXIST'].includes(e.code))throw e;}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
  throw fail('OPERATION_BUSY','다른 요청을 처리 중입니다. 잠시 후 다시 확인하세요.',409);
}
async function read(user,id,root) {if(!validId(id))throw fail('INVALID_ID','작업 번호를 확인하세요.');try{const record=JSON.parse(await fs.readFile(path.join(directory(user,root),id+'.json'),'utf8'));if(record.ownerId!==owner(user))throw fail('NOT_FOUND','작업을 찾을 수 없습니다.',404);return record;}catch(error){if(error.code==='ENOENT')throw fail('NOT_FOUND','작업을 찾을 수 없습니다.',404);throw error;}}
function validate(toolId,input,now) {
  if(!tools[toolId])throw fail('UNSUPPORTED_TOOL','등록되지 않은 작업입니다.');
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('INVALID_INPUT','작업 내용을 확인하세요.');
  const allowed=new Set(toolId.endsWith('.list')?['date']:toolId.endsWith('.create')?['date','title','startDate','frequency','weekdays']:toolId.endsWith('.update')?['date','taskId','title','startDate','frequency','weekdays']:['date','taskId']);
  if(Object.keys(input).some(k=>!allowed.has(k)))throw fail('INVALID_INPUT','지원하지 않는 항목이 있습니다.');
  const date=homeDate(input.date||kstHomeDate(now));
  if(toolId.endsWith('.create')||toolId.endsWith('.update')){
    if(typeof input.title!=='string'||!input.title.trim()||input.title.length>300||/[\x00-\x1f\x7f]/.test(input.title))throw fail('INVALID_TITLE','업무 제목을 확인하세요.');
  }
  if(toolId.endsWith('.create')||toolId.endsWith('.update')){
    if(input.startDate)homeDate(input.startDate);
    if(input.frequency!==undefined&&!['once','daily','weekly','monthly'].includes(input.frequency))throw fail('INVALID_FREQUENCY','반복 기준을 확인하세요.');
    if(input.weekdays!==undefined&&(!Array.isArray(input.weekdays)||input.weekdays.length>7||input.weekdays.some(v=>!Number.isInteger(v)||v<0||v>6)||new Set(input.weekdays).size!==input.weekdays.length))throw fail('INVALID_WEEKDAYS','반복 요일을 확인하세요.');
  }
  if(['update','archive','restore'].some(action=>toolId.endsWith('.'+action))&&!validId(input.taskId))throw fail('INVALID_TASK','업무 번호를 확인하세요.');
  return {...input,date};
}
function findTask(record,date,id) {let offset=0;do {const page=personalHomeTasks(record,date,{offset,limit:500});const found=page.tasks.find(task=>task.id===id&&task.occurrenceDate===date);if(found)return found;offset=page.nextOffset;}while(offset!==null);return null;}
export function operationCapabilities(user) {owner(user);return Object.entries(tools).map(([toolId,tool])=>({toolId,...tool,contractVersion:1}));}
export async function previewOperation(user,request,{root=OPERATION_ROOT,personalRoot,now=()=>new Date()}={}) {
  owner(user);const toolId=request?.toolId,tool=tools[toolId],input=validate(toolId,request?.input,now());
  const personal=await readPersonalHome(user.userId,personalRoot?{root:personalRoot}:{});
  const before=toolId.endsWith('.list')?null:toolId.endsWith('.create')?null:findTask(personal,input.date,input.taskId);
  if(!toolId.endsWith('.list')&&!toolId.endsWith('.create')&&!before)throw fail('TASK_NOT_FOUND','해당 날짜의 업무를 찾을 수 없습니다.',404);
  if(toolId.endsWith('.archive')&&before.archived)throw fail('TASK_ALREADY_DELETED','이미 삭제한 업무입니다.',409);
  if(toolId.endsWith('.restore')&&!before.archived)throw fail('TASK_NOT_DELETED','삭제한 업무가 아닙니다.',409);
  const operationId=randomUUID(),requestedAt=now().toISOString();
  const summaryKo=toolId.endsWith('.list')?`${input.date} 내 업무 조회`:`${input.date} · ${before?.title||input.title} · ${tool.label}`;
  const record={schemaVersion:1,operationId,ownerId:user.userId,actorName:String(user.userName||user.userId).slice(0,100),origin:request?.origin==='ai'?'ai':'person',actionId:validId(request?.actionId)?request.actionId:null,requestId:randomUUID(),toolId,route:'/api/operations',actionType:toolId,summaryKo,scope:{date:input.date,taskId:input.taskId||null},input,expectedRevision:personal.revision,before:before?{title:before.title,archived:before.archived,done:before.done}:null,state:tool.mode==='read'?'verified':'awaiting_confirmation',requestedAt,confirmedAt:null,finishedAt:tool.mode==='read'?requestedAt:null,result:null,verification:null,errorCode:null};
  if(tool.mode==='read') {const listed=personalHomeTasks(personal,input.date,{limit:500});record.result={count:listed.totalTasks,tasks:listed.tasks.map(t=>({id:t.id,title:t.title,date:t.occurrenceDate,done:t.done,archived:t.archived}))};record.verification={source:'personal-home',revision:personal.revision,checkedAt:requestedAt};}
  const dir=directory(user,root);await fs.mkdir(dir,{recursive:true,mode:0o700});await atomic(path.join(dir,operationId+'.json'),record);
  return {...publicRecord(record),confirmationRequired:tool.confirmation,confirmationText:tool.confirmation?`${summaryKo} 작업을 적용합니다.`:null};
}
export async function confirmOperation(user,id,{confirmed,expectedRevision},{root=OPERATION_ROOT,personalRoot,now=()=>new Date()}={}) {
  owner(user);const dir=directory(user,root);return withLock(dir,id,async()=>{
    const record=await read(user,id,root);if(record.state==='verified'||record.state==='failed'||record.state==='verification_failed')return publicRecord(record);
    if(record.state!=='awaiting_confirmation'&&record.state!=='running')throw fail('INVALID_STATE','확인할 수 없는 작업 상태입니다.',409);
    if(confirmed!==true)throw fail('CONFIRMATION_REQUIRED','작업 적용 확인이 필요합니다.',400);
    if(expectedRevision!==record.expectedRevision)throw fail('REVISION_CHANGED','미리보기 이후 업무가 변경되었습니다. 다시 확인하세요.',409);
    const file=path.join(dir,id+'.json');record.confirmedAt ||= now().toISOString();record.state='running';await atomic(file,record);
    const action=record.toolId.split('.')[1],personalOptions=personalRoot?{root:personalRoot}:{};
    try {
      const command={...record.input,action,expectedRevision:record.expectedRevision,requestId:record.requestId,...(action==='create'?{taskId:record.operationId}:{})};
      const after=await mutatePersonalHome(user.userId,command,personalOptions);
      const taskId=action==='create'?record.operationId:record.input.taskId;
      const task=findTask(after,action==='create'?(record.input.startDate||record.input.date):record.input.date,taskId);
      const matches=!!task&&(action==='create'||action==='update'?task.title===record.input.title.trim():action==='archive'?task.archived:!task.archived);
      record.result={count:1,taskId,revision:after.revision};record.verification={source:'personal-home',revision:after.revision,checkedAt:now().toISOString(),matched:matches};record.state=matches?'verified':'verification_failed';record.finishedAt=now().toISOString();
    }catch(error){record.state='failed';record.errorCode=error.statusCode?error.code||'TASK_CONFLICT':'TASK_STORE_ERROR';record.finishedAt=now().toISOString();}
    await atomic(file,record);return publicRecord(record);
  });
}
export async function getOperation(user,id,{root=OPERATION_ROOT}={}) {return publicRecord(await read(user,id,root));}
export async function listOperations(user,{limit=50,offset=0}={}, {root=OPERATION_ROOT}={}) {
  owner(user);limit=Number(limit);offset=Number(offset);if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(offset)||offset<0)throw fail('INVALID_PAGE','조회 범위를 확인하세요.');
  let files=[];try{files=(await fs.readdir(directory(user,root))).filter(name=>/^[a-f0-9-]{36}\.json$/i.test(name));}catch(error){if(error.code!=='ENOENT')throw error;}
  const records=await Promise.all(files.map(name=>read(user,name.slice(0,-5),root)));
  records.sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt)||b.operationId.localeCompare(a.operationId));
  return {items:records.slice(offset,offset+limit).map(publicRecord),total:records.length,nextOffset:offset+limit<records.length?offset+limit:null};
}

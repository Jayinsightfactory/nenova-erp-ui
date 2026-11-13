// Web-only checklist. No raw chat, user details or ERP data is stored here.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const KEY=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=(message,statusCode=400)=>{throw Object.assign(new Error(message),{statusCode});};
function validKey(key){if(typeof key!=='string'||!KEY.test(key))fail('요청 식별값을 확인하세요.');return key;}
function createKakaoDoneStore({directory=process.env.DISTRIBUTION_KAKAO_DONE_DIR||path.join(process.cwd(),'data/runtime/distribution-kakao-done')}={}){
 const root=path.resolve(directory);
 const file=(key,revision)=>path.join(root,`${validKey(key)}.${revision||'root'}.json`);
 async function event(key,revision){
  try{const f=file(key,revision),s=await fs.lstat(f);if(!s.isFile()||s.isSymbolicLink())throw Error('invalid file');const r=JSON.parse(await fs.readFile(f,'utf8'));
   if(r.key!==key||r.previous!==revision||!UUID.test(r.revision)||typeof r.done!=='boolean'||!Number.isFinite(Date.parse(r.at)))throw Error('invalid record');return r;
  }catch(e){if(e.code==='ENOENT')return null;fail('작업완료 기록을 읽지 못했습니다.',503);}
 }
 async function read(key){validKey(key);let current={key,done:false,revision:null,at:null};const seen=new Set();
  for(let i=0;i<10000;i++){const next=await event(key,current.revision);if(!next)return current;if(seen.has(next.revision))fail('작업완료 기록을 확인하지 못했습니다.',503);seen.add(next.revision);current={key,done:next.done,revision:next.revision,at:next.at};}fail('작업완료 기록을 확인하지 못했습니다.',503);
 }
 async function save({key,done,expectedRevision,requestId}){
  validKey(key);if(typeof done!=='boolean'||!(expectedRevision===null||UUID.test(expectedRevision))||!UUID.test(requestId)||requestId===expectedRevision)fail('작업완료 저장값을 확인하세요.');
  const baseline=await read(key);
  if(baseline.revision!==expectedRevision){if(baseline.revision===requestId&&baseline.done===done)return baseline;throw Object.assign(Error('다른 창에서 완료 표시가 변경됐습니다. 현재 상태를 다시 확인하세요.'),{statusCode:409,current:baseline});}
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const record={key,done,previous:expectedRevision,revision:requestId,at:new Date().toISOString()};
  const temporary=path.join(root,`${key}.${crypto.randomUUID()}.tmp`);
  try{const h=await fs.open(temporary,'wx',0o600);try{await h.writeFile(JSON.stringify(record));await h.sync();}finally{await h.close();}
   // Atomic immutable next-event publication provides cross-process CAS. A crash
   // cannot leave a lock or expose partially-written JSON to another reader.
   try{await fs.link(temporary,file(key,expectedRevision));}catch(e){if(e.code!=='EEXIST')throw e;const winner=await event(key,expectedRevision);if(winner?.revision!==requestId||winner.done!==done)throw Object.assign(Error('다른 창에서 완료 표시가 변경됐습니다. 현재 상태를 다시 확인하세요.'),{statusCode:409,current:await read(key)});}
  }finally{await fs.unlink(temporary).catch(()=>{});}
  const current=await read(key);if(current.revision!==requestId)throw Object.assign(Error('다른 창에서 완료 표시가 변경됐습니다. 현재 상태를 다시 확인하세요.'),{statusCode:409,current});return current;
 }
 return{read,save};
}
module.exports={createKakaoDoneStore};

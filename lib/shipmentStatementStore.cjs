// Private immutable web records. Atomic hard-link CAS works across server workers.
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {scope,fail}=require('./shipmentStatement.cjs');
const ROOT=path.join(process.cwd(),'data/runtime/shipment-statements');
function directory(input,root){const s=scope(input);if(!s.custKey)throw fail('업체를 선택하세요.');return path.join(root,s.year,String(s.week),String(s.custKey));}
async function read(input,{root=ROOT,revision}={}){
 const dir=directory(input,root);let version=revision;
 if(version!==undefined&&(!Number.isSafeInteger(version)||version<1))throw fail('저장 버전을 확인하세요.');
 if(version===undefined){let files;try{files=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return null;throw e;}version=files.reduce((m,n)=>/^\d+\.json$/.test(n)?Math.max(m,Number(n.slice(0,-5))):m,0);if(!version)return null;}
 try{const r=JSON.parse(await fs.readFile(path.join(dir,`${version}.json`),'utf8'));if(r.version!==version||JSON.stringify(r.scope)!==JSON.stringify(scope(input)))throw fail('저장본 무결성을 확인하세요.',503);return r;}
 catch(e){if(e.code==='ENOENT')throw fail('저장본을 찾지 못했습니다.',404);throw e;}
}
async function save(input,record,expectedVersion,actor,{root=ROOT}={}){
 const s=scope(input);if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||!actor)throw fail('저장 버전과 로그인 상태를 확인하세요.');
 if(Buffer.byteLength(JSON.stringify(record))>4*1024*1024)throw fail('작성본은 최대4MB까지 저장할 수 있습니다.');
 const dir=directory(s,root);await fs.mkdir(dir,{recursive:true,mode:0o700});const old=await read(s,{root});
 if((old?.version??0)!==expectedVersion)throw fail('다른 창에서 먼저 저장했습니다. 현재 내용을 확인한 뒤 다시 불러오세요.',409);
 const next={...record,scope:s,version:expectedVersion+1,updatedAt:new Date().toISOString(),updatedBy:actor};
 const temp=path.join(dir,randomUUID()+'.tmp'),target=path.join(dir,`${next.version}.json`);
 try{const h=await fs.open(temp,'wx',0o600);try{await h.writeFile(JSON.stringify(next));await h.sync();}finally{await h.close();}
  try{await fs.link(temp,target);}catch(e){if(e.code==='EEXIST')throw fail('다른 창에서 먼저 저장했습니다. 다시 불러오세요.',409);throw e;}
  if(process.platform!=='win32'){const h=await fs.open(dir,'r');try{await h.sync();}finally{await h.close();}}
 }finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 return next;
}
async function latestPreferences(custKey,{root=ROOT}={}){
 if(!Number.isSafeInteger(Number(custKey))||Number(custKey)<=0)throw fail('업체를 확인하세요.');
 let years;try{years=await fs.readdir(root);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 let latest=null;
 for(const year of years.filter(y=>/^20\d{2}$/.test(y))){const weeks=await fs.readdir(path.join(root,year));for(const week of weeks.filter(w=>/^\d{1,2}$/.test(w)&&Number(w)>=1&&Number(w)<=53)){
  const r=await read({year,week:Number(week),custKey:Number(custKey)},{root});if(r&&(!latest||r.updatedAt>latest.updatedAt))latest=r;
 }}return latest?.draft?{defaultDay:latest.draft.defaultDay,groups:latest.draft.groups}:null;
}
module.exports={read,save,latestPreferences};

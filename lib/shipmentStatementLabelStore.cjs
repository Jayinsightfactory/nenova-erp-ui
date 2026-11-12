// 출고내역서 엑셀 품목 표시명 매칭 저장소 (품목 ProdKey -> 표시명). ERP/DB는 건드리지 않는다.
// 품목마다 파일 1개라 서버 워커가 여러 개여도 서로 덮어쓰지 않고, 한 번 저장하면 계속 유지된다.
const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fail}=require('./shipmentStatement.cjs');
const ROOT=path.join(process.cwd(),'data/runtime/shipment-statement-labels');
const MAX=100;
function prodKeyOf(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw fail('품목을 확인하세요.');return n;}
function cleanLabel(value){
 const text=String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
 if(text.length>MAX)throw fail(`품목 표시명은 ${MAX}자까지 입력할 수 있습니다.`);return text;
}
async function readAll({root=ROOT}={}){
 let files;try{files=await fs.readdir(root);}catch(e){if(e.code==='ENOENT')return {};throw e;}
 const result={};
 for(const name of files.filter(n=>/^\d+\.json$/.test(n))){
  try{const r=JSON.parse(await fs.readFile(path.join(root,name),'utf8'));if(typeof r.label==='string'&&r.label)result[name.slice(0,-5)]=r.label;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
 }
 return result;
}
// label 이 비어 있으면 매칭 해제(자동 표시명으로 복귀).
async function setLabel(prodKey,label,actor,{root=ROOT}={}){
 const key=prodKeyOf(prodKey),text=cleanLabel(label);if(!actor)throw fail('로그인 상태를 확인하세요.');
 const target=path.join(root,`${key}.json`);
 if(!text){await fs.unlink(target).catch(e=>{if(e.code!=='ENOENT')throw e;});return {prodKey:key,label:''};}
 await fs.mkdir(root,{recursive:true,mode:0o700});
 const temp=path.join(root,randomUUID()+'.tmp');
 try{await fs.writeFile(temp,JSON.stringify({prodKey:key,label:text,updatedAt:new Date().toISOString(),updatedBy:actor}),{mode:0o600,flag:'wx'});await fs.rename(temp,target);}
 finally{await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 return {prodKey:key,label:text};
}
module.exports={readAll,setLabel,cleanLabel,MAX};

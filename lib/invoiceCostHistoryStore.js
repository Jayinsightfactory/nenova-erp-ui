import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {appendCostWorkbookHistory,costWorkbookDigest} from './invoiceCostWorkbookHistory.js';
import {invoiceCostExportProfile} from './invoiceCostExportProfiles.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
// Private per-user archives: no new database rows and no widened Drive ACLs.
export async function preserveCostHistory({bytes,context,user,listFiles=()=>[],readFile=()=>null,root=path.join(process.cwd(),'data','cost-workbook-history')}){
 const doc=context.document,input=context.input||context.snapshot?.input;
 const year=String(doc?.orderYear||''),week=String(doc?.orderWeek||''),country=doc?.reviewedMetadata?.country,mode=doc?.reviewedMetadata?.transportMode;
 const profile=invoiceCostExportProfile(input?.formulaId),currency=input?.nativeCurrency;
 const owner=String(user?.userId??user?.UserID??'');
 if(!owner||!/^\d{4}$/.test(year)||!/^\d{2}-\d{2}$/.test(week)||!profile||!country||!mode||!/^[A-Z]{3}$/.test(currency||''))throw new Error('Invalid workbook history scope');
 const key=hash(JSON.stringify([owner,year,country,mode,currency,profile.id]));
 const dir=path.join(root,key);await fs.mkdir(dir,{recursive:true,mode:0o700});
 let lock;try{lock=await fs.open(path.join(dir,'lock'),'wx',0o600);}catch(e){if(e.code==='EEXIST'){const error=new Error('같은 국가의 원가파일을 생성 중입니다. 잠시 후 다시 다운로드하세요.');error.statusCode=409;throw error;}throw e;}
 let temp;
 try{
  let manifest=null;try{manifest=JSON.parse(await fs.readFile(path.join(dir,'latest.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(manifest&&(!/^[0-9a-f-]{36}\.xlsx$/.test(manifest.file||'')||!Array.isArray(manifest.digests)||manifest.digests.some(d=>!/^[0-9a-f]{64}$/.test(d))||JSON.stringify(manifest.scope)!==JSON.stringify({year,country,mode,currency})))throw new Error('Invalid workbook history manifest');
  if(manifest?.seedId&&!await readFile(user,manifest.seedId))throw new Error('원본 원가파일 접근 권한을 다시 확인하세요.');
  const digest=await costWorkbookDigest(bytes);
  if(manifest?.digests?.includes(digest))return fs.readFile(path.join(dir,manifest.file));
  let previous=null,seedId=manifest?.seedId||null;
  if(manifest)previous=await fs.readFile(path.join(dir,manifest.file));
  else{
   const seed=(await listFiles(user)).find(r=>r.canDownload&&r.sha===profile.sourceHash&&r.ext==='.xlsx');
   if(seed){const source=await readFile(user,seed.id);if(source){const data=await fs.readFile(source.abs);if(hash(data)!==profile.sourceHash)throw new Error('원본 원가파일 해시가 변경되었습니다.');previous=data;seedId=seed.id;}}
  }
  const result=await appendCostWorkbookHistory(previous,bytes,{label:week});
  const file=`${randomUUID()}.xlsx`;await fs.writeFile(path.join(dir,file),result,{mode:0o600});
  temp=path.join(dir,`${randomUUID()}.tmp`);
  await fs.writeFile(temp,JSON.stringify({file,seedId,scope:{year,country,mode,currency},digests:[...(manifest?.digests||[]),digest]}),{mode:0o600});
  await fs.rename(temp,path.join(dir,'latest.json'));temp=null;
  return result;
 }finally{if(temp)await fs.unlink(temp).catch(()=>{});await lock.close();await fs.unlink(path.join(dir,'lock'));}
}

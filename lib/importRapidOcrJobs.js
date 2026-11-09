import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import net from 'node:net';
const ROOT=path.join(process.cwd(),'data/runtime/import-team/rapidocr');
const validId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
const owner=x=>createHash('sha256').update(String(x)).digest('hex');
const read=async f=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return null;}};
const file=(root,id)=>path.join(root,id+'.json');
async function write(root,id,value){
 await fs.mkdir(root,{recursive:true,mode:0o700});const tmp=file(root,id)+'.'+randomUUID()+'.tmp';
 try{await fs.writeFile(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});await fs.rename(tmp,file(root,id));}finally{await fs.unlink(tmp).catch(()=>{});}
}
async function locked(root,fn){
 await fs.mkdir(root,{recursive:true,mode:0o700});
 const key=createHash('sha256').update(path.resolve(root)).digest('hex').slice(0,30);
 const address=process.platform==='win32'?'\\\\.\\pipe\\nenova-ocr-'+key:process.platform==='linux'?'\0nenova-ocr-'+key:null;
 if(!address)throw Object.assign(Error('무료 OCR 잠금 환경을 지원하지 않습니다.'),{statusCode:503});
 const deadline=Date.now()+2000;let server;
 while(Date.now()<deadline){
  const candidate=net.createServer(socket=>socket.destroy());
  const error=await new Promise(resolve=>{candidate.once('error',resolve);candidate.listen({path:address,exclusive:true},()=>resolve(null));});
  if(!error){server=candidate;break;}
  if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;
  await new Promise(r=>setTimeout(r,20));
 }
 if(!server)throw Object.assign(Error('무료 OCR 작업 저장소가 사용 중입니다. 잠시 후 다시 확인하세요.'),{statusCode:409});
 try{return await fn();}finally{await new Promise(resolve=>server.close(resolve));}
}
function publicJob(row){return {jobId:row.jobId,status:row.status,sourceHash:row.sourceHash,country:row.country,providerCalls:0,erpWrites:0,...(row.status==='SUCCEEDED'?{result:row.result}:{}),...(row.error?{error:row.error}:{})};}
export async function createRapidOcrJob(uid,{pdfBase64,country},{root=ROOT,now=Date.now()}={}){
 if(!uid||!['CO','CN','NL','AU','TH','EC','US','VN'].includes(country)||typeof pdfBase64!=='string'||pdfBase64.length>28*1024*1024||!/^JVBERi0[A-Za-z0-9+/=\r\n]*$/.test(pdfBase64))throw Object.assign(Error('20MiB 이하의 원본 PDF와 국가를 확인하세요.'),{statusCode:400});
 const bytes=Buffer.from(pdfBase64,'base64');if(bytes.length>20*1024*1024)throw Object.assign(Error('PDF는 최대20MiB입니다.'),{statusCode:413});
 const sourceHash=createHash('sha256').update(bytes).digest('hex'),ownerHash=owner(uid);
 return locked(root,async()=>{
  const records=[];for(const name of await fs.readdir(root))if(name.endsWith('.json')){const row=await read(path.join(root,name));if(row)records.push(row);}
  const existing=records.find(x=>x.ownerHash===ownerHash&&x.sourceHash===sourceHash&&x.country===country&&((x.status==='SUCCEEDED'&&now-x.createdAt<24*60*60*1000)||(['QUEUED','RUNNING'].includes(x.status)&&now-x.createdAt<2*60*60*1000)));
  if(existing)return publicJob(existing);
  if(records.filter(x=>['QUEUED','RUNNING'].includes(x.status)&&now-x.createdAt<2*60*60*1000).length>=8)throw Object.assign(Error('무료 OCR 대기 작업이 많습니다. 파일을 유지하고 나중에 다시 진행하세요.'),{statusCode:429});
  const row={jobId:randomUUID(),ownerHash,sourceHash,country,pdfBase64,status:'QUEUED',createdAt:now};await write(root,row.jobId,row);return publicJob(row);
 });
}
export async function getRapidOcrJob(uid,id,{root=ROOT,now=Date.now()}={}){
 if(!uid||!validId(id))return null;const row=await read(file(root,id));
 if(!row||row.ownerHash!==owner(uid)||now-row.createdAt>=24*60*60*1000)return null;
 if(['QUEUED','RUNNING'].includes(row.status)&&now-row.createdAt>=2*60*60*1000)return {...publicJob(row),status:'FAILED',error:'무료 OCR 워커 작업이 만료되었습니다. 파일을 유지한 채 무료 OCR 버튼으로 다시 접수하세요. 유료 호출은 없습니다.'};
 return publicJob(row);
}
export async function claimRapidOcrJob({root=ROOT,now=Date.now()}={}){
 return locked(root,async()=>{
  const records=[];for(const name of await fs.readdir(root))if(name.endsWith('.json')){const row=await read(path.join(root,name));if(row?.status==='QUEUED'&&now-row.createdAt<2*60*60*1000)records.push(row);}
  const row=records.sort((a,b)=>a.createdAt-b.createdAt)[0];if(!row)return null;
  const claimToken=randomUUID();await write(root,row.jobId,{...row,status:'RUNNING',claimToken,claimedAt:now});
  return {jobId:row.jobId,sourceHash:row.sourceHash,country:row.country,pdfBase64:row.pdfBase64,claimToken};
 });
}
export async function finishRapidOcrJob({jobId,claimToken,sourceHash,result,error},{root=ROOT}={}){
 if(!validId(jobId)||!validId(claimToken))throw Object.assign(Error('OCR 작업 식별값이 잘못되었습니다.'),{statusCode:400});
 return locked(root,async()=>{
  const row=await read(file(root,jobId));if(!row||row.status!=='RUNNING'||row.claimToken!==claimToken||row.sourceHash!==sourceHash)throw Object.assign(Error('OCR 작업 원본 또는 실행 소유자가 다릅니다.'),{statusCode:409});
  if(!error){
   if(!result||result.sourceHash!==sourceHash||!Array.isArray(result.pages)||!result.pages.length||result.pages.length>72||result.pages.some((p,i)=>p.page!==i+1||!Array.isArray(p.items)||p.items.length>20000||![p.width,p.height].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>0)||p.items.some(x=>typeof x.str!=='string'||x.str.length>2000||![x.x,x.y,x.width,x.height].every(n=>typeof n==='number'&&Number.isFinite(n)))))throw Object.assign(Error('OCR 원본 페이지 범위를 확인하지 못했습니다.'),{statusCode:400});
   if(Buffer.byteLength(JSON.stringify(result))>8*1024*1024)throw Object.assign(Error('OCR 결과 크기가 한도를 넘었습니다.'),{statusCode:413});
  }
  const {pdfBase64,claimToken:discarded,...keep}=row;
  await write(root,jobId,{...keep,status:error?'FAILED':'SUCCEEDED',...(error?{error:'무료 OCR 처리에 실패했습니다. 원본은 유지되며 유료 분석은 실행하지 않았습니다.'}:{result})});return true;
 });
}

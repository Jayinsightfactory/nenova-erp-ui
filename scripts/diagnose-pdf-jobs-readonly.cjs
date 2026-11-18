// Sanitized timestamps/status only. No source PDF, response text or account IDs.
{
 const fs=require('node:fs'),path=require('node:path');
 const root='/var/www/nenova-erp/data/runtime/import-team/pdf-jobs',now=Date.now(),rows=[];
 const iso=v=>Number.isFinite(v)?new Date(v).toISOString():null;
 try{
  for(const user of fs.readdirSync(root,{withFileTypes:true})){
   if(!user.isDirectory()||! /^[a-f0-9]{64}$/.test(user.name))continue;
   const dir=path.join(root,user.name);
   for(const name of fs.readdirSync(dir)){
    if(! /^[a-f0-9-]{36}\.json$/.test(name))continue;
    const file=path.join(dir,name);if(fs.statSync(file).size>5*1024*1024)continue;
    let r;try{r=JSON.parse(fs.readFileSync(file,'utf8'));}catch{continue;}
    if(!Number.isFinite(r.updatedAt)||now-r.updatedAt>6*3600000)continue;
    let ownerAlive=null;
    if(Number.isSafeInteger(r.owner?.pid)&&r.owner.pid>0){try{process.kill(r.owner.pid,0);ownerAlive=true;}catch(e){ownerAlive=e.code!=='ESRCH';}}
    rows.push({createdAt:iso(r.createdAt),updatedAt:iso(r.updatedAt),providerStartedAt:iso(r.providerAttemptStartedAt),
     status:['RUNNING','SUCCEEDED','FAILED'].includes(r.status)?r.status:'UNKNOWN',ownerAlive,
     errorCode:r.error?.code==='PDF_ANALYSIS_UNCERTAIN'?'PDF_ANALYSIS_UNCERTAIN':r.error?'OTHER':null,
     completed:(r.chunks||[]).filter(c=>c?.status==='SUCCEEDED').length,total:r.chunkProgress?.total??null,
     elapsedSeconds:Number.isFinite(r.createdAt)?Math.round(((r.status==='RUNNING'?now:r.updatedAt)-r.createdAt)/1000):null});
   }
  }
  rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  console.log(JSON.stringify({section:'pdf_jobs_6h',at:new Date(now).toISOString(),count:rows.length,jobs:rows.slice(0,24)}));
 }catch(e){console.log(JSON.stringify({section:'pdf_jobs_6h',available:false,code:e.code||'READ_FAILED'}));}
}

// One-shot SELECT/filesystem-read-only diagnosis. No job APIs, SQL, writes or retries.
(async()=>{
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const root='/var/www/nenova-erp/data/runtime/customs-settlement',wanted=new Set(['39','42','44']);
const tag=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex').slice(0,12);
const emit=v=>console.log('SETTLEMENT_AUDIT '+JSON.stringify(v));
const read=async p=>{const s=await fs.stat(p);if(s.size>16*1024*1024)throw Error('SIZE_LIMIT');return JSON.parse(await fs.readFile(p,'utf8'));};
const list=async p=>{try{return(await fs.readdir(p)).sort();}catch(e){if(e.code==='ENOENT')return[];throw e;}};
const store=require('/var/www/nenova-erp/lib/customsSettlementStore.cjs');
const ledgers=[],allDocs=[];
for(const name of (await list(root)).filter(n=>/^2026-\d{2}\.json$/.test(n))){
 const major=name.slice(5,7);try{const r=await read(path.join(root,name));store.validateLedger(r,'2026',major);const docs=r.documents||[];allDocs.push(...docs.map(d=>({...d,major})));
 const china=docs.filter(d=>d.targetKey?.startsWith('country|중국|'));
 ledgers.push({major,revision:r.revision,documents:docs.length,chinaDocuments:china.length,lastRegistration:r.history?.at(-1)?.at||null});
 if(wanted.has(major))emit({kind:'ledger',major,exists:true,valid:true,revision:r.revision,documents:docs.length,chinaDocuments:china.map(d=>({sourceTag:tag(d.sourceHash),awbTag:tag(d.awb),date:d.date,target:d.targetKey,charges:d.charges.map(c=>({code:c.code,positive:Number(c.total)>0})),manual:!!d.manualLink})),chinaFields:Object.entries(r.values||{}).filter(([k])=>k.startsWith('country|중국|')).map(([target,fields])=>({target,fields:Object.entries(fields).map(([field,n])=>({field,positive:Number(n)>0,zero:Number(n)===0}))}))});
 }catch(e){emit({kind:'ledger',major,exists:true,valid:false,error:'INVALID_LEDGER'});}
}
for(const major of wanted)if(!ledgers.some(l=>l.major===major))emit({kind:'ledger',major,exists:false});
emit({kind:'ledger_inventory',scopes:ledgers});
const jobs=[],jobsRoot=path.join(root,'jobs');let invalid=0;
for(const name of (await list(jobsRoot)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).slice(0,2000)){
 try{const j=await read(path.join(jobsRoot,name));if(String(j.year)!=='2026')continue;jobs.push(j);}catch{invalid++;}
}
const group={};for(const j of jobs){const k=String(j.major);group[k]||={jobs:0,statuses:{},files:{},chinaCurrencyFiles:0};const g=group[k];g.jobs++;g.statuses[j.status]=(g.statuses[j.status]||0)+1;for(const f of j.files||[]){g.files[f.status]=(g.files[f.status]||0)+1;if(f.receipt?.currency==='CNY')g.chinaCurrencyFiles++;}}
emit({kind:'job_inventory',jobs:jobs.length,invalid,scopes:group});
for(const j of jobs){if(!wanted.has(String(j.major))&&!(j.files||[]).some(f=>allDocs.some(d=>wanted.has(d.major)&&d.sourceHash===f.sourceHash)))continue;
 emit({kind:'job',jobTag:tag(j.jobId),major:j.major,createdAt:new Date(j.createdAt).toISOString(),status:j.status,registration:j.registration?{state:j.registration.state,at:new Date(j.registration.at).toISOString(),registeredDocuments:j.registration.registeredDocuments,errorCount:j.registration.errors?.length||0}:null,files:(j.files||[]).map(f=>({sourceTag:tag(f.sourceHash),status:f.status,attempts:f.attempts||0,parsed:!!f.receipt,currency:f.receipt?.currency||null,date:f.receipt?.date||null,awbTag:f.receipt?.awb?tag(f.receipt.awb):null,error:!!f.error,registered:allDocs.filter(d=>d.sourceHash===f.sourceHash).map(d=>({major:d.major,target:d.targetKey}))}))});
}
let heart;try{heart=await read(path.join(jobsRoot,'worker-heartbeat.json'));}catch{}
emit({kind:'worker',heartbeat:heart?.lastSeen?new Date(heart.lastSeen).toISOString():null,now:new Date().toISOString()});
})().catch(()=>{console.log('SETTLEMENT_AUDIT '+JSON.stringify({kind:'error',code:'READ_ONLY_PROBE_FAILED'}));process.exitCode=1;});

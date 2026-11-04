'use strict';
// Private source text stays in process memory. Output is aggregate, never raw logs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,12);
function confirmedOperation(row){
  if(row.Result!=='SUCCESS'||row.ActionType!=='SHIPMENT_ADJUST_BATCH')return null;
  let p;try{p=JSON.parse(row.Payload);}catch{return null;}
  if(p.schema!=='paste-operation-v1'||p.verified!==true||p.preflightOnly||p.incomplete||!Array.isArray(p.entries)||!p.entries.length||p.entries.length!==p.committedCount||!/^20\d{2}$/.test(String(p.year))||!new RegExp('^'+p.year+'-(0[1-9]|[1-4]\\d|5[0-3])-(0[1-9]|[1-9]\\d)$').test(String(p.week)))return null;
  const sources=new Set(p.entries.map(e=>e.sourceIdentity));
  if(sources.size!==1||!/^nenovakakao\|[^|]+\|[^|]+$/.test([...sources][0]||''))return null;
  if(p.entries.some(e=>!['ADD','CANCEL'].includes(e.type)||!Number.isSafeInteger(e.custKey)||e.custKey<=0||!Number.isSafeInteger(e.prodKey)||e.prodKey<=0||!Number.isFinite(e.qty)||e.qty<=0||!['박스','단','송이'].includes(e.unit)))return null;
  return {id:hash(row.LogKey),logKey:row.LogKey,at:row.ActionDtm,year:String(p.year),week:String(p.week),sourceIdentity:[...sources][0],entries:p.entries};
}
function readSavedAnalyses(root){
  const records=new Map();let scanned=0,invalid=0;
  if(!fs.existsSync(root))return {records,scanned,invalid};
  for(const dir of fs.readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&!d.isSymbolicLink())){
    for(const name of fs.readdirSync(path.join(root,dir.name)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).slice(0,10000)){
      const file=path.join(root,dir.name,name),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)continue;
      scanned++;try{const r=JSON.parse(fs.readFileSync(file,'utf8')),identity=JSON.parse(r.identity),year=r.version===2?identity[1]:identity[0]?.slice(0,4),text=r.version===2?identity[2]:identity[1];
        if(![1,2].includes(r.version)||r.version===2&&identity[0]!=='year-source-v2'||crypto.createHash('sha256').update(r.identity).digest('hex')+'.json'!==name||!Number.isFinite(r.savedAt)||!/^20\d{2}$/.test(year)||typeof text!=='string'||!Array.isArray(r.data?.orders)||r.data.success!==true){invalid++;continue;}
        const key=JSON.stringify([year,text]),old=records.get(key);if(!old||old.savedAt<r.savedAt)records.set(key,r);
      }catch{invalid++;}
    }
  }return {records,scanned,invalid};
}
async function loadConfirmedCorpus({root=process.cwd(),fetchImpl=fetch}={}){
  require('@next/env').loadEnvConfig(root,false,{info(){},error(){}});
  const sql=require('mssql'),pool=await sql.connect({server:process.env.DB_SERVER,port:Number(process.env.DB_PORT||1433),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD,connectionTimeout:10000,requestTimeout:30000,options:{encrypt:false,trustServerCertificate:true}});
  try{
    const logs=(await pool.request().query("SELECT TOP 500 LogKey,CONVERT(varchar(23),ActionDtm,126) ActionDtm,ActionType,Payload,Result FROM SystemActionLog WHERE ActionDtm>=DATEADD(day,-45,GETDATE()) AND ActionType IN ('SHIPMENT_ADJUST_BATCH','SHIPMENT_ADJUST_BATCH_UNDO') ORDER BY LogKey DESC")).recordset;
    const candidates=logs.map(confirmedOperation).filter(Boolean),undoScopes=new Set();
    for(const row of logs.filter(r=>r.ActionType==='SHIPMENT_ADJUST_BATCH_UNDO'&&r.Result==='SUCCESS')){try{const p=JSON.parse(row.Payload);for(const e of p.entries||[])undoScopes.add(JSON.stringify([p.year,p.week,e.custKey,e.prodKey]));}catch{}}
    const unique=new Map(),ambiguous=new Set();for(const c of candidates){const key=JSON.stringify([c.year,c.sourceIdentity]);if(unique.has(key))ambiguous.add(key);else unique.set(key,c);}
    const safe=[...unique.entries()].filter(([key,c])=>!ambiguous.has(key)&&!c.entries.some(e=>undoScopes.has(JSON.stringify([c.year,c.week,e.custKey,e.prodKey])))).map(([,c])=>c);
    const wanted=new Set(safe.map(c=>c.sourceIdentity));const sources=new Map(),days=[...new Set(safe.flatMap(c=>Array.from({length:7},(_,i)=>new Date(Date.parse(c.at.slice(0,10)+'T12:00:00Z')-i*86400000).toISOString().slice(0,10))))].sort().reverse();let feedPages=0,feedErrors=0;
    if(process.env.NENOVA_SALES_READ_TOKEN){for(const day of days){if(sources.size===wanted.size)break;let cursor='';for(let page=0;page<20;page++){
      const start=new Date(day+'T00:00:00+09:00'),end=new Date(start.getTime()+86400000),url=new URL('https://mindmap-viewer-production-adb2.up.railway.app/api/kakao/nenova-sales-feed');
      for(const [k,v] of Object.entries({from:start.toISOString(),to:end.toISOString(),afterKey:cursor,limit:'200'}))url.searchParams.set(k,v);
      try{const response=await fetchImpl(url,{headers:{Authorization:'Bearer '+process.env.NENOVA_SALES_READ_TOKEN},signal:AbortSignal.timeout(15000),redirect:'error'}),data=await response.json();feedPages++;if(!response.ok||data.ok!==true||!Array.isArray(data.messages))throw Error('feed');
        for(const m of data.messages){const id=`${m.source}|${m.chat_id}|${m.external_message_id}`;if(wanted.has(id)&&m.source==='nenovakakao'&&m.chatroom==='영업방'&&typeof m.message==='string'&&!m.truncated&&!m.is_truncated)sources.set(id,m);}
        if(!data.hasMore)break;if(!data.nextAfterKey||data.nextAfterKey===cursor)throw Error('cursor');cursor=data.nextAfterKey;
      }catch{feedErrors++;break;}
    }}}
    const saved=readSavedAnalyses(path.join(root,'data/runtime/paste-analysis')),excluded={sourceMissing:0,analysisMissing:0,partialCoverage:0,sourceTooLong:0},corpus=[];
    for(const op of safe){const message=sources.get(op.sourceIdentity);if(!message){excluded.sourceMissing++;continue;}
      const record=saved.records.get(JSON.stringify([op.year,message.message]));if(!record){excluded.analysisMissing++;continue;}
      const count=record.data.orders.reduce((n,o)=>n+(o.items||[]).length,0);if(count!==op.entries.length){excluded.partialCoverage++;continue;}
      if(message.message.length>6000){excluded.sourceTooLong++;continue;}
      corpus.push({...op,text:message.message,saved:record.data});
    }
    const masters=await pool.request().query("SELECT CustKey,CustName,CustArea FROM Customer WHERE isDeleted=0 ORDER BY CustName; SELECT ProdKey,ProdName,ISNULL(DisplayName,ProdName) DisplayName,FlowerName,CounName,OutUnit,ISNULL(BunchOf1Box,0) BunchOf1Box,ISNULL(SteamOf1Bunch,0) SteamOf1Bunch,ISNULL(SteamOf1Box,0) SteamOf1Box FROM Product WHERE isDeleted=0 ORDER BY ProdName; SELECT ProdKey,SUM(ISNULL(BoxQuantity,0)) TotalBox,SUM(ISNULL(BunchQuantity,0)) TotalBunch,SUM(ISNULL(SteamQuantity,0)) TotalSteam FROM OrderDetail WHERE isDeleted=0 AND ProdKey IS NOT NULL GROUP BY ProdKey; SELECT StoreKey,Payload FROM dbo.WebMappingStore WHERE StoreKey IN ('product','customer')");
    return {corpus,masters:masters.recordsets,summary:{logsScanned:logs.length,fullyVerifiedCandidates:candidates.length,repeatedSourceExcluded:ambiguous.size,safeUniqueOperations:safe.length,feedPages,feedErrors,sourceCount:sources.size,cachedAnalysesScanned:saved.scanned,invalidAnalyses:saved.invalid,...excluded,pairedSources:corpus.length,confirmedRows:corpus.reduce((n,c)=>n+c.entries.length,0),historicalPerformanceRecords:corpus.filter(c=>c.saved.analysisPerformance).length,modelConfigured:!!process.env.ANTHROPIC_API_KEY,salesReadConfigured:!!process.env.NENOVA_SALES_READ_TOKEN}};
  }finally{await pool.close();}
}
async function runAudit(options={}){const data=await loadConfirmedCorpus(options);return {mode:'inspect-only',readOnly:true,modelCalls:0,summary:data.summary};}
module.exports={confirmedOperation,readSavedAnalyses,loadConfirmedCorpus,runAudit};
if(require.main===module)runAudit().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.log(JSON.stringify({error:e.code||'AUDIT_FAILED',readOnly:true}));process.exitCode=1;});

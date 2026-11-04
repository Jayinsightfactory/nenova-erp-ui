'use strict';
// Private source text stays in process memory. Output is aggregate, never raw logs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const BASELINE='2f191418';
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,12);
function canonicalQuantity(qty,unit,p){
  if(!Number.isFinite(Number(qty))||Number(qty)<=0||!p)throw Error('UNIT_UNCONVERTIBLE');
  const out=p.OutUnit||'박스',f={박스:Number(p.SteamOf1Box),단:Number(p.SteamOf1Bunch),송이:1};
  if(unit===out)return Number(qty);
  if(unit==='박스'&&out==='단'&&Number(p.BunchOf1Box)>0)return Number(qty)*Number(p.BunchOf1Box);
  if(unit==='단'&&out==='박스'&&Number(p.BunchOf1Box)>0)return Number(qty)/Number(p.BunchOf1Box);
  if(!(f[unit]>0)||!(f[out]>0))throw Error('UNIT_UNCONVERTIBLE');return Number(qty)*f[unit]/f[out];
}
function compareConfirmed(entries,orders,products){
  const master=new Map(products.map(p=>[Number(p.ProdKey),p])),expected=new Map(),predicted=new Map();let unresolved=0;
  const add=(map,cust,prod,action,qty,unit)=>{const key=JSON.stringify([Number(cust),Number(prod),action]),n=canonicalQuantity(qty,unit,master.get(Number(prod)));map.set(key,(map.get(key)||0)+n);};
  for(const e of entries)add(expected,e.custKey,e.prodKey,e.type,e.qty,e.unit);
  for(const o of orders||[])for(const i of o.items||[]){if(!o.custMatch?.CustKey||!i.prodKey){unresolved++;continue;}try{add(predicted,o.custMatch.CustKey,i.prodKey,i.action==='취소'?'CANCEL':'ADD',i.qty,i.unit);}catch{unresolved++;}}
  let keyCorrect=0,quantityCorrect=0;for(const [k,n] of expected){if(predicted.has(k)){keyCorrect++;if(Math.abs(n-predicted.get(k))<=1e-6)quantityCorrect++;}}
  return {expectedGroups:expected.size,predictedGroups:predicted.size+unresolved,keyCorrect,quantityCorrect,unresolved,wrongKeyGroups:[...predicted.keys()].filter(k=>!expected.has(k)).length,complete:quantityCorrect===expected.size&&predicted.size===expected.size&&unresolved===0};
}
function aggregateScores(scores){
  const sum=key=>scores.reduce((n,s)=>n+Number(s[key]||0),0),expected=sum('expectedGroups'),predicted=sum('predictedGroups');
  return {cases:scores.length,expectedGroups:expected,predictedGroups:predicted,keyRecall:expected?sum('keyCorrect')/expected:null,quantityRecall:expected?sum('quantityCorrect')/expected:null,precision:predicted?sum('quantityCorrect')/predicted:null,fullyCorrectCases:scores.filter(s=>s.complete).length,unresolvedRows:sum('unresolved'),wrongKeyGroups:sum('wrongKeyGroups')};
}
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
function makeReplayArm(kind,data,budget,{root=process.cwd(),sources=global.__auditCandidateSources||{},sdkClient}={}){
    const swc=require('next/dist/build/swc'),cp=require('node:child_process'),cache=new Map(),timers=new Set(),stats={calls:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheCreationTokens:0,modelMs:0,usageResponses:0,failedCalls:0};
  const mappings=Object.fromEntries(data.masters[3].map(r=>[r.StoreKey,JSON.parse(r.Payload)]));
  const readonlyFs=new Proxy(fs,{get(target,key){if(/^(?:write|append|mkdir|rm|unlink|rename|copy|link|symlink|truncate|chmod|chown|open|createWrite)/.test(String(key)))return()=>{throw Error('AUDIT_WRITE_BLOCKED');};return target[key];}});
  const query=async sql=>{
    if(!/^\s*SELECT\b/i.test(sql)||/\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC|ALTER|CREATE|DROP)\b/i.test(sql))throw Error('AUDIT_WRITE_BLOCKED');
    if(/FROM Customer\b/.test(sql))return {recordset:data.masters[0]};
    if(/FROM Product\b/.test(sql)){
      let rows=data.masters[1];if(/TOP 300/.test(sql)){const predicates=[...sql.matchAll(/(FlowerName|ProdName|CounName) LIKE '%([^']+)%'/g)];if(predicates.length)rows=rows.filter(p=>predicates.some(m=>String(p[m[1]]||'').toLowerCase().includes(m[2].toLowerCase())));rows=rows.slice(0,300);}return {recordset:rows};
    }
    if(/FROM OrderDetail\b/.test(sql))return {recordset:data.masters[2]};
    if(/FROM OrderMaster\b/.test(sql))return {recordset:[]};
    throw Error('AUDIT_UNKNOWN_QUERY');
  };
  const ActualClient=require('@anthropic-ai/sdk').default||require('@anthropic-ai/sdk');
  const sdk=sdkClient||new ActualClient({apiKey:process.env.ANTHROPIC_API_KEY});
  class Client{constructor(){this.messages={create:async(input,options={})=>{
    const length=JSON.stringify(input).length;
    if(budget.calls>=32||budget.inputTokens>=400000||budget.characters+length>1500000){budget.stopped=true;throw Error('AUDIT_BUDGET');}
    budget.calls++;budget.characters+=length;stats.calls++;const start=performance.now();
    try{const result=await sdk.messages.create(input,{...options,timeout:30000,maxRetries:0}),u=result.usage||{};stats.usageResponses++;stats.inputTokens+=Number(u.input_tokens||0);stats.outputTokens+=Number(u.output_tokens||0);stats.cacheReadTokens+=Number(u.cache_read_input_tokens||0);stats.cacheCreationTokens+=Number(u.cache_creation_input_tokens||0);budget.inputTokens+=Number(u.input_tokens||0)+Number(u.cache_read_input_tokens||0)+Number(u.cache_creation_input_tokens||0);return result;}catch(e){stats.failedCalls++;throw e;}finally{stats.modelMs+=performance.now()-start;}
  }};}}
  function load(file){
    const relative=path.relative(root,file).split(path.sep).join('/');
    if(relative.startsWith('../')||(!relative.startsWith('lib/')&&!relative.startsWith('pages/api/orders/')))throw Error('AUDIT_IMPORT_SCOPE');
    if(cache.has(file))return cache.get(file).exports;
    if(relative==='lib/db.js')return {query,sql:require('mssql'),withTransaction:()=>{throw Error('AUDIT_WRITE_BLOCKED');}};
    if(relative==='lib/auth.js')return {withAuth:x=>x};
    if(relative==='lib/chat/costTracker.js')return {trackLLMCall:()=>{}};
    if(relative==='lib/parseMappings.js')return {loadMappings:async()=>structuredClone(mappings.product||{})};
    if(relative==='lib/customerMappings.js')return {loadCustomerMappings:async()=>structuredClone(mappings.customer||{})};
    let code=kind==='baseline'?cp.execFileSync('git',['show',`${BASELINE}:${relative}`],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']}):(sources[relative]||fs.readFileSync(file,'utf8'));
    code=swc.transformSync(code,{filename:file,jsc:{parser:{syntax:'ecmascript'},target:'es2022'},module:{type:'commonjs'}}).code;
    const module={exports:{}};cache.set(file,module);
    const localRequire=name=>{
      if(name==='@anthropic-ai/sdk')return Client;
      if(name==='fs'||name==='node:fs')return readonlyFs;
      if(name.startsWith('.')){let target=path.resolve(path.dirname(file),name);if(!path.extname(target))target+='.js';return load(target);}
      return require(name);
    };
    new Function('require','module','exports','__filename','__dirname','console','setTimeout','clearTimeout','process',code)(localRequire,module,module.exports,file,path.dirname(file),{log(){},warn(){},error(){}},(fn,ms)=>{const t=setTimeout(fn,ms);timers.add(t);return t;},clearTimeout,sdkClient?{...process,env:{...process.env,ANTHROPIC_API_KEY:'fixture'}}:process);
    if(relative==='lib/orderImportUnits.js'){
      if(!data.unitCatalog){try{data.unitCatalog=JSON.parse(fs.readFileSync(path.join(root,'data/order-import-units.json'),'utf8'));}catch{data.unitCatalog={};}}
      module.exports={...module.exports,loadImportUnits:()=>structuredClone(data.unitCatalog)};
    }
    return module.exports;
  }
  const handler=load(path.join(root,'pages/api/orders/parse-paste.js')).parsePasteHandler;
  return {async run(c){const before={...stats},start=performance.now();let status=200,result;try{await handler({method:'POST',body:{text:c.text,selectedOrderYear:c.year,mixedQuantitySupport:true},user:{userId:'read-only-audit'}},{status(n){status=n;return this;},json(r){result=r;}});}finally{for(const t of timers)clearTimeout(t);timers.clear();}return {status,result,performance:{elapsedMs:performance.now()-start,...Object.fromEntries(Object.keys(stats).map(k=>[k,stats[k]-before[k]]))}};}};
}
function summarizePerformance(rows){const values=rows.map(r=>r.elapsedMs).sort((a,b)=>a-b),sum=k=>rows.reduce((n,r)=>n+Number(r[k]||0),0);return {calls:sum('calls'),usageResponses:sum('usageResponses'),failedCalls:sum('failedCalls'),inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),cacheReadTokens:sum('cacheReadTokens'),cacheCreationTokens:sum('cacheCreationTokens'),medianMs:values.length?Math.round(values[Math.floor(values.length/2)]):null,p95Ms:values.length?Math.round(values[Math.ceil(values.length*.95)-1]):null,totalMs:Math.round(sum('elapsedMs'))};}
async function runAudit(options={}){
  const data=await loadConfirmedCorpus(options),historical=[],excludedTruth={unconvertible:0},valid=[];
  for(const c of data.corpus){try{historical.push(compareConfirmed(c.entries,c.saved.orders,data.masters[1]));valid.push(c);}catch{excludedTruth.unconvertible++;}}
  const report={mode:options.runModels?'paired-model-replay':'inspect-only',readOnly:true,baselineCommit:BASELINE,candidateCommit:global.__auditCandidateSha||'working-tree',summary:data.summary,historicalSavedPredictions:aggregateScores(historical),excludedTruth};
  if(!options.runModels)return {...report,modelCalls:0};
  const budget={calls:0,inputTokens:0,characters:0,stopped:false},baseline=makeReplayArm('baseline',data,budget,options),improved=makeReplayArm('improved',data,budget,options),oldScores=[],newScores=[],oldPerf=[],newPerf=[],cases=[];
  // Fixed newest-first sample, selected before inspecting model correctness.
  for(const c of valid.slice(0,8)){
    if(budget.stopped)break;const a=await baseline.run(c),b=await improved.run(c);if(budget.stopped)break;
    const score=r=>compareConfirmed(c.entries,r.result?.success?r.result.orders:[],data.masters[1]),old=score(a),next=score(b);
    oldScores.push(old);newScores.push(next);oldPerf.push(a.performance);newPerf.push(b.performance);
    cases.push({id:c.id,rows:c.entries.length,baseline:old,improved:next,baselineStatus:a.status,improvedStatus:b.status,localParse:b.result?.analysisPerformance?.localParse===true,regression:old.complete&&!next.complete});
  }
  return {...report,measuredNow:true,sameMasterAndAliasSnapshot:true,dbReadTimeExcluded:true,retrospectiveCurrentMappings:true,modelsLimitedTo:8,budgetStopped:budget.stopped,modelCalls:budget.calls,allKnownInputTokens:budget.inputTokens,baseline:{score:aggregateScores(oldScores),performance:summarizePerformance(oldPerf)},improved:{score:aggregateScores(newScores),performance:summarizePerformance(newPerf)},cases};
}
module.exports={confirmedOperation,readSavedAnalyses,loadConfirmedCorpus,runAudit,canonicalQuantity,compareConfirmed,aggregateScores,makeReplayArm};
if(require.main===module)runAudit().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.log(JSON.stringify({error:e.code||'AUDIT_FAILED',readOnly:true}));process.exitCode=1;});

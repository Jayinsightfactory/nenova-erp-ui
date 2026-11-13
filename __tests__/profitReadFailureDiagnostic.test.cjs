const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createProfitReadFailureDiagnostic:create,queryHash,poolSnapshot,MARKER}=require('../lib/profitReadFailureDiagnostic.cjs');
const source=fs.readFileSync(path.join(__dirname,'../pages/api/sales/profit-report.js'),'utf8');
const now=Date.parse('2026-11-06T12:00:00.000Z');
test('failure-only max3 per owner, dispatch phase/pool snapshot, zero/false and privacy',()=>{
 let time=now;const lines=[],pool={size:20,borrowed:20,available:0,pending:3};
 const d=create({orderYear:'2026',major:'44',pool,log:line=>lines.push(line),clock:()=>time});d.phase('current');
 const observation=d.begin('/* PRIVATE_COMMENT */ SELECT 1 FROM PRIVATE_TABLE WHERE ID IN (123, 456)');
 d.phase('postFence');pool.pending=0;pool.available=2;time+=45001;observation.timerFired();
 observation.failed({code:'EREQUEST',message:'PRIVATE_ERROR'});assert.equal(lines.length,0);
 for(let i=0;i<5;i++)observation.failed({code:i===1?'ETIMEOUT':'ECANCEL',message:'PRIVATE_ERROR',params:'PRIVATE_PARAMS'});
 assert.equal(lines.length,3);const event=JSON.parse(lines[0].slice(MARKER.length));
 assert.equal(event.pid,process.pid);assert.equal(event.phase,'current');assert.equal(event.elapsedMs,45001);assert.equal(event.explicitTimerFired,true);assert.equal(event.poolAtDispatch.pending,3);assert.equal(event.poolAtDispatch.available,0);assert.equal(event.poolAtFailure.pending,0);assert.equal(event.poolAtFailure.available,2);
 assert.doesNotMatch(lines.join(''),/PRIVATE|SELECT|params|message/);
 const other=[];create({orderYear:'2025',major:'44',pool,log:x=>other.push(x),clock:()=>now}).begin('SELECT 1').failed({code:'ECANCEL'});
 assert.equal(JSON.parse(other[0].slice(MARKER.length)).scope.year,'2025');
 for(const major of [0,false])create({orderYear:'2026',major,pool,log:x=>other.push(x)}).begin('SELECT 1').failed({code:'ECANCEL'});assert.equal(other.length,1);
 const zero=[];create({orderYear:'2026',major:'01',pool,log:x=>zero.push(x),clock:()=>now}).begin('SELECT 1').failed({code:'ETIMEOUT'});
 assert.equal(JSON.parse(zero[0].slice(MARKER.length)).elapsedMs,0);assert.equal(JSON.parse(zero[0].slice(MARKER.length)).explicitTimerFired,false);
});
test('getters/logger failures cannot replace source errors; hash matches exact existing profiler normalization',()=>{
 const pool={get size(){throw Error('PRIVATE');},borrowed:0,available:false,pending:1000001};assert.deepEqual(poolSnapshot(pool),{size:null,borrowed:0,available:null,pending:null});
 const d=create({orderYear:'2026',major:'44',pool,log:()=>{throw Error('PRIVATE_LOG');}});assert.doesNotThrow(()=>d.begin('SELECT 1').failed({code:'ECANCEL'}));
 const profile=fs.readFileSync(path.join(__dirname,'../scripts/profile-profit-canonical-read.cjs'),'utf8');
 const start=profile.indexOf('const normalized=')+'const normalized='.length,end=profile.indexOf(';',start),normalize=new Function('clean','return '+profile.slice(start,end));
 const sql='/*x*/ SELECT  a\nFROM t --ignored\nWHERE id IN (1, 22)',clean=sql.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/--[^\n]*/g,' ').trim();
 assert.equal(queryHash(sql),require('node:crypto').createHash('sha256').update(normalize(clean)).digest('hex').slice(0,12));
 assert.equal(queryHash(sql),queryHash('SELECT a FROM t WHERE id IN (55,66)'));
});
async function fixture({failPhase,code='ECANCEL',timerFired=true,throwLogger=false}={}){
 const {withErpReadContext:scope,currentErpReadContext:context}=await import('../lib/erpReadContext.js');
 const {shareLatestProfitRead:share}=await import('../lib/profitLatestInFlight.mjs');
 const error=Object.assign(Error('PRIVATE_SOURCE'),{code}),logs=[],timers=[];let creates=0,cancels=0,fences=0;
 const pool={size:1,borrowed:1,available:0,pending:0,request(){return {input(){return this;},cancel(){cancels++;},async query(statement){if(statement==='SELECT fence')fences++;if(statement==='SELECT '+failPhase||(failPhase==='postFence'&&statement==='SELECT fence'&&fences===2)){if(timerFired)timers.at(-1).fn();throw error;}return {recordset:[]};}};}};
 const q=statement=>context().query('SELECT '+statement);
 const deps={currentErpReadContext:context,shareLatestProfitRead:share,getPool:async()=>pool,withErpReadContext:scope,createProfitReadFailureDiagnostic:options=>{creates++;return create({...options,log:line=>{if(throwLogger)throw Error('PRIVATE_LOGGER');logs.push(line);}});},
  previousReportPeriod:async(year)=>({orderYear:year,major:'43'}),loadSourceFingerprints:async()=>{await q('fence');return {map:new Map()};},latestProfitInvoiceFence:async()=>0,settlementScopeFence:async()=> 'fixture-settlement-digest',materializeProfitPayload:v=>v,
  loadReportData:async major=>{await q(major==='44'?'current':'prior');return {rows:[],totals:{C:0}};},applyTemplateDutyToReport:async raw=>{await q('duty');return raw;},
  clearTemplateDutyCache:()=>{},finalizeProfitCachePayload:async(raw,options)=>({...await options.finalize(),cacheSourcePayload:raw}),
  setTimeout:(fn,ms)=>{assert.equal(ms,45000);const t={fn,cleared:false};timers.push(t);return t;},clearTimeout:t=>{t.cleared=true;}};
 const start=source.indexOf('async function loadCoherentLatestReport('),end=source.indexOf('export async function loadWeeklyReportPayload',start);
 const load=new Function(...Object.keys(deps),source.slice(start,end)+';return loadCoherentLatestReport;')(...Object.values(deps));
 return {load,error,logs,timers,scope,context,get creates(){return creates;},get cancels(){return cancels;}};
}
test('actual reader keeps45000ms, source error identity and captured phase; logger failure cannot mask cancellation',async()=>{
 for(const [failPhase,expected]of [['fence','preFence'],['current','current'],['prior','prior'],['duty','duty'],['postFence','postFence']]){
  const f=await fixture({failPhase});await assert.rejects(f.load('44','2026'),e=>e===f.error);assert.equal(f.cancels,1);assert.ok(f.timers.every(t=>t.cleared));
  const event=JSON.parse(f.logs[0].slice(MARKER.length));assert.equal(event.phase,expected);assert.equal(event.explicitTimerFired,true);assert.equal(f.logs.length,1);
 }
 const f=await fixture({failPhase:'current',throwLogger:true});await assert.rejects(f.load('44','2026'),e=>e===f.error);assert.ok(f.timers.every(t=>t.cleared));
 const native=await fixture({failPhase:'prior',code:'ETIMEOUT',timerFired:false});await assert.rejects(native.load('44','2026'),e=>e===native.error);assert.equal(JSON.parse(native.logs[0].slice(MARKER.length)).explicitTimerFired,false);
});
test('ordinary success logs0, overlapping waiter adds no diagnostic owner; active transaction/replay bypass stays complete',async()=>{
 const f=await fixture();const [a,b]=await Promise.all([f.load('44','2026'),f.load('44','2026')]);assert.equal(f.creates,1);assert.equal(f.logs.length,0);assert.deepEqual(a,b);assert.notEqual(a,b);
 const active=await fixture();await active.scope({queryFn:async()=>({recordset:[]})},()=>active.load('44','2026'));assert.equal(active.creates,0);assert.equal(active.timers.length,0);assert.equal(active.logs.length,0);
 assert.match(source,/if\(currentErpReadContext\(\)\)return work\(\);\s*const execute=async/);
 assert.match(source,/return forCache\?execute\(\):shareLatestProfitRead\(orderYear,major,execute\)/);
 assert.match(source,/const after=await signature\(\);\s*if\(before!==after\)/);
});
test('explicit cache readers keep independent owners/raw donors and original failure identity',async()=>{
 const f=await fixture();const[a,b]=await Promise.all([f.load('44','2026',{forCache:true}),f.load('44','2026',{forCache:true})]);assert.equal(f.creates,2);assert.equal(a.cacheSourcePayload.major,'44');assert.equal(b.cacheSourcePayload.major,'44');assert.equal(f.logs.length,0);
 const failed=await fixture({failPhase:'duty'});await assert.rejects(failed.load('44','2026',{forCache:true}),e=>e===failed.error);assert.equal(failed.logs.length,1);assert.ok(failed.timers.every(t=>t.cleared));
});
function summary(){const runtime=fs.readFileSync(path.join(__dirname,'../scripts/diagnose-runtime-readonly.cjs'),'utf8');return new Function(runtime.slice(runtime.indexOf('function summarizeProfitReadFailures'),runtime.indexOf('function summarizeMemoryRestarts'))+';return summarizeProfitReadFailures;')();}
test('bounded recent summary accepts exact safe schema only, preserves crossyear and latest3, rejects raw extras',()=>{
 const lines=[],d=create({orderYear:'2026',major:'44',pool:{},clock:()=>now,log:x=>lines.push(x)});d.begin('SELECT 1').failed({code:'ECANCEL'});const event=JSON.parse(lines[0].slice(MARKER.length));
 const line=v=>'PM2 prefix '+MARKER+JSON.stringify(v),valid=[event,{...event,scope:{year:'2025',major:'44'}},{...event,at:'2026-11-06T11:59:59.000Z'},{...event,code:'ETIMEOUT'}];
 const bad=[{...event,token:'PRIVATE_TOKEN'},{...event,phase:'PRIVATE_SQL'},{...event,queryHash:'PRIVATE'}, {...event,scope:{year:'2026',major:'44',CustKey:'PRIVATE'}},{...event,at:'2026-11-06T11:29:59.999Z'},{...event,at:'2026-11-06T12:00:00.001Z'},{...event,explicitTimerFired:0},{...event,poolAtFailure:{...event.poolAtFailure,pending:'PRIVATE'}},{...event,code:'EREQUEST'}];
 const result=summary()([...valid,...bad].map(line).join('\n')+'\n'+MARKER+'PRIVATE_BROKEN_JSON',{since:now-1800000,until:now});assert.equal(result.count,4);assert.equal(result.latest.length,3);assert.equal(result.explicitTimerFiredCount,0);assert.ok(result.latest.some(v=>v.scope.year==='2025'));assert.doesNotMatch(JSON.stringify(result),/PRIVATE|SELECT|CustKey/);
 const pids=summary()([event,{...event,pid:1},{...event,pid:false},{...event,pid:0},{...event,pid:'PRIVATE'}].map(line).join('\n'),{since:now-1800000,until:now});assert.equal(pids.count,2);assert.deepEqual(pids.latest.map(v=>v.pid),[process.pid,1],'do not hide valid pre-restart PID history');
});
test('runtime integration uses existing bounded tail and never outputs raw marker lines',()=>{
 const runtime=fs.readFileSync(path.join(__dirname,'../scripts/diagnose-runtime-readonly.cjs'),'utf8'),lines=[],at=Date.now();
 create({orderYear:'2026',major:'44',pool:{pending:0},clock:()=>at,log:x=>lines.push(x)}).begin('SELECT PRIVATE_SOURCE').failed({code:'ECANCEL'});
 const content=lines[0]+'\nPRIVATE_TOKEN_SQL_BODY',logs=[];
 const fakeFs={statSync:file=>{if(file!=='/SAFE_LOG')throw Error();return {size:5*1024*1024};},openSync:()=>1,readSync:(fd,buf)=>{buf.fill(' ');buf.write(content+'\n');return buf.length;},closeSync:()=>{}};
 const p={name:'nenova-erp',pid:process.pid,pm2_env:{pm_id:0,pm_uptime:at,pm_err_log_path:'/SAFE_LOG'}};
 require('node:vm').runInNewContext(runtime,{Buffer,Date,process:{env:{}},require:n=>({'node:fs':fakeFs,'node:path':path,'node:os':{homedir:()=>'/SAFE',uptime:()=>1,loadavg:()=>[0],totalmem:()=>1,freemem:()=>1},'node:child_process':{execFileSync:()=>JSON.stringify([p]),spawnSync:()=>({status:0,stdout:''})}}[n]),console:{log:x=>logs.push(x)}});
 const result=logs.map(JSON.parse).find(v=>v.section==='profit_read_failures_30m');assert.equal(result.count,1);assert.equal(result.scannedBytes,4*1024*1024);assert.equal(result.tailTruncated,true);assert.equal(result.latest[0].pid,process.pid);assert.doesNotMatch(logs.join(''),/PRIVATE|NENOVA_PROFIT_READ_FAILURE/);
});

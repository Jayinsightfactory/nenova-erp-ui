const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createProfitReadFailureDiagnostic:create,sourceChangeSummary:summary,timestampOnly,SOURCE_MARKER}=require('../lib/profitReadFailureDiagnostic.cjs');
const api=fs.readFileSync(path.join(__dirname,'../pages/api/sales/profit-report.js'),'utf8'),time=Date.parse('2026-11-06T12:00:00.000Z');
const signature=(erp,invoice='PRIVATE_DIGEST')=>JSON.stringify({erp,invoice});
test('memory-only source diff emits safe component scopes, bounded changes, timestamp-only tri-state and invoice coverage only',()=>{
 const before=signature([['SHIP:2026:45','2|17|2026-11-06T19:40:00'],['WH:2025:44','1|2|'],['PRODUCT::','99|-77|'],['FC:2026:44','9|3|PRIVATE_M']]);
 const after=signature([['SHIP:2026:45','2|17|2026-11-06T19:41:00'],['PRODUCT::','99|-78|'],['FC:2026:44','9|3|PRIVATE_NEW_M'],['STOCK:2026:44','1|88|']], 'PRIVATE_NEW_DIGEST');
 const result=summary(before,after,['2026','2025']);assert.equal(result.changedCount,5);assert.equal(result.invoiceChanged,true);assert.deepEqual(result.coveredYears,['2025','2026']);assert.equal(result.truncated,false);
 const find=c=>result.changes.find(x=>x.component===c);assert.equal(find('SHIP').timestampOnly,true);assert.equal(find('PRODUCT').timestampOnly,false);assert.equal(find('FC').timestampOnly,null);assert.equal(find('WH').kind,'removed');assert.equal(find('STOCK').kind,'added');assert.equal(find('WH').year,'2025');assert.equal(find('SHIP').major,'45');
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE|19:40|19:41|checksum|digest/);
 const large=summary(signature([]),signature(Array.from({length:30},(_,i)=>['SHIP:2026:'+String(i+1).padStart(2,'0'),'0||'])),['2026']);assert.equal(large.changedCount,30);assert.equal(large.changes.length,20);assert.equal(large.truncated,true);
 const invalid=summary(signature([]),signature([['PRIVATE:2026:44','PRIVATE_VALUE'],['SHIP:PRIVATE:44','PRIVATE_VALUE'],['SHIP:2026:00','PRIVATE_VALUE']]),['2026']);assert.equal(invalid.changedCount,3);assert.deepEqual(invalid.changes,[]);assert.equal(invalid.truncated,true);assert.doesNotMatch(JSON.stringify(invalid),/PRIVATE/);
 assert.equal(timestampOnly('0||','0||2026-11-06T12:00:00'),true);assert.equal(timestampOnly('1|-|','1|-|2026-11-06T12:00:00'),null);assert.equal(timestampOnly('1|2|X|Y','1|2|Z'),null);
});
test('source change owner logs once, success0, logger failure cannot escape, malformed/false/zero scopes leak nothing',()=>{
 const before=signature([]),after=signature([['SHIP:2026:45','1|2|']]),logs=[];
 const d=create({orderYear:'2026',major:'44',pool:{},pid:12,clock:()=>time,log:x=>logs.push(x)});d.sourceChanged(before,before,['2026']);assert.equal(logs.length,0);d.sourceChanged(before,after,['2026']);d.sourceChanged(before,after,['2026']);assert.equal(logs.length,1);
 const e=JSON.parse(logs[0].slice(SOURCE_MARKER.length));assert.equal(e.pid,12);assert.deepEqual(e.scope,{year:'2026',major:'44'});assert.equal(e.at,'2026-11-06T12:00:00.000Z');
 assert.doesNotThrow(()=>create({orderYear:'2026',major:'44',pool:{},log:()=>{throw Error('PRIVATE');}}).sourceChanged(before,after,['2026']));
 for(const major of [0,false])create({orderYear:'2026',major,pool:{},log:x=>logs.push(x)}).sourceChanged(before,after,['2026']);assert.equal(logs.length,1);
 assert.doesNotThrow(()=>d.sourceChanged('PRIVATE_BROKEN',after,['2026']));
});
async function reader({changed=true,invoiceOnly=false,throwLogger=false}={}){
 const {withErpReadContext:scope,currentErpReadContext:context}=await import('../lib/erpReadContext.js'),{shareLatestProfitRead:share}=await import('../lib/profitLatestInFlight.mjs');
 const queries=[],calls=[],logs=[],captured=[];let fingerprints=0,invoices=0,owners=0;
 const pool={request(){return {input(){return this;},query:async statement=>{queries.push(statement);return {recordset:[]};},cancel(){assert.fail('no timer should fire');}};}};
 const q=statement=>context().query(statement);
 const deps={currentErpReadContext:context,shareLatestProfitRead:share,getPool:async()=>pool,withErpReadContext:scope,
  createProfitReadFailureDiagnostic:options=>{owners++;const d=create({...options,clock:()=>time,log:x=>{if(throwLogger)throw Error('PRIVATE_LOG');logs.push(x);}});return {...d,sourceChanged:(...args)=>{captured.push(args);d.sourceChanged(...args);}};},
  previousReportPeriod:async year=>({orderYear:year,major:'43'}),loadSourceFingerprints:async(years,options)=>{calls.push({years,options});await q('SELECT fence');fingerprints++;return {map:new Map([['SHIP:2026:45',changed&&!invoiceOnly&&fingerprints===2?'1|22|':'1|11|']])};},
  latestProfitInvoiceFence:async years=>{await q('SELECT invoice');invoices++;return changed&&invoiceOnly&&invoices===2?'PRIVATE_NEW_DIGEST':'PRIVATE_DIGEST';},
  materializeProfitPayload:v=>v,loadReportData:async(major,year)=>{calls.push({major,year});await q('SELECT '+major);return {rows:[],totals:{C:0}};},applyTemplateDutyToReport:async raw=>{await q('SELECT duty');return raw;},setTimeout:(fn,ms)=>{assert.equal(ms,45000);return 1;},clearTimeout:()=>{}};
 const start=api.indexOf('async function loadCoherentLatestReport('),end=api.indexOf('export async function loadWeeklyReportPayload',start),load=new Function(...Object.keys(deps),api.slice(start,end)+';return loadCoherentLatestReport;')(...Object.values(deps));
 return {load,logs,queries,calls,captured,scope,get owners(){return owners;},get fingerprints(){return fingerprints;},get invoices(){return invoices;}};
}
test('actual reader retains full signature shape, SQL sequence/two fences and typed409; overlapping owner1, active ERP bypass',async()=>{
 const expected=['SELECT fence','SELECT invoice','SELECT 44','SELECT 43','SELECT duty','SELECT fence','SELECT invoice'];
 for(const options of [{},{invoiceOnly:true},{throwLogger:true}]){
  const f=await reader(options),results=await Promise.allSettled([f.load('44','2026'),f.load('44','2026')]);assert.ok(results.every(x=>x.status==='rejected'&&x.reason.statusCode===409&&x.reason.code==='PROFIT_SOURCES_CHANGED'));assert.equal(results[0].reason,results[1].reason);
  assert.equal(f.owners,1);assert.equal(f.captured.length,1);assert.equal(f.fingerprints,2);assert.equal(f.invoices,2);assert.deepEqual(f.queries,expected);
  const [before,after,years]=f.captured[0];assert.equal(before,signature([['SHIP:2026:45','1|11|']]));assert.equal(after,signature([['SHIP:2026:45',options.invoiceOnly?'1|11|':'1|22|']],options.invoiceOnly?'PRIVATE_NEW_DIGEST':'PRIVATE_DIGEST'));assert.deepEqual(years,['2026','2025']);
  assert.deepEqual(f.calls.filter(c=>c.options),[{years:['2026','2025'],options:{force:true}},{years:['2026','2025'],options:{force:true}}]);assert.deepEqual(f.calls.filter(c=>c.major),[{major:'44',year:'2026'},{major:'43',year:'2026'}]);
  assert.equal(f.logs.length,options.throwLogger?0:1);if(f.logs.length)assert.doesNotMatch(f.logs[0],/PRIVATE|1\|11|1\|22/);
 }
 const success=await reader({changed:false});assert.deepEqual(await success.load('44','2026'),{rows:[],totals:{C:0},major:'44',orderYear:'2026'});assert.deepEqual(success.queries,expected);assert.equal(success.logs.length,0);
 const active=await reader();await assert.rejects(active.scope({queryFn:async()=>({recordset:[]})},()=>active.load('44','2026')),e=>e.statusCode===409&&e.code==='PROFIT_SOURCES_CHANGED');assert.equal(active.owners,0);assert.equal(active.logs.length,0);assert.equal(active.captured.length,0);
});
function parser(){const source=fs.readFileSync(path.join(__dirname,'../scripts/diagnose-runtime-readonly.cjs'),'utf8');return new Function(source.slice(source.indexOf('function summarizeProfitSourceChanges'),source.indexOf('function summarizeProfitReadFailures'))+';return summarizeProfitSourceChanges;')();}
test('source marker strict recent parser rejects extra/private/checksum data and preserves prior PID history',()=>{
 const lines=[],d=create({orderYear:'2026',major:'44',pool:{},pid:12,clock:()=>time,log:x=>lines.push(x)});d.sourceChanged(signature([]),signature([['WPR:2025:44','1|2|']]),['2025','2026']);const event=JSON.parse(lines[0].slice(SOURCE_MARKER.length));
 const line=v=>'PM2 prefix '+SOURCE_MARKER+JSON.stringify(v),valid=[event,{...event,pid:13}];
 const invalid=[{...event,checksum:'PRIVATE'},{...event,coveredYears:['PRIVATE']},{...event,scope:{...event.scope,token:'PRIVATE'}},{...event,truncated:true},{...event,changes:[{...event.changes[0],component:'PRIVATE'}]},{...event,changes:[{...event.changes[0],timestampOnly:'PRIVATE'}]},{...event,at:'2026-11-06T11:29:59.000Z'},{...event,at:'2026-11-06T12:00:00.001Z'},{...event,pid:0}];
 const result=parser()([...valid,...invalid].map(line).join('\n')+'\n'+SOURCE_MARKER+'PRIVATE_BAD_JSON',{since:time-1800000,until:time});assert.equal(result.count,2);assert.deepEqual(result.latest.map(e=>e.pid),[12,13]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|checksum/);
});
test('actual stock-notes handler preserves200/400/405, exposes only exact typed409 code and generic500 without raw response errors',async()=>{
 const {parseStockAdjustmentScope}=await import('../lib/stockAdjustmentReportNotes.js');
 const source=fs.readFileSync(path.join(__dirname,'../pages/api/sales/profit-stock-adjustment-notes.js'),'utf8');
 const factory=source.slice(source.indexOf('export default withAuth')).replace('export default ','return ').replace("await import('../../../lib/profitImpactNotesData')",'modules.impact').replace("await import('./profit-report')",'modules.report');
 async function run(error,req={method:'GET',query:{year:'2026',week:'44',detail:'1'}}){
  const modules={impact:{loadProfitImpactNotes:async p=>({orderYear:p.orderYear,major:p.major})},report:{loadWeeklyReportPayload:async(major,orderYear)=>{if(error)throw error;return {rows:[],major,orderYear};}}};
  const handler=new Function('withAuth','query','sql','STOCK_ADJUSTMENT_NOTES_SQL','parseStockAdjustmentScope','buildStockAdjustmentNotes','modules','console',factory)(h=>h,async()=>({recordset:[]}),{NVarChar:0},'SELECT fixture',parseStockAdjustmentScope,()=>({}),modules,{error:()=>{}});
  const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};await handler(req,res);return res;
 }
 const known=await run({statusCode:409,code:'PROFIT_SOURCES_CHANGED',message:'PRIVATE_SQL'});assert.equal(known.code,409);assert.equal(known.body.code,'PROFIT_SOURCES_CHANGED');assert.equal(known.body.message,'재고조정 이력을 조회하지 못했습니다. 다시 시도해 주세요.');
 for(const error of [{statusCode:409,code:'ECANCEL'},{statusCode:409,code:'PRIVATE_CODE'},{statusCode:'409',code:'PROFIT_SOURCES_CHANGED'},{statusCode:500,code:'PROFIT_SOURCES_CHANGED'},Error('PRIVATE_BODY')]){const res=await run(error);assert.equal(res.code,500);assert.equal(res.body.code,undefined);assert.doesNotMatch(JSON.stringify(res.body),/PRIVATE|ECANCEL|PROFIT_SOURCES_CHANGED/);}
 assert.equal((await run()).code,200);const previousYear=await run(null,{method:'GET',query:{year:'2025',week:'44',detail:'1'}});assert.equal(previousYear.code,200);assert.equal(previousYear.body.orderYear,'2025');assert.equal((await run(null,{method:'POST',query:{}})).code,405);assert.equal((await run(null,{method:'GET',query:{year:'bad',week:'44'}})).code,400);
});
test('runtime new marker integration reads only existing bounded tail and emits no raw source values',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../scripts/diagnose-runtime-readonly.cjs'),'utf8'),lines=[],now=Date.now();
 create({orderYear:'2026',major:'44',pool:{},clock:()=>now,log:x=>lines.push(x)}).sourceChanged(signature([['SHIP:2026:45','1|2|']]),signature([['SHIP:2026:45','1|3|']]),['2025','2026']);
 const logs=[],fakeFs={statSync:file=>{if(file!=='/SAFE_LOG')throw Error();return {size:5*1024*1024};},openSync:()=>1,readSync:(fd,buf)=>{buf.fill(' ');buf.write(lines[0]+'\nPRIVATE_RAW_SQL\n');return buf.length;},closeSync:()=>{}};
 const p={name:'nenova-erp',pid:process.pid,pm2_env:{pm_id:0,pm_uptime:now,pm_err_log_path:'/SAFE_LOG'}};
 require('node:vm').runInNewContext(source,{Buffer,Date,process:{env:{}},require:n=>({'node:fs':fakeFs,'node:path':path,'node:os':{homedir:()=>'/SAFE',uptime:()=>1,loadavg:()=>[0],totalmem:()=>1,freemem:()=>1},'node:child_process':{execFileSync:()=>JSON.stringify([p]),spawnSync:()=>({status:0,stdout:''})}}[n]),console:{log:x=>logs.push(x)}});
 const result=logs.map(JSON.parse).find(v=>v.section==='profit_source_changes_30m');assert.equal(result.count,1);assert.equal(result.scannedBytes,4*1024*1024);assert.equal(result.tailTruncated,true);assert.equal(result.latest[0].changes[0].component,'SHIP');assert.doesNotMatch(logs.join(''),/PRIVATE|NENOVA_PROFIT_SOURCE_CHANGED|1\|2|1\|3/);
});

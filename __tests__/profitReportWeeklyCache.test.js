// No environment loading and no live DB connection. Execute the production function bodies with SQL spies.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
async function main(){
  const C=await import('../lib/profitReportStoredCalculation.js');
  const S=await import('../lib/profitReportSnapshot.js');
  const M=await import('../lib/profitReportMonthly.js');
  const raw={orderYear:'2026',major:'31',note:'saved note',rows:[{category:'태국',variant:'normal',auto:{N:100,L:0,O:0,Q:2,S:1},manual:{R:100,H:0},stock:{}}]};
  const frozen=C.materializeProfitPayload(raw);
  assert.equal(C.isMaterializedProfitPayload(frozen),true);
  assert.equal(frozen.rows[0].calc.H,0);
  assert.equal(frozen.rows[0].calc.F,null);
  assert.equal(frozen.totals.J,null);
  frozen.rows[0].auto.N=999999; // Changed inputs/current formula must not alter the saved result.
  frozen.rows[0].calc.C=12345;
  frozen.rows[0].calc.D=0.123;
  frozen.totals.C=54321;
  assert.equal(C.profitDisplayCalculation(frozen).rows[0].calc.C,12345);
  assert.equal(C.profitDisplayCalculation(frozen).totals.C,54321);
  assert.notEqual(C.profitDisplayCalculation(frozen,{'태국':{AC:1}}).rows[0].calc.C,12345);
  assert.equal(C.profitDisplayCalculation({...frozen,confirmed:{},confirmedTotals:{C:7}},{'태국':{AC:1}}).totals.C,7);
  const stored={orderYear:'2026',major:'31',payload:frozen,versionNo:1};
  assert.equal(S.storedProfitPayload(stored).rows[0].calc.C,12345);
  for(const invalid of [null,{payload:raw},{...stored,payload:{...frozen,totals:null}},{...stored,orderYear:'2025'}])
    assert.throws(()=>S.storedProfitPayload(invalid,{orderYear:'2026',major:'31'}),e=>e.statusCode===409&&e.code==='SNAPSHOT_NOT_READY');

  const api=read('pages/api/sales/profit-report.js');
  const loaderBody=api.slice(api.indexOf('export async function currentProfitPeriod'),api.indexOf('export async function loadAnnualMonthlyReportData')).replaceAll('export ','');
  let live=0, reads=0, confirm=null,diagnostics=0;
  const scopeFixture={dateOnly:'2026-10-28',orderYearWeek:'202644'};
  const dependencies={
    applyTemplateDutyToReport:async payload=>payload,
    loadProfitReportCalendar:async()=>[scopeFixture],resolveCurrentProfitWeek:()=>({orderYear:'2026',major:'44'}),
    getActiveConfirm:async()=>confirm,buildConfirmedPayload:async()=>({confirmed:{revisionNo:4},rows:[],confirmedTotals:{C:71}}),
    loadReportData:async()=>{live++;return raw;},readStoredProfitPayload:async(y,m)=>{reads++;return S.storedProfitPayload(stored,{orderYear:y,major:m});},
    storedProfitPayload:S.storedProfitPayload,saveProfitCache:()=>{throw Error('unexpected write');},manualInputManifest:{},
    unclassifiedDetailsByCategory:async()=>{diagnostics++;return [{prodKey:1}];},
  };
  const L=new Function(...Object.keys(dependencies),`${loaderBody};return {loadWeeklyReportPayload};`)(...Object.values(dependencies));
  assert.equal((await L.loadWeeklyReportPayload('31','2026')).readMode,'stored');
  assert.equal(live,0);assert.equal(reads,1);
  await assert.rejects(L.loadWeeklyReportPayload('31','2025'),e=>e.code==='SNAPSHOT_NOT_READY');
  await assert.rejects(L.loadWeeklyReportPayload('31','2026',{storedResult:null}),e=>e.code==='SNAPSHOT_NOT_READY');
  assert.equal(live,0);
  await L.loadWeeklyReportPayload('44','2026');assert.equal(live,1);
  await L.loadWeeklyReportPayload('31','2026',{mode:'liveAudit'});assert.equal(live,2);
  confirm={initialized:true,confirm:{revisionNo:4}};
  assert.equal((await L.loadWeeklyReportPayload('31','2026')).readMode,'confirmed');
  assert.equal(live,2);
  assert.equal(diagnostics,0);
  const auditedConfirm=await L.loadWeeklyReportPayload('31','2026',{mode:'liveAudit'});
  assert.equal(diagnostics,1);assert.equal(live,2);assert.equal(auditedConfirm.confirmedTotals.C,71);
  assert.equal(auditedConfirm.unclassifiedDetailsSource,'live_read_only');
  const confirmBody=api.slice(api.indexOf('async function buildConfirmedPayload'),api.indexOf('export async function currentProfitPeriod'));
  assert.doesNotMatch(confirmBody,/loadManual\(|currencyRates\(|unclassifiedDetailsByCategory\(/);

  const moduleSource=read('lib/profitReportSnapshot.js').replace(/^import .*;\r?$/gm,'').replaceAll('export ','')
    .replace('async function computeWeekFingerprint(','async function unusedFingerprint(');
  const sql={NVarChar:()=>{},MAX:-1,Bit:'bit',Int:'int'};
  async function saveCase(options={}){
    let inTx=false,writes=0,computed=0,fingerprints=0,committed=false,rolledBack=false;
    const queries=[];
    const query=async(text,params)=>{
      queries.push({text,params,inTx});
      if(text.includes('OBJECT_ID'))return {recordset:[{id:1}]};
      assert.equal(inTx,true);
      if(text.includes('sp_getapplock'))return {recordset:[{LockResult:options.busy?-1:0}]};
      if(text.includes('FROM dbo.WebProfitReportConfirm'))return {recordset:options.confirmed||(options.confirmAfterCompute&&computed)?[{ConfirmKey:8}]:[]};
      if(text.includes("Reason=N'WEEKLY'"))return {recordset:options.duplicate?[{SnapKey:1}]:[]};
      if(text.includes('SELECT TOP 1 *'))return {recordset:options.existing?[{PayloadJson:JSON.stringify(options.wrongScope?{...frozen,orderYear:'2025'}:frozen),OrderYear:'2026',MajorWeek:'31'}]:[]};
      if(text.includes('INSERT INTO dbo.WebProfitReportSnapshot')){writes++;if(options.insertFails)throw Error('write fail');return {recordset:[{SnapKey:10,VersionNo:2,CreatedAt:'2026-10-28T00:00:00Z'}]};}
      throw Error('unexpected SQL '+text);
    };
    const deps={crypto,query,sql,withTransaction:async fn=>{inTx=true;try{const out=await fn(query);committed=true;return out;}catch(e){rolledBack=true;throw e;}finally{inTx=false;}},
      isMaterializedProfitPayload:C.isMaterializedProfitPayload,materializeProfitPayload:C.materializeProfitPayload,
      loadProfitCategoryOverrides:()=>({}),calcHashModule:{computeProfitReportCalcHash:()=> 'test'},
      computeWeekFingerprint:async(y,m,opts)=>{assert.equal(opts.force,true);fingerprints++;return {hash:options.sourcesChanged&&fingerprints>1?'changed':'test',components:{}};}};
    const module=new Function(...Object.keys(deps),`${moduleSource};return {saveProfitCache};`)(...Object.values(deps));
    let result,error;
    try{result=await module.saveProfitCache({orderYear:options.year||'2026',major:'31',reason:options.reason||'WEEKLY',actor:'weekly-scheduler:2026-10-28',scheduleSlot:'2026-10-28'},async()=>{computed++;if(options.computeFails)throw Error('compute fail');return raw;});}catch(e){error=e;}
    return {result,error,writes,computed,fingerprints,committed,rolledBack,queries};
  }
  const saved=await saveCase();assert.equal(saved.result.action,'saved');assert.equal(saved.writes,1);assert.equal(saved.committed,true);
  assert.equal(saved.result.payload.cachePolicyVersion,1);assert.equal(saved.result.payload.scheduleSlot,'2026-10-28');
  assert(saved.queries.filter(q=>!q.text.includes('OBJECT_ID')).every(q=>q.inTx&&q.params.y.value==='2026'&&q.params.m.value==='31'));
  assert.equal(saved.queries.filter(q=>q.text.includes('WebProfitReportConfirm')).length,2);
  assert.equal(saved.fingerprints,2);
  const locks=saved.queries.filter(q=>q.text.includes('WebProfitReportConfirm'));
  assert.doesNotMatch(locks[0].text,/UPDLOCK/);assert.match(locks[1].text,/UPDLOCK,HOLDLOCK/);
  for(const [options,reason] of [[{duplicate:true},'schedule_duplicate'],[{confirmed:true},'confirmed'],[{existing:true,reason:'BACKFILL'},'existing_policy_cache']]){
    const r=await saveCase(options);assert.equal(r.result.reason,reason);assert.equal(r.writes,0);assert.equal(r.computed,0);assert.equal(r.fingerprints,0);
  }
  const race=await saveCase({confirmAfterCompute:true});assert.equal(race.result.reason,'confirmed');assert.equal(race.writes,0);
  const repair=await saveCase({existing:true,wrongScope:true,reason:'BACKFILL'});assert.equal(repair.result.action,'saved');assert.equal(repair.writes,1);
  for(const options of [{busy:true},{insertFails:true},{computeFails:true},{year:'2025'},{sourcesChanged:true}]){
    const r=await saveCase(options);assert(r.error);assert.equal(r.rolledBack,true);assert.equal(r.committed,false);
    if(options.sourcesChanged){assert.equal(r.error.code,'PROFIT_SOURCES_CHANGED');assert.equal(r.writes,0);}
  }
  const month=M.buildMonthlyProfitSummary([{major:'31',period:{startDate:'2026-07-22',endDate:'2026-07-28'},totals:{C:100,J:10,F:0}},{major:'30',period:{startDate:'2026-07-15',endDate:'2026-07-21'},error:'SNAPSHOT_NOT_READY'}],'2026');
  assert.equal(month.months[6].status,'incomplete');assert.equal(month.months[6].totals.C,null);assert.equal(month.months[6].totals.K,null);
  const periods=[...Array.from({length:47},(_,i)=>i+1),50].map(m=>({major:String(m).padStart(2,'0'),hasData:true,startDate:'2026-07-01',endDate:'2026-07-07'}));
  const partition=M.partitionMonthlyProfitPeriods(periods,'2026',{orderYear:'2026',major:'43'});
  assert.equal(partition.selected.length,42);assert.deepEqual(partition.excluded.map(p=>p.major),['43','44','45','46','47','50']);
  assert.equal(M.partitionMonthlyProfitPeriods(periods,'2025',{orderYear:'2026',major:'43'}).selected.length,48);
  assert.equal(M.partitionMonthlyProfitPeriods(periods,'2027',{orderYear:'2026',major:'43'}).selected.length,0);
  const annualBody=api.slice(api.indexOf('export async function loadAnnualMonthlyReportData'),api.indexOf('export default')).replaceAll('export ','');
  let annualLive=0;
  const annualDeps={currentProfitPeriod:async()=>({orderYear:'2026',major:'43'}),periodDayRangesByMajor:async()=>periods,
    partitionMonthlyProfitPeriods:M.partitionMonthlyProfitPeriods,latestSnapshots:async()=>new Map(),getActiveConfirms:async()=>new Map(),
    loadWeeklyReportPayload:async(m)=>{if(Number(m)<43)throw Object.assign(Error('cache missing'),{code:'SNAPSHOT_NOT_READY'});annualLive++;return raw;},
    profitDisplayCalculation:C.profitDisplayCalculation,buildMonthlyProfitSummary:M.buildMonthlyProfitSummary};
  const annual=new Function(...Object.keys(annualDeps),`${annualBody};return loadAnnualMonthlyReportData;`)(...Object.values(annualDeps));
  const defaultAnnual=await annual('2026');assert.equal(annualLive,0);assert.equal(defaultAnnual.weeks.length,42);assert.equal(defaultAnnual.missingWeeks.length,42);assert.equal(defaultAnnual.lastIncludedMajor,'42');assert.equal(defaultAnnual.excludedLivePeriods.length,6);
  const allAnnual=await annual('2026',{includeLive:true});assert.equal(annualLive,6);assert.equal(allAnnual.weeks.length,48);assert.equal(allAnnual.lastIncludedMajor,'50');
  const ui=read('pages/sales/profit-report.js');
  assert.match(ui,/context=1/);assert.match(ui,/onSaved=\{reloadAfterSourceSave\}/);
  assert.match(ui,/원천 저장은 완료되었으나 계산본 갱신에 실패/);
  assert.match(ui,/if\(!await reloadAfterSourceSave\(\)\) return false/);
  assert.match(ui,/data.readMode==='live'\|\|showSourceChecks/);
  assert.match(ui,/if\(ok==='stale'\) return false/);
  assert.match(ui,/userSelectedPeriodRef.current \|\| loadSeqRef.current>0/);
  assert.equal(C.profitScopeMatches({year:'2026',major:'31'},'2025','31'),false);
  assert.equal(C.profitScopeMatches({year:'2026',major:'32'},'2026','31'),false);
  assert.equal(C.profitScopeMatches({year:'2026',major:'01'},'2026','1'),true);
  const output=read('pages/api/sales/profit-report-output.js');assert.match(output,/mode:'display'/);assert.doesNotMatch(output,/preferLive: true/);
  const excel=read('lib/profitReportExcel.js');assert.equal((excel.match(/hasStoredRowCalculation\(r\) \? r.calc/g)||[]).length,2);
  const E=await import('../lib/profitReportExcel.js');
  const XLSX=require('xlsx');
  for(const visibleCols of [undefined,['C','D','H','J']]){
    const workbook=E.buildProfitReportXlsx({major:'31',rows:frozen.rows,confirmedTotals:frozen.totals,visibleCols,returnWorkbook:true});
    const cells=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1});
    const thai=cells.find(row=>row.includes('태국'));
    assert(thai?.includes(12345));assert(thai?.includes(0.123));assert(cells.some(row=>row.includes(54321)));
  }
  const refreshed=C.materializeProfitPayload({...raw,note:'new note',rows:[{...raw.rows[0],auto:{...raw.rows[0].auto,N:222}}]});
  const revisited=S.storedProfitPayload({...stored,payload:refreshed,versionNo:2});
  assert.equal(revisited.note,'new note');assert.equal(C.profitDisplayCalculation(revisited).rows[0].calc.C,222);
  console.log('profitReportWeeklyCache.test.js: PASS (production bodies, mocked SQL only)');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

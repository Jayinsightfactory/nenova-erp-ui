const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('lib/estimateLedgerAlerts.js','utf8');
const mod=new Function(source.replace(/export /g,'')+';return {normalizeLedgerAlertScope,readEstimateLedgerAlerts,DELETED_PRODUCT_SHIPMENT_ALERT_SQL,DELETED_PRODUCT_ESTIMATE_ALERT_SQL,MISSING_LINKED_DEDUCTION_ALERT_SQL};')();
const sql={NVarChar:'nvarchar',Int:'int'};
test('missing, stale embedded year and malformed major rejected before SQL',async()=>{
 for(const input of [{},{year:'2026',week:'2025-42-01'},{year:'2026',week:0},{year:'2026',week:54},{year:'26',week:42},{year:'2026',week:'42 OR 1=1'}]){
  let calls=0;await assert.rejects(()=>mod.readEstimateLedgerAlerts(async()=>{calls++;},sql,input));assert.equal(calls,0);
 }
 assert.deepEqual(mod.normalizeLedgerAlertScope('2026','01'),{year:'2026',week:1});
});
test('queries keep year, major subweeks, raw quantities and explicit missing key semantics',()=>{
 for(const text of [mod.DELETED_PRODUCT_SHIPMENT_ALERT_SQL,mod.DELETED_PRODUCT_ESTIMATE_ALERT_SQL]){
  assert.match(text,/sm.OrderYear=@year/);assert.match(text,/@week/);assert.match(text,/sm.isDeleted/);
  assert.match(text,/p.ProdKey IS NULL OR p.isDeleted=1/);assert.doesNotMatch(text,/\b(?:UPDATE|INSERT|DELETE|ALTER|CREATE|EXEC)\s/i);
 }
 assert.match(mod.DELETED_PRODUCT_SHIPMENT_ALERT_SQL,/ShipmentDate/);
 assert.match(mod.MISSING_LINKED_DEDUCTION_ALERT_SQL,/AppliedOrderYear/);
 assert.match(mod.MISSING_LINKED_DEDUCTION_ALERT_SQL,/d.EstimateKey>0/);
 assert.match(mod.MISSING_LINKED_DEDUCTION_ALERT_SQL,/NOT EXISTS\(SELECT 1 FROM Estimate e WHERE e.EstimateKey=d.EstimateKey\)/);
});
test('two years stay separately bound and partial table readiness is explicit, without DDL',async()=>{
 for(const year of ['2025','2026']){
  const calls=[];
  const result=await mod.readEstimateLedgerAlerts(async(text,params)=>{
   calls.push({text,params});
   if(text.includes('CASE WHEN'))return {recordset:[{Ready:0}]};
   return {recordset:text.includes('SdetailKey ReferenceKey')?[{TotalCount:201,OrderYear:year,Quantity:0,Amount:0}]:[]};
  },sql,{year,week:42});
  assert.equal(calls.length,3);assert.equal(result.scope.year,year);assert.equal(result.linkedDeductionCheck,'unavailable');
  assert.equal(result.total,201);assert.equal(result.rows[0].Quantity,0);
  for(const c of calls.slice(0,2)){assert.equal(c.params.year.value,year);assert.equal(c.params.week.value,42);}
 }
});
test('ready linked ledger checked; source failure rejects instead of clean zero',async()=>{
 let n=0;
 const result=await mod.readEstimateLedgerAlerts(async text=>{
  n++;return {recordset:text.includes('CASE WHEN')?[{Ready:1}]:text.includes('missing-linked-deduction')?[{TotalCount:1,ReferenceKey:10594,Amount:null}]:[]};
 },sql,{year:'2026',week:42});
 assert.equal(n,4);assert.equal(result.total,1);assert.equal(result.rows[0].Amount,null);assert.equal(result.linkedDeductionCheck,'checked');
 await assert.rejects(()=>mod.readEstimateLedgerAlerts(async()=>{throw Error('SQL unavailable');},sql,{year:'2026',week:42}),/SQL unavailable/);
});
test('GET API is authenticated, no-cache and cannot execute other methods',async()=>{
 const code=fs.readFileSync('pages/api/estimate/ledger-alerts.js','utf8').replace(/^import .*;\s*$/gm,'').replace('export default ','return ');
 let calls=0;
 const handler=new Function('withAuth','query','sql','readEstimateLedgerAlerts',code)(fn=>fn,()=>{},sql,async()=>{calls++;return {rows:[],total:0};});
 const response=()=>({statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;}});
 let r=response();await handler({method:'POST'},r);assert.equal(r.statusCode,405);assert.equal(calls,0);
 r=response();await handler({method:'GET',query:{year:'2026',week:42}},r);assert.equal(r.statusCode,200);assert.equal(calls,1);assert.equal(r.body.success,true);
});
test('UI has scoped refresh, stale completion cancellation, keyboard details, explicit limits and no repair action',()=>{
 const ui=fs.readFileSync('components/EstimateLedgerAlerts.js','utf8');
 assert.match(ui,/if\(active\)setState/);assert.match(ui,/active=false/);assert.match(ui,/state.key===key/);
 assert.match(ui,/<details open>/);assert.match(ui,/type="button"/);assert.match(ui,/no-print/);
 assert.match(ui,/削除|삭제자·삭제 시각은 추측하지 않습니다/);assert.doesNotMatch(ui,/apiPost|apiDelete|dangerouslySetInnerHTML/);
 const page=fs.readFileSync('pages/estimate.js','utf8');
 assert.match(page,/setLedgerAlertScope\(\{year:scope.year,week:scope.week/);
 assert.match(page,/Number\(ledgerAlertScope.week\)===Number\(weekNum\)/);
});

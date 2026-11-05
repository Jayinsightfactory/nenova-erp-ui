import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { diffRowSets, resolveSalesHistoryBaseline } from '../lib/salesSnapshotPolicy.js';
import { buildSalesObservationEvents, compareEcountSales, salesHistoryKst, salesReviewItemMatchesEvent } from '../lib/salesHistoryReviewPolicy.js';
const row = { RowType:'SD', RefKey:1, CustKey:7, CustName:'fixture', ProdKey:9, ProdName:'ROSE', Cost:1100, OutQuantity:10, EstQuantity:10, Amount:10000, Vat:1000 };
const current = [{...row, Cost:0, Amount:0, Vat:0},{...row,RefKey:2,ProdKey:10,Amount:20000,Vat:2000}];
const base = [row,{...row,RefKey:2,ProdKey:10}];
const diff=diffRowSets(base,current);
assert.equal(diff.amtDelta,0,'opposing item changes must not hide customer');
assert.equal(diff.byCust.length,1);
assert.equal(diff.byCust[0].items[0].before.unitPrice,1100,'actual VAT-inclusive Cost');
assert.equal(diff.byCust[0].items[0].after.unitPrice,0,'zero price is valid');
assert.equal(diff.byCust[0].items[0].refKey,1);
assert.equal(diffRowSets(base,base).byCust.length,0,'reverted difference hidden');
const observations=buildSalesObservationEvents(base,current,{custKey:7,week:'44-01',observedAt:'2026-11-05 11:00:00',observationKey:2});
assert.equal(observations.length,2);
assert.equal(observations[0].observed,true);
assert.equal(observations[0].ChangeID,undefined,'snapshot actor is never editor');
assert.equal(buildSalesObservationEvents(base,current,{custKey:8}).length,0);
const api=fs.readFileSync('pages/api/sales/registration-history.js','utf8');
const source=api.replace(/^import[\s\S]*?from [^;]+;\r?\n/gm,'').replace('export default withAuth(', 'module.exports=withAuth(');
const snapshots=[{SnapshotKey:10,OrderYear:'2026',OrderWeek:'44-01',SnapshotType:'TUE_FINAL',takenAt:'2026-10-28 17:00:00'}, {SnapshotKey:20,OrderYear:'2026',OrderWeek:'44-01',SnapshotType:'REG_CONFIRM',takenAt:'2026-11-03 17:00:00'}];
let calls=[];
const sql={NVarChar:'string',DateTime:'datetime',Int:'int'};
const sandbox={readEcountSalesHistory:async()=>({...compareEcountSales({ecountRows:[{custName:'fixture',prodName:'ROSE',qty:10,unitPrice:1100,supplyAmt:10000,vat:1000},{custName:'fixture',prodName:'LILY',qty:10,unitPrice:1100,supplyAmt:10000,vat:1000}],currentRows:[current[0],{...current[1],ProdName:'LILY'}],customers:[{CustKey:7,CustName:'fixture'}]}),noEcount:false,baseline:[]}),module:{exports:{}},withAuth:x=>x,sql,resolveActiveOrderYear:()=> '2026',normalizeOrderWeek:x=>x,
 startSalesSnapshotScheduler:()=>{}, SALES_CONFIRM_TYPE:'REG_CONFIRM',resolveSalesHistoryBaseline,diffRowSets,buildSalesObservationEvents, salesHistoryKst,
 salesCaptureYearPredicateSql:()=>"sm.OrderYear = @yr",listSnapshots:async(w,y)=>snapshots.filter(s=>s.OrderWeek===w&&s.OrderYear===String(y)),
 getSnapshotRows:async k=>Number(k)===20?base:base,captureCurrentRows:async(w,y)=>{assert.equal(String(y),'2026');return current;},
 query:async(statement,params)=>{if(statement.includes('SELECT OrderWeek FROM ('))return {recordset:[{OrderWeek:'44-01'}]};calls.push({statement,params});if(statement.includes('FROM ShipmentHistory')){
   assert.match(statement,/sm.CustKey=@cust/);assert.equal(params.yr.value,'2026');
   assert.equal(params.since.value,'2026-10-28 17:00:00','SQL time cutoff independent of Node timezone, not later sales confirmation');
   const crossYear=[{year:'2025',ShipHistoryKey:1,changeDtm:'2025-10-28 18:00:00'}, {year:'2026',ShipHistoryKey:2,changeDtm:'2026-10-28 18:00:00',OrderWeek:'44-01',ChangeID:'fixture-user',changeUser:'fixture-name',SdetailKey:1}];
   return {recordset:crossYear.filter(r=>r.year===params.yr.value)};
 }if(statement.includes('AS observedAt'))return {recordset:[{observedAt:'2026-11-05 11:00:00'}]};return {recordset:[]};}
};
vm.runInNewContext(source,sandbox);
async function request(query){const res={status(n){this.code=n;return this},json(body){this.body=body;return this}};await sandbox.module.exports({method:'GET',query:{week:'44',year:'2026',...query}},res);assert.equal(res.code,200,res.body?.error);return res.body;}
const review=await request({review:'1'});assert.equal(review.baseTotal,22000);assert.equal(review.byCust.length,1);assert.equal(review.noEcount,false);
const timeline=await request({customerTimeline:'1',custKey:'7'});assert.equal(timeline.entries.length,1);assert.equal(timeline.entries[0].ChangeID,'fixture-user');assert.equal(timeline.hasMore,false);
const readSQL=calls.filter(c=>!c.statement.startsWith('IF '));assert.ok(readSQL.every(c=>! /\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(c.statement)));
console.log('salesHistoryReview: zero price, offsetting differences, reverted, customer scope, cross-year timeline, Tuesday cutoff, read-only PASS');

const ecRow={custName:'fixture',prodName:'ROSE',qty:10,unitPrice:1100,supplyAmt:10000,vat:1000};
const matched=compareEcountSales({ecountRows:[ecRow],currentRows:[row],customers:[{CustKey:7,CustName:'fixture'}]});
assert.equal(matched.byCust.length,0,'identical ECOUNT and ERP hidden');
const sameMoneyDifferentQty=compareEcountSales({ecountRows:[{...ecRow,qty:12}],currentRows:[row],customers:[{CustKey:7,CustName:'fixture'}]});
assert.equal(sameMoneyDifferentQty.byCust.length,1,'same amount with differing quantity remains visible');
assert.equal(sameMoneyDifferentQty.byCust[0].items[0].refs[0].refKey,1);
const sameMoneyDifferentPrice=compareEcountSales({ecountRows:[{...ecRow,unitPrice:1200}],currentRows:[row],customers:[{CustKey:7,CustName:'fixture'}]});
assert.equal(sameMoneyDifferentPrice.byCust.length,1);
const ambiguous=compareEcountSales({ecountRows:[ecRow],currentRows:[row],customers:[{CustKey:7,CustName:'fixture'},{CustKey:8,CustName:'fixture'}]});
assert.equal(ambiguous.byCust.length,2,'ambiguous customer names cannot silently attach to wrong ID');
assert.ok(ambiguous.byCust.some(g=>g.custKey===null));
console.log('ECOUNT comparison: real baseline, quantity/price-only differences and ambiguous names PASS');

assert.equal(salesHistoryKst('2026-11-05 01:00:00'),'2026-11-05 10:00:00');

const {orderWeekToDateRange}=await import('../lib/orderWeekDate.js');
let status='GREEN',present=true,wrongTotal=false,seenDate='';
const readerSource=fs.readFileSync('lib/ecountSalesHistoryRead.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
const readerContext={module:{exports:{}},sql,orderWeekToDateRange,compareEcountSales,query:async(q,p={})=>{
 assert.match(q,/^SELECT/);assert.doesNotMatch(q,/\b(INSERT|UPDATE|DELETE|EXEC)\b/);
 if(q.includes('SELECT TOP 1')){seenDate=p.date.value;return {recordset:present?[{SnapshotKey:5,VerifyStatus:status,takenAt:'2026-11-05 10:00:00'}]:[]};}
 if(q.includes('Payload'))return {recordset:[{CustName:'fixture',ProdName:'ROSE',Payload:JSON.stringify({...ecRow,total:wrongTotal?999:11000})}]};
 if(q.includes('Customer'))return {recordset:[{CustKey:7,CustName:'fixture'}]};return {recordset:[]};
}};
vm.runInNewContext(readerSource+'\nmodule.exports={readEcountSalesHistory};',readerContext);
const read=()=>readerContext.module.exports.readEcountSalesHistory({orderYear:'2026',major:'43',currentRows:[row]});
assert.equal((await read()).byCust.length,0);assert.equal(seenDate,'2026/10/27');
present=false;const absent=await read();assert.equal(absent.noEcount,true);assert.equal(absent.baseTotal,null);assert.equal(absent.byCust.length,0);
present=true;status='RED';assert.equal((await read()).noEcount,true);
status='YELLOW';assert.equal((await read()).sourceStatus,'YELLOW');
status='GREEN';wrongTotal=true;await assert.rejects(read,/검산/);wrongTotal=false;
await readerContext.module.exports.readEcountSalesHistory({orderYear:'2025',major:'43',currentRows:[]});assert.equal(seenDate,'2025/10/28','same major week respects explicit year');
await readerContext.module.exports.readEcountSalesHistory({orderYear:'2026',major:'01',currentRows:[]});assert.equal(seenDate,'2026/01/06');
console.log('ECOUNT reader: missing/RED/YELLOW/corrupt/year-boundary/selected-year read-only PASS');

assert.equal(salesReviewItemMatchesEvent({refs:[],prodName:'ROSE'},{rowType:'SD',refKey:77,prodName:'ROSE'}),true,'deleted detail can retain snapshot timeline by product identity');

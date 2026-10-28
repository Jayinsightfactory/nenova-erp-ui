import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planReviewedSourceRelease } from '../lib/defectSourceRelease.js';
import { releaseReviewedSources } from '../lib/salesDefectDeductions.js';
import { buildDefectAutoSourceSql } from '../lib/salesDefectAutoSource.js';
import { defectSourceReview } from '../lib/salesDefectAutoSource.js';
import { parseDefectSourceExport } from '../lib/defectSourceExport.js';

const parsed = parseDefectSourceExport('네노바 수입(불량 공유방) 님과 카카오톡 대화\r\n--------------- 2026년 10월 22일 목요일 ---------------\r\n[작성자] [오후 6:05] 42-1 카네이션\r\n가상업체\r\n폴림니아 4단\r\n--------------- 2026년 10월 23일 금요일 ---------------\r\n[작성자] [오전 8:00] 사진\r\n');
assert.equal(parsed.length,2); assert.equal(parsed[0].ordinal,1); assert.equal(parsed[1].ordinal,2);
assert.equal(parsed[0].content,'42-1 카네이션\n가상업체\n폴림니아 4단');
assert.equal(Object.hasOwn(parsed[0],'sender'),false);
assert.throws(()=>parseDefectSourceExport('다른 방\n[작성자] [오전 1:00] 1단'));

const source = { sourceSha256: 'a'.repeat(64), messageSha256: 'b'.repeat(64), messageOrdinal: 4316,
  sourceYear: 2026, sourceWeek: '39-2', custKey: 100, prodKey: 200, quantity: 1, sourceUnit: '단',
  reason: '사용자 제공 원문 대조, 기존 견적 없음 및 업체·품목·수량 일치 확인' };
const row = { DeductionKey: 603, OrderYear: 2026, OrderWeek: '40', CustKey: 100, ProdKey: 200,
  Quantity: 1, SourceUnit: '단', RowVersionNo: 7, RejectedAutoSource: true, Status: 'DRAFT', IsDeleted: false };
const input = {year: 2026, week:43,user:{authority:0,userId:'test'},preview:false,
  rows:[{deductionKey:603,expectedRowVersionNo:7,evidence:source}]};
const plan = (changes={}) => planReviewedSourceRelease({...input,selection:input.rows[0],row,...changes});
assert.equal(plan().reviewedRowVersionNo,8);
assert.equal(defectSourceReview({IncompleteAutoSource:true}).code,'SOURCE_EVIDENCE_INCOMPLETE');
assert.equal(defectSourceReview({SourceFactReview:true}).code,'SOURCE_FACT_REVIEW_REQUIRED');
assert.throws(()=>plan({mode:'manual-provenance'}));
assert.equal(defectSourceReview({SourceUnitReview:true}).code,'SOURCE_UNIT_CONVERSION_REQUIRED');
const linked={CustKey:100,ProdKey:200,OrderYear:2026,OrderWeek:'43-01',Quantity:-1,Unit:'단',MasterDeleted:false};
assert.equal(plan({mode:'confirm-linked',selection:{...input.rows[0],linkedEstimateExists:true,linkedEstimate:linked}}).retainLinked,true);
for(const patch of [{CustKey:101},{ProdKey:201},{OrderYear:2025},{OrderWeek:'42-01'},{Quantity:1},{Quantity:-2},{Unit:'박스'},{MasterDeleted:true}]) {
  assert.throws(()=>plan({mode:'confirm-linked',selection:{...input.rows[0],linkedEstimateExists:true,linkedEstimate:{...linked,...patch}}}));
}
for (const changes of [{year:2025},{week:39},{user:{authority:6}},{row:{...row,IsDeleted:true}},
  {row:{...row,RowVersionNo:8}}, {row:{...row,IsCarryoverLedger:true}}, {applications:[{AppliedQuantity:1}]},
  {row:{...row,RejectedAutoSource:false}}, {selection:{...input.rows[0],linkedEstimateExists:true}}]) {
  assert.throws(()=>plan(changes));
}
for(const patch of [{sourceSha256:''},{messageOrdinal:0},{sourceYear:2025},{sourceWeek:44},
  {custKey:101},{prodKey:201},{quantity:2},{sourceUnit:'박스'},{reason:''}]) {
  assert.throws(()=>plan({selection:{...input.rows[0],evidence:{...source,...patch}}}));
}
for (const preview of [true,false]) {
  const writes=[];
  const query=async(q)=>{
    if (/FROM WebSalesDefectDeduction d/.test(q)) return {recordset:[row]};
    if (/FROM WebSalesCarryoverApplication/.test(q)) return {recordset:[]};
    if (/UPDATE WebSalesDefectDeduction/.test(q)) {writes.push('ledger');return {rowsAffected:[1]};}
    if (/INSERT INTO WebSalesDefectDeductionHistory/.test(q)) {writes.push('history');return {rowsAffected:[1]};}
    throw Error('Unexpected source release query: '+q);
  };
  const result=await releaseReviewedSources({...input,preview},{withTransaction:fn=>fn(query)});
  assert.equal(result.rows.length,1);
  assert.deepEqual(writes,preview?[]:['ledger','history']);
}
let touched=false;
await assert.rejects(releaseReviewedSources({...input,rows:[input.rows[0],input.rows[0]]},{withTransaction:()=>{touched=true}}));
assert.equal(touched,false);
const confirmRow={...row,EstimateKey:10808,Status:'REGISTERED',RejectedAutoSource:false,IncompleteAutoSource:true};
const confirmWrites=[];
await releaseReviewedSources({...input,mode:'confirm-linked'},{withTransaction:fn=>fn(async(q,params)=>{
  if(/FROM WebSalesDefectDeduction d/.test(q))return {recordset:[confirmRow]};
  if(/FROM WebSalesCarryoverApplication/.test(q))return {recordset:[]};
  if(/FROM Estimate e/.test(q))return {recordset:[linked]};
  if(/UPDATE WebSalesDefectDeduction/.test(q)){assert.doesNotMatch(q,/EstimateKey=NULL|Status=N'DRAFT'/);confirmWrites.push('metadata');return {rowsAffected:[1]};}
  if(/INSERT INTO WebSalesDefectDeductionHistory/.test(q)){assert.equal(params.action.value,'SOURCE_REVIEW_CONFIRM');const after=JSON.parse(params.after.value);assert.equal(after.estimateKey,10808);assert.equal(after.status,'REGISTERED');confirmWrites.push('audit');return {rowsAffected:[1]};}
  throw Error('Unexpected confirm query');
})});
assert.deepEqual(confirmWrites,['metadata','audit']);
const manualInput={...input,mode:'manual-provenance',rows:[{...input.rows[0],evidence:{...source,kind:'USER_CONFIRMED_MANUAL_INPUT'}}]};
let manualUpdates=0,manualHistories=0;
await releaseReviewedSources(manualInput,{withTransaction:fn=>fn(async(q,p)=>{
  if(/FROM WebSalesDefectDeduction d/.test(q))return {recordset:[confirmRow]};
  if(/FROM WebSalesCarryoverApplication/.test(q))return {recordset:[]};
  if(/FROM Estimate e/.test(q))return {recordset:[linked]};
  if(/UPDATE/.test(q)){manualUpdates++;throw Error('manual classification cannot update inputs');}
  if(/INSERT INTO WebSalesDefectDeductionHistory/.test(q)){manualHistories++;assert.equal(p.action.value,'MANUAL_SOURCE_CONFIRM');const after=JSON.parse(p.after.value);assert.equal(after.manualSourceConfirmed,true);assert.equal(after.rowVersionNo,confirmRow.RowVersionNo);assert.equal(after.estimateKey,confirmRow.EstimateKey);return {rowsAffected:[1]};}
  throw Error('unexpected manual source query');
})});
assert.equal(manualUpdates,0);assert.equal(manualHistories,1);
const projection=buildDefectAutoSourceSql('d').projection;
for(const key of ['orderYear','orderWeek','custKey','prodKey','quantity','sourceUnit','reviewedSourceFileName']) assert.ok(projection.includes(`$.${key}`));
assert.match(projection,/reviewedHistory.HistoryKey>rejectedHistory.HistoryKey/);
assert.doesNotMatch(projection,/reviewedRowVersionNo/,'registration version changes must not revoke unchanged source evidence');
const service=fs.readFileSync(new URL('../lib/salesDefectDeductions.js',import.meta.url),'utf8').split('export async function releaseReviewedSources')[1].split('function forbidden')[0];
assert.doesNotMatch(service,/INSERT INTO Estimate|UPDATE Estimate|DELETE FROM Estimate|ensureSalesDefectTables/);
console.log('source review release: exact source facts, cross-year/stale/live/partial rejection, read-only preview and audited ledger-only apply passed');

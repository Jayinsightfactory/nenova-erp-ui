import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWeekdaySaveReceipt,compareWeekdayReceiptLatest,loadWeekdaySaveReceipt} from '../lib/weekdaySaveReceipt.js';
const operationId='11111111-1111-4111-8111-111111111111';
const clone=value=>JSON.parse(JSON.stringify(value));
function data() {
  const before={detailRows:1,shipmentOutQuantity:5,detail:{isFix:false},shipmentDates:[{date:'2026-10-15',timestamp:'2026-10-15 00:00:00.000',shipmentQuantity:5,detailFixed:false}]};
  const after={detailRows:1,shipmentOutQuantity:5,detail:{isFix:true},shipmentDates:[{date:'2026-10-16',timestamp:'2026-10-16 00:00:00.000',shipmentQuantity:5,detailFixed:true}],snapshotDigest:'actual-db-digest'};
  const change={year:'2026',orderWeek:'42-01',prodKey:359,unit:'박스',before,after};
  const submission={scopeKey:'533|2026|42',payload:{operationId,custKey:533,reason:'요일 이동',changes:[{year:'2026',orderWeek:'42-01',prodKey:359}]}};
  const status={success:true,saved:true,operation:{success:true,saved:true,operationId,changes:[change]}};
  const history={success:true,scope:{year:'2026',majorWeek:'42',custKey:533},changes:[{...change,operationId,custKey:533,reason:'요일 이동',userId:'operator',createdAt:'2026-10-13T01:00:00Z'}]};
  return {submission,status,history};
}
test('receipt uses persisted operation/audit values and original/changed dates',()=>{
  const {submission,status,history}=data();
  submission.preview=[{date:'2026-10-17',quantity:999}];
  const receipt=validateWeekdaySaveReceipt(submission,status,[history]);
  assert.deepEqual(receipt.changes[0].dates.map(day=>[day.date,day.before,day.after]),[['2026-10-15',5,0],['2026-10-16',0,5]]);
  assert.equal(receipt.changes[0].beforeState.fixed,false);assert.equal(receipt.changes[0].afterState.fixed,true);
  assert.ok(receipt.changes[0].logs.some(log=>log.includes('actual-db-digest')));
});
for(const variant of ['foreign UUID','foreign customer','foreign year','duplicate operation change','missing audit','mismatched audit','missing stored status'])
  test(`rejects ${variant}`,()=>{
    const {submission,status,history}=data();
    if(variant==='foreign UUID') status.operation.operationId='22222222-2222-4222-8222-222222222222';
    if(variant==='foreign customer') history.scope.custKey=534;
    if(variant==='foreign year') status.operation.changes[0].year='2027';
    if(variant==='duplicate operation change') status.operation.changes.push(clone(status.operation.changes[0]));
    if(variant==='missing audit') history.changes=[];
    if(variant==='mismatched audit') {history.changes=clone(history.changes);history.changes[0].after.shipmentDates[0].shipmentQuantity=4;}
    if(variant==='missing stored status') status.saved=false;
    assert.throws(()=>validateWeekdaySaveReceipt(submission,status,[history]));
  });
test('latest comparison separates saved-time truth, changes and unavailable exact scope',()=>{
  const {submission,status,history}=data(),receipt=validateWeekdaySaveReceipt(submission,status,[history]);
  const row={year:2026,orderWeek:'42-01',prodKey:359,custKey:533,...clone(status.operation.changes[0].after),fixed:true};
  assert.equal(compareWeekdayReceiptLatest(receipt,[row]).changes[0].latestState,'MATCH');
  row.shipmentDates[0].shipmentQuantity=7;
  const changed=compareWeekdayReceiptLatest(receipt,[row]).changes[0];
  assert.equal(changed.latestState,'CHANGED');assert.equal(changed.afterState.total,5);
  assert.equal(compareWeekdayReceiptLatest(receipt,[{...row,year:2027}]).changes[0].latestState,'UNAVAILABLE');
  assert.equal(compareWeekdayReceiptLatest(receipt,null).changes[0].latestState,'UNAVAILABLE');
});
test('flat weekday-compare row without audit detail object matches actual quantity/date/fix state',()=>{
  const {submission,status,history}=data(),receipt=validateWeekdaySaveReceipt(submission,status,[history]);
  const after=status.operation.changes[0].after;
  const row={year:2026,orderWeek:'42-01',custKey:533,prodKey:359,shipmentOutQuantity:5,fixed:true,masterFixed:true,
    detailRows:1,shipmentDates:clone(after.shipmentDates),snapshotDigest:'latest-compare-digest'};
  assert.equal(compareWeekdayReceiptLatest(receipt,[row]).changes[0].latestState,'MATCH');
  row.fixed=false;assert.equal(compareWeekdayReceiptLatest(receipt,[row]).changes[0].latestState,'CHANGED');
});
test('older UUID outside truncated history is a known read-window limit, not corrupted audit',()=>{
  const {submission,status,history}=data();history.changes=[];history.truncated=true;history.limit=500;
  assert.throws(()=>validateWeekdaySaveReceipt(submission,status,[history]),error=>{
    assert.equal(error.code,'WEEKDAY_RECEIPT_AUDIT_WINDOW_EXCEEDED');assert.match(error.message,/500건 조회범위/);return true;
  });
});
test('truncated history still accepts complete UUID and rejects duplicate/foreign UUID-scope audit',()=>{
  const {submission,status,history}=data();history.truncated=true;
  assert.equal(validateWeekdaySaveReceipt(submission,status,[history]).operationId,operationId);
  history.changes.push(clone(history.changes[0]));
  assert.throws(()=>validateWeekdaySaveReceipt(submission,status,[history]),error=>error.code!=='WEEKDAY_RECEIPT_AUDIT_WINDOW_EXCEEDED');
});
test('loader only GETs exact UUID then year-scoped audit; replay is read-only',async()=>{
  const {submission,status,history}=data(),calls=[];
  const get=async(path,params)=>{calls.push({path,params});return params.operationId?status:history;};
  for(let i=0;i<2;i++) assert.equal((await loadWeekdaySaveReceipt(submission,{get})).operationId,operationId);
  assert.equal(calls.length,4);assert.deepEqual(calls[0].params,{operationId,custKey:533});
  assert.deepEqual(calls[1].params,{year:'2026',majorWeek:'42',custKey:533,limit:500});
});
test('scope switch suppresses stale operation read without querying history',async()=>{
  const {submission,status}=data();let current=true,calls=0;
  const receipt=await loadWeekdaySaveReceipt(submission,{isCurrent:()=>current,get:async()=>{calls++;current=false;return status;}});
  assert.equal(receipt,null);assert.equal(calls,1);
});
test('legitimate cross-year receipt reads and preserves both exact business scopes',async()=>{
  const {submission,status,history}=data();
  const next=clone(status.operation.changes[0]);next.year='2027';next.orderWeek='01-01';
  for(const snapshot of [next.before,next.after]) for(const day of snapshot.shipmentDates) {
    day.date=day.date.replace('2026-10','2027-01');day.timestamp=day.timestamp.replace('2026-10','2027-01');
  }
  submission.payload.changes.push({year:'2027',orderWeek:'01-01',prodKey:359});status.operation.changes.push(next);
  const nextHistory={success:true,scope:{year:'2027',majorWeek:'01',custKey:533},changes:[{...next,operationId,custKey:533,reason:submission.payload.reason}]};
  const scopes=[];
  const receipt=await loadWeekdaySaveReceipt(submission,{get:async(path,params)=>{
    if(params.operationId) return status;scopes.push(params);return params.year==='2027'?nextHistory:history;
  }});
  assert.deepEqual(receipt.changes.map(change=>[change.year,change.orderWeek]),[['2026','42-01'],['2027','01-01']]);
  assert.equal(scopes.length,2);
});
test('scope switch during audit read suppresses old receipt',async()=>{
  const {submission,status,history}=data();let current=true;
  assert.equal(await loadWeekdaySaveReceipt(submission,{isCurrent:()=>current,get:async(path,params)=>{
    if(params.operationId) return status;current=false;return history;
  }}),null);
});
test('read failures propagate without a write or fabricated receipt',async()=>{
  const {submission}=data();let calls=0;
  await assert.rejects(()=>loadWeekdaySaveReceipt(submission,{get:async()=>{calls++;throw new Error('offline');}}),/offline/);
  assert.equal(calls,1);
});

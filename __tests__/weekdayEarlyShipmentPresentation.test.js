import assert from 'node:assert/strict';
import { applyEarlyShipmentClassification, earlyShipmentConfirmationLabel } from '../lib/weekdayEarlyShipmentPresentation.js';
import { buildEarlyShipmentRequest, earlyShipmentSourceSnapshot, createEarlyShipmentRequestScope, earlyShipmentPendingKey,
  readEarlyShipmentPending, persistEarlyShipmentPending, clearEarlyShipmentPending,
  earlyShipmentPostFailure } from '../lib/weekdayEarlyShipmentClient.js';
import { applyWeekdayCarryoverToMatrix } from '../lib/weekdayCarryover.js';

const original = {rows:[{prodKey:359,blocks:[
  {cycle:{year:2025,majorWeek:'40'},unit:'박스',initialMajor:10,currentTotal:13,remainderMajorView:{value:-3,savedValue:-3,label:'기준 잔량'}},
  {cycle:{year:2026,majorWeek:'40'},unit:'박스',initialMajor:10,currentTotal:13,remainderMajorView:{value:-3,savedValue:-3,label:'기준 잔량'}},
  {cycle:{year:2026,majorWeek:'41'},unit:'박스',initialMajor:10,currentTotal:2,remainderMajorView:{value:8,savedValue:8,label:'기준 잔량'}}
]}]};
const applied={operationId:'fixture-operation',status:'APPLIED',custKey:533,prodKey:359,unit:'박스',quantity:3,
  sourceYear:2026,sourceMajorWeek:'40',targetYear:2026,targetMajorWeek:'41'};
const view=applyEarlyShipmentClassification(original,[applied,{...applied,operationId:'reversed',status:'REVERSED',quantity:20},
  {...applied,operationId:'othercustomer',custKey:534,quantity:20},{...applied,operationId:'otherunit',sourceYear:2025,unit:'단',quantity:20}],533);
assert.equal(view.rows[0].blocks[0].remainderMajorView.value,-3,'same major week in prior year stays isolated');
assert.equal(view.rows[0].blocks[1].remainderMajorView.value,0,'source residual -3 plus classified 3 becomes zero');
assert.equal(view.rows[0].blocks[1].remainderMajorView.savedValue,0);
assert.equal(view.rows[0].blocks[2].remainderMajorView.value,5,'target remaining basis debits processed borrow once');
assert.equal(original.rows[0].blocks[1].remainderMajorView.value,-3,'ERP and baseline projection are immutable');
assert.equal(applyEarlyShipmentClassification(original,[{...applied,status:'MANUAL_USER_DECLARATION'}],533).rows[0].blocks[1].remainderMajorView.value,-3);
assert.equal(applyEarlyShipmentClassification(original,[applied,{...applied}],533).rows[0].blocks[1].remainderMajorView.value,0,
  'same operation returned by source and target status requests counts once');
const conflicting=applyEarlyShipmentClassification(original,[applied,{...applied,quantity:4}],533);
assert.match(applyEarlyShipmentClassification(original,[{...applied,sourceDate:'2026-10-01'},
  {...applied,sourceDate:'2026-10-04'}],533).earlyClassificationError,/서로 다릅니다/,
  'same revision with different physical source date must fail closed');
assert.match(conflicting.earlyClassificationError,/서로 다릅니다/);
assert.equal(conflicting.rows[0].blocks[1].remainderMajorView.value,null,'conflicting same revision is unknown, never throws during React render');
assert.equal(original.rows[0].blocks[1].remainderMajorView.value,-3);
for(const records of [[{...applied,revision:1},{...applied,revision:2,status:'REVERSED'}],
  [{...applied,revision:2,status:'REVERSED'},{...applied,revision:1}]]) {
  const latest=applyEarlyShipmentClassification(original,records,533);
  assert.equal(latest.earlyClassificationError,undefined);
  assert.equal(latest.rows[0].blocks[1].remainderMajorView.value,-3,'latest reversed revision wins in either request order');
  assert.equal(latest.rows[0].blocks[2].remainderMajorView.value,8);
}

const sourceCycle={year:2026,majorWeek:'40',startDate:'2026-10-01',calendarState:'FOUND'};
const targetCycle={year:2026,majorWeek:'41',startDate:'2026-10-08',calendarState:'FOUND'};
const chain={rows:[{prodKey:359,blocks:[
  {cycle:sourceCycle,unit:'박스',productPlans:[],initialMajor:5,currentTotal:8,
    remainderMajorView:{value:-3,savedValue:-3,hasDraft:false},remainder01View:{value:-3}},
  {cycle:targetCycle,unit:'박스',productPlans:[],initialMajor:10,currentTotal:7,
    remainderMajorView:{value:3,savedValue:3,hasDraft:false},remainder01View:{value:3}}
]}]};
const context={custKey:533,cycles:[sourceCycle,targetCycle],inputs:[
  {...sourceCycle,custKey:533,prodKey:359,unit:'박스',basis:5,allocated:8,valid:true},
  {...targetCycle,custKey:533,prodKey:359,unit:'박스',basis:10,allocated:7,valid:true}
]};
const seed={...sourceCycle,custKey:533,prodKey:359,unit:'박스',quantity:0};
const before=JSON.stringify(chain);
let carried=applyWeekdayCarryoverToMatrix(applyEarlyShipmentClassification(chain,[applied],533),context,[seed]);
assert.equal(carried.rows[0].blocks[0].remainderMajorView.value,0);
assert.equal(carried.rows[0].blocks[1].carryover.incoming,0,'corrected source closing feeds target carry rather than raw -3');
assert.equal(carried.rows[0].blocks[1].carryover.baseRemainder,0,'target 10 minus allocated7 minus early3 is zero');
assert.equal(carried.rows[0].blocks[1].remainderMajorView.value,0);
carried=applyWeekdayCarryoverToMatrix(applyEarlyShipmentClassification(chain,[applied],533),context,
  [seed,{...targetCycle,custKey:533,prodKey:359,unit:'박스',quantity:6}]);
assert.equal(carried.rows[0].blocks[1].remainderMajorView.value,6,'authoritative target manual closing overrides once without another early debit');
assert.equal(JSON.stringify(chain),before,'classification and carry preserve ERP quantities and immutable original baselines');

const cycle={year:2026,majorWeek:'40',calendarState:'FOUND',days:[{date:'2026-10-01',orderWeek:'40-01',calendarState:'FOUND'}]};
const row={year:2026,custKey:533,prodKey:359,orderWeek:'40-01',outUnit:'박스',state:'FIXED_REVIEW_REQUIRED',
  snapshotDigest:'a'.repeat(64),detailRows:1,shipmentOutQuantity:3,shipmentDates:[{date:'2026-10-01',shipmentQuantity:3}],fixed:true};
const operationId='12345678-1234-4123-8123-123456789abc';
const request=buildEarlyShipmentRequest({cycle,targetCycle:{year:2026,majorWeek:'41'},custKey:533,prodKey:359,
  date:'2026-10-01',quantity:3,reason:'기존 3박스 선출고 분류',operationId,compareRows:[row],cycles:[cycle]});
assert.equal(request.allocationIntent,'MARK_EXISTING');
assert.equal(request.sourceDateFinal,3);
assert.deepEqual(request.allocationBody.changes[0].dates,[{date:'2026-10-01',quantity:3}], 'existing distribution is preserved as absolute 3, never incremented to 6');
assert.equal(request.allocationBody.mode,'ALLOCATION');
const dated={date:'2026-10-01',timestamp:'2026-10-01 00:00:00.000',sdateKey:1,sdetailKey:2,shipmentKey:3,
  shipmentQuantity:3,estimateQuantity:3,detailFixed:true,cost:1,amount:3,vat:0};
const changed=buildEarlyShipmentRequest({cycle,targetCycle:{year:2026,majorWeek:'41'},custKey:533,prodKey:359,
  date:'2026-10-01',quantity:3,reason:'원천 날짜 절대량 네 박스',operationId,
  compareRows:[{...row,shipmentDates:[dated]}],cycles:[cycle],plans:[{id:'draft-1',draftScope:'533|2026|40',
    custKey:533,year:2026,orderWeek:'40-01',prodKey:359,prodName:'fixture',date:'2026-10-01',quantity:4,unit:'박스'}]});
assert.equal(changed.allocationIntent,'APPLY_ABSOLUTE');
assert.equal(changed.sourceDateFinal,4);
assert.deepEqual(changed.allocationBody.changes[0].dates,[{date:'2026-10-01',quantity:4}], 'draft is the final absolute date quantity');
const tuesdayCycle={...cycle,days:[{date:'2026-10-06',orderWeek:'40-02',calendarState:'FOUND'}]};
const tuesdayDate={...dated,date:'2026-10-06',timestamp:'2026-10-06 00:00:00.000'};
const nativeTuesday={...row,orderWeek:'40-01',shipmentDates:[tuesdayDate]};
const calendarSubweek={...row,orderWeek:'40-02',state:'NO_SHIPMENT',detailRows:0,
  shipmentOutQuantity:null,shipmentDates:[],fixed:null,masterFixed:null};
const tuesdayInput={cycle:tuesdayCycle,targetCycle:{year:2026,majorWeek:'41'},custKey:533,prodKey:359,
  date:'2026-10-06',quantity:3,reason:'화요일 기존분배 분류',operationId,
  compareRows:[nativeTuesday,calendarSubweek],cycles:[tuesdayCycle]};
const markedTuesday=buildEarlyShipmentRequest(tuesdayInput);
assert.equal(markedTuesday.allocationIntent,'MARK_EXISTING');
assert.equal(markedTuesday.allocationBody.changes[0].orderWeek,'40-01','native Tuesday stays on actual 40-01 instead of calendar 40-02');
assert.equal(markedTuesday.allocationBody.changes[0].expected.snapshotDigest,nativeTuesday.snapshotDigest);
const tuesdayDraft={id:'tue-draft',draftScope:'533|2026|40',custKey:533,year:2026,orderWeek:'40-01',
  prodKey:359,prodName:'fixture',date:'2026-10-06',quantity:4,unit:'박스'};
const changedTuesday=buildEarlyShipmentRequest({...tuesdayInput,plans:[tuesdayDraft]});
assert.equal(changedTuesday.allocationIntent,'APPLY_ABSOLUTE');
assert.equal(changedTuesday.allocationBody.changes[0].orderWeek,'40-01');
assert.deepEqual(changedTuesday.allocationBody.changes[0].dates,[{date:'2026-10-06',quantity:4}]);
const emptyWednesdayCycle={...tuesdayCycle,days:[...tuesdayCycle.days,{date:'2026-10-07',orderWeek:'40-02',calendarState:'FOUND'}]};
const emptyWednesday=earlyShipmentSourceSnapshot({cycle:emptyWednesdayCycle,date:'2026-10-07',prodKey:359,custKey:533,
  compareRows:[nativeTuesday,calendarSubweek]});
assert.equal(emptyWednesday.before,0,'proven empty calendar date may use 40-02');
assert.equal(emptyWednesday.day.orderWeek,'40-02');
assert.throws(()=>earlyShipmentSourceSnapshot({cycle:tuesdayCycle,date:'2026-10-06',prodKey:359,custKey:533,
  compareRows:[nativeTuesday,{...calendarSubweek,shipmentDates:[tuesdayDate]}]}),/중복/);
for(const shipmentQuantity of [null,undefined,'',' ']) assert.throws(()=>earlyShipmentSourceSnapshot({
  cycle:tuesdayCycle,date:'2026-10-06',prodKey:359,custKey:533,
  compareRows:[{...nativeTuesday,shipmentDates:[{...tuesdayDate,shipmentQuantity}]}]}),/NULL·빈값/,
  'an existing native date with unknown quantity is never silently classified as zero');
assert.throws(()=>earlyShipmentSourceSnapshot({cycle:tuesdayCycle,date:'2026-10-06',prodKey:359,custKey:533,
  compareRows:[{...calendarSubweek,state:'UNKNOWN'}]}),/현재 날짜 분배량/,'UNKNOWN absent date cannot be treated as zero');
assert.throws(()=>buildEarlyShipmentRequest({cycle,targetCycle:{year:2026,majorWeek:'41'},custKey:533,prodKey:359,
  date:'2026-10-01',quantity:4,reason:'too much',operationId,compareRows:[row],cycles:[cycle]}),/넘을 수 없습니다/);
assert.throws(()=>buildEarlyShipmentRequest({cycle,targetCycle:{year:2026,majorWeek:'41'},custKey:533,prodKey:359,
  date:'2026-10-01',quantity:0.001,reason:'precision',operationId,compareRows:[row],cycles:[cycle]}),/둘째 자리/);
assert.throws(()=>buildEarlyShipmentRequest({cycle,targetCycle:{year:2026,majorWeek:'41'},custKey:533,prodKey:359,
  date:'2026-10-01',quantity:1,reason:'additional',operationId,compareRows:[row],cycles:[cycle],alreadyClassified:1}),/추가 분류 의도/);
const recorded={...applied,custKey:533,sourceOrderWeek:'40-01',confirmationAfter:[{year:2026,orderWeek:'40-01',prodKey:359,fixed:true}]};
assert.equal(earlyShipmentConfirmationLabel(recorded,[{...row,fixed:false}]),'현재 ERP 미확정','current exact ERP scope overrides historical status');
assert.equal(earlyShipmentConfirmationLabel(recorded,[{...row,year:2025,fixed:false}]),'처리 당시 확정','prior-year ERP cannot override this operation');
assert.equal(earlyShipmentConfirmationLabel(recorded,[{...row,fixed:'mixed'}]),'현재 ERP 혼합');
assert.equal(earlyShipmentConfirmationLabel({...recorded,confirmationAfter:[{year:2025,orderWeek:'40-01',prodKey:359,fixed:true}]},[]),'미확인','foreign historical scope is not inferred');
const guard=createEarlyShipmentRequestScope('533|2026|40');
const first=guard.capture();
guard.setScope('533|2026|41');
assert.equal(guard.isCurrent(first),false,'late preview cannot reopen a dialog after a scope change');
const second=guard.capture();guard.invalidate();
assert.equal(guard.isCurrent(second),false,'unmount invalidates late apply responses');
const values=new Map();
const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
const pendingBody={action:'APPLY',operationId,sourceYear:2026,sourceMajorWeek:'40'};
persistEarlyShipmentPending(storage,'operator','533|2026|40',pendingBody);
assert.deepEqual(readEarlyShipmentPending(storage,'operator','533|2026|40'),pendingBody,'refresh restores the exact request body and UUID');
assert.equal(readEarlyShipmentPending(storage,'other','533|2026|40'),null,'another login does not inherit this operation');
assert.throws(()=>persistEarlyShipmentPending(storage,'operator','533|2026|40',{...pendingBody,operationId:'b0b22222-2222-4222-8222-222222222222'}),/같은 작업/);
assert.ok(values.has(earlyShipmentPendingKey('operator','533|2026|40')),'an uncertain response keeps the recovery record');
clearEarlyShipmentPending(storage,'operator','533|2026|40',pendingBody);
assert.equal(readEarlyShipmentPending(storage,'operator','533|2026|40'),null,'verified save or rollback releases the scope');
assert.equal(earlyShipmentPostFailure(500,{error:'commit result unknown'}).rolledBack,false,'HTTP 500 alone never releases a pending UUID');
assert.equal(earlyShipmentPostFailure(409,{error:'business rollback',rolledBack:true}).rolledBack,true,'explicit transaction rollback may release the pending UUID');
console.log('Early shipment presentation and existing-allocation request fixtures passed');

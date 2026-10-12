import assert from 'node:assert/strict';
import { buildWeekdayDistributionSubmission as build, clearSubmittedWeekdayDrafts as clear, saveWeekdayDistribution as save,
  checkWeekdayDistributionStatus as status, weekdayDraftScope, weekdayUnsavedPrintReason, moveWeekdayDistributionDraft as moveDraft,
  projectWeekdayDistribution as project, validateWeekdayDistributionCompareResponse as validateCompare,
  weekdayDistributionPreviewMatches as previewMatches } from '../lib/weekdayDistributionClient.js';
import { weekdaySnapshotDigest, assertWeekdaySnapshotDigest, normalizeWeekdayApplyRequest } from '../lib/weekdayDistributionPolicy.js';

const operationId='b0b22222-2222-4222-8222-222222222222';
const scopeKey=weekdayDraftScope(533,2026,38);
const cycles=[{year:2026,majorWeek:'38',calendarState:'FOUND',days:[
  {date:'2026-09-17',orderWeek:'38-01',calendarState:'FOUND'},
  {date:'2026-09-18',orderWeek:'38-01',calendarState:'FOUND'},
  {date:'2026-09-20',orderWeek:'38-01',calendarState:'FOUND'},
  {date:'2026-09-21',orderWeek:'38-02',calendarState:'FOUND'},
]},{year:2027,majorWeek:'01',calendarState:'FOUND',days:[{date:'2027-01-07',orderWeek:'01-01',calendarState:'FOUND'}]}];
const plan={id:'a',draftScope:scopeKey,custKey:533,year:2026,orderWeek:'38-01',prodKey:866,prodName:'fixture',date:'2026-09-17',quantity:0,unit:'박스'};
const snapshotDigest='a1'.repeat(32);
const row={custKey:533,year:2026,orderWeek:'38-01',prodKey:866,outUnit:'박스',detailRows:1,shipmentOutQuantity:25,fixed:true,snapshotDigest,shipmentDates:[
  {date:'2026-09-17',timestamp:'2026-09-17 00:00:00.123',sdateKey:1,sdetailKey:2,shipmentKey:3,weekDay:5,shipmentQuantity:5,estimateQuantity:50,detailFixed:true,cost:100,amount:4545,vat:455},
  {date:'2026-09-18',timestamp:'2026-09-18 00:00:00.000',sdateKey:4,sdetailKey:2,shipmentKey:3,weekDay:6,shipmentQuantity:20,estimateQuantity:200,detailFixed:true,cost:100,amount:18182,vat:1818},
]};
const input={plans:[plan],compareRows:[row],cycles,custKey:533,scopeKey,reason:'요일 정정',operationId};
const allocationInput={...input,mode:'ALLOCATION'};
const unconfirmed={...row,fixed:false,shipmentDates:row.shipmentDates.map(day=>({...day,detailFixed:false}))};
const unconfirmedSubmission=build({...allocationInput,compareRows:[unconfirmed],plans:[{...plan,quantity:12}]});
assert.equal(unconfirmedSubmission.payload.mode,'ALLOCATION');
assert.equal(unconfirmedSubmission.preview[0].detailFlag,'미확정 → 미확정 · 수량 저장');
assert.equal(unconfirmedSubmission.payload.changes[0].expected.shipmentDates[0].detailFixed,false,
  'existing unfixed source is retained rather than automatically confirmed');
assert.throws(()=>build({...input,compareRows:[unconfirmed]}),/미확정/,'omitted mode preserves fixed-only legacy policy');
const emptyAllocation={...row,state:'NO_SHIPMENT',detailRows:0,fixed:null,masterFixed:false,
  shipmentOutQuantity:null,shipmentDates:[]};
const newAllocation=build({...allocationInput,compareRows:[emptyAllocation],plans:[{...plan,quantity:12}]});
assert.equal(newAllocation.preview[0].before,0);
assert.equal(newAllocation.preview[0].after,12);
assert.equal(newAllocation.preview[0].detailFlag,'미확정 → 미확정 · 수량 저장');
const fixedQuantityPreview=build({...allocationInput,plans:[{...plan,quantity:12}]}).preview[0];
assert.equal(fixedQuantityPreview.detailFlag,'확정 → 확정 · 확정 취소 → 수량 저장 → 확정');
assert.equal(fixedQuantityPreview.lifecycle.consumedDelta,7);
const movingPlans=[{...plan,quantity:0},{...plan,id:'moved',date:'2026-09-20',quantity:5}];
const fixedMovePreview=build({...allocationInput,plans:movingPlans});
assert.ok(fixedMovePreview.preview.every(cell=>cell.detailFlag==='확정 → 확정 · 출고일 이동'));
assert.equal(fixedMovePreview.preview[0].lifecycle.consumedDelta,0);
const unfixedMovePreview=build({...allocationInput,compareRows:[unconfirmed],plans:movingPlans});
assert.ok(unfixedMovePreview.preview.every(cell=>cell.detailFlag==='미확정 → 확정 · 확정 → 출고일 이동'));
assert.equal(unfixedMovePreview.preview[0].lifecycle.consumedDelta,25,'date move confirms the whole detail');
const unfixedCombined=build({...allocationInput,compareRows:[unconfirmed],plans:[movingPlans[0],{...movingPlans[1],quantity:7}]});
assert.equal(unfixedCombined.preview[0].detailFlag,'미확정 → 확정 · 수량 저장 → 확정 → 출고일 이동');
assert.equal(unfixedCombined.preview[0].lifecycle.consumedDelta,27);
const crossWeekTarget={...emptyAllocation,orderWeek:'38-02'};
const crossWeekPreview=build({...allocationInput,compareRows:[unconfirmed,crossWeekTarget],
  plans:[movingPlans[0],{...movingPlans[1],orderWeek:'38-02',date:'2026-09-21'}]});
assert.ok(crossWeekPreview.preview.every(cell=>cell.lifecycle.dateMove && cell.lifecycle.finalFixed),
  'cross-subweek redistribution must not be mistaken for two quantity-only edits');
assert.deepEqual(newAllocation.payload.changes[0].dates,[{date:plan.date,quantity:12}]);
assert.equal(build({...allocationInput,compareRows:[{...emptyAllocation,masterFixed:null}],plans:[{...plan,quantity:12}]}).payload.mode,'ALLOCATION',
  'server digest plus complete empty source can prove a missing master for native creation');
for(const patch of [{masterFixed:undefined},{state:'ERROR'},{shipmentOutQuantity:0},{shipmentDates:[row.shipmentDates[0]]},
  {snapshotDigest:null},{customerLinkError:'wrong customer'}]) {
  assert.throws(()=>build({...allocationInput,compareRows:[{...emptyAllocation,...patch}],plans:[{...plan,quantity:12}]}),JSON.stringify(patch));
}
for(const fixed of [null,undefined,'mixed','false',0,1]) {
  assert.throws(()=>build({...allocationInput,compareRows:[{...row,fixed}],plans:[{...plan,quantity:12}]}),/확정 상태/);
}
assert.throws(()=>build({...input,mode:'UNKNOWN'}),/모드/);
const absoluteSource={...unconfirmed,shipmentOutQuantity:120,shipmentDates:[
  {...unconfirmed.shipmentDates[0],shipmentQuantity:100},unconfirmed.shipmentDates[1]]};
const absolutePlan={...plan,quantity:120};
const absoluteAllocation=build({...allocationInput,compareRows:[absoluteSource],plans:[absolutePlan]});
assert.deepEqual(absoluteAllocation.payload.changes[0].dates,[{date:plan.date,quantity:120}],
  '100 to120 submits final absolute target, not another120 increment');
assert.equal(project(absoluteSource,[absolutePlan]).delta,20);
assert.equal(project(absoluteSource,[absolutePlan]).dates.find(day=>day.date==='2026-09-18').projectedQuantity,20,
  'untouched day is preserved');
assert.throws(()=>build({...allocationInput,plans:[absolutePlan],compareRows:[{...absoluteSource,shipmentOutQuantity:140,
  shipmentDates:[{...absoluteSource.shipmentDates[0],shipmentQuantity:120},absoluteSource.shipmentDates[1]]}]}),/다른 날짜 수량/,
  'reapplying the same120 target never increases quantity again');
assert.throws(()=>build({...allocationInput,compareRows:[emptyAllocation],plans:[{...plan,quantity:0}]}),/다른 날짜 수량/,
  'zero input on empty source never creates a fake ERP detail');
assert.equal(build({...allocationInput,compareRows:[unconfirmed],plans:[{...plan,quantity:0}]}).preview[0].after,0,
  'explicit zero cancels an existing date while retaining unfixed state');
assert.throws(()=>build({...allocationInput,compareRows:[{...emptyAllocation,year:2025}],plans:[{...plan,quantity:12}]}),/조회 기준/);
assert.throws(()=>build({...allocationInput,compareRows:[{...emptyAllocation,custKey:675}],plans:[{...plan,quantity:12}]}),/조회 기준/);
const unchangedPlan={...plan,quantity:5};
const unchangedWilson={year:2026,majorWeek:'38',orderWeek:'38-01',custKey:533,prodKey:866,date:plan.date,
  unit:'박스',wilsonQuantity:2,expectedTotal:5,expectedRevision:0,scopeKey};
const metadataSubmission=build({...allocationInput,plans:[unchangedPlan],wilsonDrafts:[unchangedWilson]});
assert.equal(metadataSubmission.metadataOnly,true);
assert.deepEqual(metadataSubmission.payload.changes,[],'classification-only intent never fabricates an ERP quantity delta');
assert.equal(metadataSubmission.metadataChanges[0].expected.snapshotDigest,snapshotDigest);
assert.equal(metadataSubmission.metadataChanges[0].wilsonRecord.wilsonQuantity,2);
assert.equal(metadataSubmission.preview[0].before,5);assert.equal(metadataSubmission.preview[0].after,5);
assert.deepEqual(clear([unchangedPlan],metadataSubmission),[],'unchanged absolute plan is releaseable only after its classification commits');
const mixedSubmission=build({...allocationInput,plans:[unchangedPlan,{...plan,id:'changed',date:'2026-09-18',quantity:21}],wilsonDrafts:[unchangedWilson]});
assert.equal(mixedSubmission.metadataOnly,false);
assert.equal(mixedSubmission.payload.changes[0].dates.length,1);
assert.equal(mixedSubmission.metadataChanges.length,1);
assert.equal(mixedSubmission.submitted.length,2,'mixed apply includes changed ERP quantity and unchanged-total Wilson classification');
assert.equal(previewMatches(metadataSubmission,build({...allocationInput,plans:[unchangedPlan],wilsonDrafts:[{...unchangedWilson,wilsonQuantity:3}]})),false,
  'changing Wilson after preview requires a fresh confirmation');
for(const patch of [{unit:'단'},{expectedTotal:6},{expectedRevision:null},{wilsonQuantity:6}]) {
  assert.throws(()=>build({...allocationInput,plans:[unchangedPlan],wilsonDrafts:[{...unchangedWilson,...patch}]}));
}
let metadataTransportCalls=0;
const forbiddenMetadataFetcher=()=>{metadataTransportCalls++;throw Error('ERP transport forbidden');};
assert.equal((await save(metadataSubmission,{fetcher:forbiddenMetadataFetcher})).state,'failed');
assert.equal((await status(metadataSubmission,{fetcher:forbiddenMetadataFetcher})).state,'failed');
assert.equal(metadataTransportCalls,0,'classification-only submission neither POSTs ERP nor polls an unsubmitted UUID');
const readScope={year:2026,custKey:533,orderWeeks:['38-01'],prodKeys:[866]};
const readResult={success:true,readOnly:true,scope:readScope,rows:[row]};
assert.equal(validateCompare(readScope,readResult),readResult,'scope validation preserves the exact server rows and opaque digest');
for(const scope of [{...readScope,year:2025},{...readScope,custKey:534},{...readScope,orderWeeks:['38-02']},{...readScope,prodKeys:[867]}]) {
  assert.throws(()=>validateCompare(readScope,{...readResult,scope}),/조회 범위/);
}
for(const rows of [[{...row,year:2025}],[{...row,custKey:534}],[{...row,orderWeek:'38-02'}],[{...row,prodKey:867}],[row,row],[]]) {
  assert.throws(()=>validateCompare(readScope,{...readResult,rows}),/범위|중복|누락/);
}
assert.throws(()=>validateCompare(readScope,{...readResult,readOnly:false}),/조회 범위/);
const projectionRow={...row,shipmentDates:[row.shipmentDates[0],{...row.shipmentDates[1],date:'2026-09-20',timestamp:'2026-09-20 00:00:00.000',weekDay:1}]};
const beforeProjection=JSON.stringify(projectionRow);
const reduced=project(projectionRow,[{...plan,quantity:4}]);
assert.equal(reduced.valid,true);assert.equal(reduced.projectedTotal,24);assert.equal(reduced.delta,-1);
assert.deepEqual(reduced.dates.map(day=>[day.date,day.currentQuantity,day.projectedQuantity,day.delta,day.drafted]),[
  ['2026-09-17',5,4,-1,true],['2026-09-20',20,20,0,false],
],'untouched Sunday remains 20, not a fabricated planned zero');
const sameTotalMove=project(projectionRow,[plan,{...plan,id:'target',date:'2026-09-20',quantity:25}]);
assert.equal(sameTotalMove.projectedTotal,25);assert.equal(sameTotalMove.delta,0);
assert.equal(sameTotalMove.dates[0].projectedQuantity,0,'explicit 0 cancels, never falls back to actual 5');
const newDateMove=project(projectionRow,[plan,{...plan,id:'new',date:'2026-09-18',quantity:5}]);
assert.equal(newDateMove.projectedTotal,25);assert.equal(newDateMove.delta,0);
assert.equal(newDateMove.dates.find(day=>day.date==='2026-09-18').currentQuantity,0,'new dates start from known absence, not the detail total');
assert.equal(newDateMove.dates.find(day=>day.date==='2026-09-18').delta,5);
assert.equal(project(projectionRow,[plan]).projectedTotal,20);
assert.equal(project(projectionRow,[]).projectedTotal,25);assert.equal(project(projectionRow,[]).delta,0);
assert.equal(project(projectionRow,[{...plan,quantity:'4',unit:'BOX'}]).projectedTotal,24);
for(const quantity of [null,undefined,'',' ',false,true,NaN,Infinity,-1,'bad','0x10']) {
  const unknown=project(projectionRow,[{...plan,quantity}]);
  assert.equal(unknown.valid,false);assert.equal(unknown.projectedTotal,null);assert.equal(unknown.delta,null);
}
for(const invalidRow of [
  {...projectionRow,shipmentOutQuantity:null},
  {...projectionRow,shipmentOutQuantity:26},
  {...projectionRow,detailRows:2},
  {...projectionRow,outUnit:null},
  {...projectionRow,shipmentDates:[{...projectionRow.shipmentDates[0],shipmentQuantity:null},projectionRow.shipmentDates[1]]},
  {...projectionRow,shipmentDates:[...projectionRow.shipmentDates,projectionRow.shipmentDates[0]]},
]) {const unknown=project(invalidRow,[{...plan,quantity:4}]);assert.equal(unknown.valid,false);assert.equal(unknown.projectedTotal,null);assert.equal(unknown.delta,null);}
assert.equal(project(projectionRow,[{...plan,quantity:4,unit:'단'}]).valid,false);
assert.equal(project(projectionRow,[{...plan,quantity:4},{...plan,id:'duplicate',quantity:6}]).valid,false);
assert.equal(project(projectionRow,[{...plan,quantity:4,year:2025}]).valid,false);
const absentProjection=project({...row,detailRows:0,state:'NO_SHIPMENT',shipmentOutQuantity:null,shipmentDates:[]},[{...plan,quantity:2}]);
assert.equal(absentProjection.projectedTotal,2);assert.equal(absentProjection.delta,2,'explicitly absent shipment is a known zero baseline');
assert.equal(JSON.stringify(projectionRow),beforeProjection,'display projection cannot mutate the ERP snapshot');
const submission=build(input);
assert.equal(submission.preview[0].detailFlag,'상세 확정 → 확정 유지');
assert.equal(build({...input,compareRows:[{...row,masterFixed:false}]}).payload.changes.length,1,
  'an already-fixed detail remains eligible when its master is mixed/unfixed');
const draftsBeforeEligibility=JSON.stringify(input.plans);
for(const fixed of [false,null,undefined,1,'true','mixed']) {
  assert.throws(()=>build({...input,compareRows:[{...row,fixed}]}),/ERP 미확정 분배/,
    `changed detail with fixed=${String(fixed)} must be rejected`);
}
const newTarget={...row,detailRows:0,state:'NO_SHIPMENT',shipmentOutQuantity:0,shipmentDates:[],fixed:null,masterFixed:true};
const newTargetSubmission=build({...input,plans:[{...plan,quantity:2}],compareRows:[newTarget]});
assert.equal(newTargetSubmission.preview[0].detailFlag,'상세 없음 → 신규 확정 상세');
for(const masterFixed of [false,null,undefined,1,'true']) {
  assert.throws(()=>build({...input,plans:[{...plan,quantity:2}],compareRows:[{...newTarget,masterFixed}]}),/신규 날짜의 대상 차수.*미확정/,
    `new target with masterFixed=${String(masterFixed)} must be rejected`);
}
const otherFixedRow={...row,prodKey:867};
const otherChangedPlan={...plan,id:'other-fixed',prodKey:867,quantity:4};
const unchangedUnfixedPlan={...plan,id:'unchanged-unfixed',date:'2026-09-18',quantity:20};
const unchangedUnfixedRow={...row,fixed:false};
assert.deepEqual(build({...input,plans:[unchangedUnfixedPlan,otherChangedPlan],compareRows:[unchangedUnfixedRow,otherFixedRow]}).payload.changes.map(change=>change.prodKey),[867],
  'an unchanged unfixed draft cannot block a changed fixed row');
assert.throws(()=>build({...input,plans:[plan,otherChangedPlan],compareRows:[unchangedUnfixedRow,otherFixedRow]}),/ERP 미확정 분배/,
  'a mixed submission rejects the changed unfixed row, not just the first valid row');
assert.equal(JSON.stringify(input.plans),draftsBeforeEligibility,'preflight rejection preserves drafts');
assert.deepEqual(submission.payload,{operationId,reason:'요일 정정',custKey:533,changes:[{
  year:2026,orderWeek:'38-01',prodKey:866,unit:'박스',expected:{snapshotDigest,detailRows:1,shipmentOutQuantity:25,shipmentDates:row.shipmentDates},dates:[{date:'2026-09-17',quantity:0}],
}]});
assert.equal(submission.payload.changes[0].expected.snapshotDigest,row.snapshotDigest,'read digest must flow unchanged into expected');
for(const invalid of [undefined,null,'',snapshotDigest.toUpperCase(),` ${snapshotDigest}`,snapshotDigest.slice(1),{digest:snapshotDigest}]) {
  assert.throws(()=>build({...input,compareRows:[{...row,snapshotDigest:invalid}]}),/스냅샷 digest/,'missing/normalized digest must not fall back to full dates only');
}
assert.equal(previewMatches(submission,build({...input,reason:'다른 사유'})),true,'reason edits do not require rebuilding the unchanged cell preview');
const refreshed=build({...input,compareRows:[{...row,snapshotDigest:'b2'.repeat(32)}]});
assert.deepEqual(refreshed.preview,submission.preview,'amount/fix/conversion-only changes need not alter visible quantity preview');
assert.equal(previewMatches(submission,refreshed),false,'opaque digest change blocks confirmation even when quantities look unchanged');
const costChanged=build({...input,compareRows:[{...row,shipmentDates:row.shipmentDates.map((day,index)=>index?day:{...day,cost:100.123456})}]});
assert.equal(costChanged.payload.changes[0].expected.shipmentDates[0].cost,100.123456,'full read precision is not rounded by the client');
assert.equal(previewMatches(submission,costChanged),false,'full date snapshots must match the confirmed read as well as digest');
assert.equal(previewMatches(submission,{...submission,scopeKey:'foreign'}),false);
assert.equal(previewMatches(submission,{...submission,submitted:[]}),false);
// Cross-module contract, not a DB fixture: the server-issued digest survives the
// exact read scope -> client -> backend request normalizer -> locked-state check.
const physical={detailRows:1,shipmentOutQuantity:25,shipmentDates:structuredClone(row.shipmentDates),
  master:{ShipmentKey:3,MasterIsFix:true,OrderYearWeek:'202638'},
  detail:{SdetailKey:2,ShipmentKey:3,CustKey:533,ProdKey:866,OutQuantity:25,BoxQuantity:25,BunchQuantity:250,SteamQuantity:2500,
    EstQuantity:2500,DetailCost:100.123456,DetailAmount:227553.30909,DetailVat:22755.330909,DetailIsFix:true},
  product:{ProdKey:866,OutUnit:'박스',EstUnit:'송이',BunchOf1Box:10,SteamOf1Bunch:10,SteamOf1Box:100},
};
const readChange={year:2026,orderWeek:'38-01',custKey:533,prodKey:866};
const issuedDigest=weekdaySnapshotDigest(readChange,physical);
const issuedRow={...row,snapshotDigest:issuedDigest};
const issuedRead=validateCompare(readScope,{...readResult,rows:[issuedRow]});
const linkedSubmission=build({...input,compareRows:issuedRead.rows});
const linkedChange=normalizeWeekdayApplyRequest(linkedSubmission.payload).changes[0];
assert.equal(linkedChange.expected.snapshotDigest,issuedDigest);
assert.equal(assertWeekdaySnapshotDigest(linkedChange,physical),issuedDigest);
assert.equal(assertWeekdaySnapshotDigest(linkedChange,{...physical,shipmentDates:[...physical.shipmentDates].reverse()}),issuedDigest,'physical date ordering cannot create false stale state');
for(const [part,field,value] of [
  ['detail','DetailCost',100.123457],['detail','DetailAmount',227553.3091],['detail','DetailVat',22755.33091],
  ['detail','EstQuantity',2501],['detail','OutQuantity',26],['detail','BoxQuantity',26],['detail','BunchQuantity',251],['detail','SteamQuantity',2501],
  ['detail','DetailIsFix',false],['master','MasterIsFix',false],['master','ShipmentKey',4],
  ['product','BunchOf1Box',11],['product','SteamOf1Bunch',11],['product','SteamOf1Box',101],
  ['product','OutUnit','단'],['product','EstUnit','단'],['product','SteamOf1Box',null],
]) {
  const changed={...physical,[part]:{...physical[part],[field]:value}};
  assert.notEqual(weekdaySnapshotDigest(readChange,changed),issuedDigest,`${part}.${field} must be covered by the server digest`);
  assert.throws(()=>assertWeekdaySnapshotDigest(linkedChange,changed),error=>error.code==='STALE_SNAPSHOT',`${part}.${field} changed after the read must not pass`);
}
assert.throws(()=>assertWeekdaySnapshotDigest({...linkedChange,year:2025},physical),error=>error.code==='STALE_SNAPSHOT');
assert.throws(()=>normalizeWeekdayApplyRequest({...linkedSubmission.payload,changes:[{...linkedSubmission.payload.changes[0],expected:{...linkedSubmission.payload.changes[0].expected,snapshotDigest:undefined}}]}),error=>error.code==='EXPECTED_SNAPSHOT_DIGEST_REQUIRED');
assert.notEqual(submission.payload.changes[0].expected.shipmentDates,row.shipmentDates);
assert.equal(submission.preview[0].before,5);
assert.equal(row.shipmentDates[0].shipmentQuantity,5);
const unchanged={...plan,id:'unchanged',date:'2026-09-18',quantity:20};
assert.equal(build({...input,plans:[plan,unchanged]}).submitted.length,1);
assert.deepEqual(clear([plan,unchanged,{...plan,id:'other',draftScope:'other'},{...plan,quantity:9}],submission),[unchanged,{...plan,id:'other',draftScope:'other'},{...plan,quantity:9}]);
assert.throws(()=>build({...input,reason:' '}),/사유/);
for(const quantity of ['',null,-1,'abc',Infinity,true,false]) assert.throws(()=>build({...input,plans:[{...plan,quantity}]}),/수량/);
assert.throws(()=>build({...input,plans:[{...plan,unit:'단'}]}),/OutUnit/);
assert.throws(()=>build({...input,plans:[plan,{...plan,id:'duplicate'}]}),/복수 날짜/);
assert.throws(()=>build({...input,compareRows:[{...row,detailRows:2}]}),/복수 상세/);
assert.throws(()=>build({...input,compareRows:[{...row,year:2025}]}),/조회 기준/);
assert.throws(()=>build({...input,compareRows:[{...row,custKey:534}]}),/조회 기준/);
assert.throws(()=>build({...input,plans:[{...plan,draftScope:'533|2025|38'}]}),/현재 조회 범위/);
assert.throws(()=>build({...input,compareRows:[row,{...row,orderWeek:'38-02'}]}),/명시적으로 검토/);
assert.throws(()=>build({...input,plans:[{...plan,date:'2026-09-21'}]}),/명시적으로 검토/);
const crossPlan={...plan,id:'cross',year:2027,orderWeek:'01-01',date:'2027-01-07',quantity:2};
const crossRow={...row,year:2027,orderWeek:'01-01',snapshotDigest:'c3'.repeat(32),detailRows:0,shipmentOutQuantity:0,shipmentDates:[],masterFixed:true};
const crossAllocationRow={...crossRow,state:'NO_SHIPMENT',shipmentOutQuantity:null,fixed:null,masterFixed:false};
assert.deepEqual(build({...allocationInput,plans:[{...plan,quantity:12},crossPlan],compareRows:[unconfirmed,crossAllocationRow]})
  .payload.changes.map(item=>[item.year,item.orderWeek]),[[2026,'38-01'],[2027,'01-01']],
  'allocation preserves cross-year identities and each server snapshot');
assert.equal(previewMatches(newAllocation,{...newAllocation,payload:{...newAllocation.payload,mode:undefined}}),false,
  'explicit allocation authority cannot be replaced with legacy authority after preview');
assert.deepEqual(build({...input,plans:[plan,crossPlan],compareRows:[row,crossRow]}).payload.changes.map(item=>[item.year,item.orderWeek]),[[2026,'38-01'],[2027,'01-01']]);
assert.deepEqual(build({...input,plans:[plan,crossPlan],compareRows:[row,crossRow]}).payload.changes.map(item=>item.expected.snapshotDigest),[snapshotDigest,crossRow.snapshotDigest],'cross-year groups use their own exact read-row digest');
// Production legacy Sunday belongs to actual 38-02. Amend/cancel that exact row;
// do not change its full business week to calendar-recommended 38-01.
const legacySunday={...row.shipmentDates[0],date:'2026-09-20',timestamp:'2026-09-20 00:00:00.123',weekDay:1,shipmentQuantity:13,estimateQuantity:130};
const existing={...row,orderWeek:'38-02',shipmentOutQuantity:13,shipmentDates:[legacySunday]};
const legacyPlan={...plan,orderWeek:'38-02',date:legacySunday.date};
for(const quantity of [17,0]) {
  const accepted=build({...input,plans:[{...legacyPlan,quantity}],compareRows:[existing]}).payload.changes[0];
  assert.equal(accepted.orderWeek,'38-02','legacy business week must not be remapped');
  assert.deepEqual(accepted.dates,[{date:legacySunday.date,quantity}]);
  assert.deepEqual(accepted.expected.shipmentDates,[legacySunday],'exact physical PK/timestamp snapshot is retained');
}
assert.throws(()=>build({...input,plans:[{...legacyPlan,quantity:17}],compareRows:[{...existing,detailRows:0,shipmentOutQuantity:0,shipmentDates:[]}]}),/명시적으로 검토/,'new Sunday cannot be assigned to 38-02');
assert.throws(()=>build({...input,plans:[{...legacyPlan,quantity:17}],compareRows:[existing,{...existing,orderWeek:'38-01'}]}),/명시적으로 검토/,'same date in multiple business weeks remains blocked');
assert.throws(()=>build({...input,plans:[{...legacyPlan,year:2025,quantity:17}],compareRows:[{...existing,year:2025}]}),/연도·차수/,'legacy exception does not weaken whole-cycle year scope');
assert.throws(()=>build({...input,plans:[{...legacyPlan,orderWeek:'37-02',quantity:17}],compareRows:[{...existing,orderWeek:'37-02'}]}),/연도·차수/,'legacy exception does not weaken whole-cycle major scope');
assert.throws(()=>build({...input,compareRows:[{...row,shipmentDates:[{date:plan.date,shipmentQuantity:5}]}]}),/전체 물리 스냅샷/);
assert.throws(()=>build({...input,plans:[{...plan,quantity:1.2345}]}),/소수 셋째 자리/);
const moveSource={...plan,quantity:5};
const move={id:plan.id,quantity:5,date:'2026-09-18',reason:'날짜 이동',eventId:'fixture-move'};
const moved=moveDraft({...input,plans:[moveSource],move});
assert.throws(()=>moveDraft({...input,plans:[moveSource],compareRows:[{...row,customerLinkError:'wrong customer'}],move}),/거래처 연결 오류/);
assert.throws(()=>moveDraft({...input,plans:[moveSource],compareRows:[row,{...crossRow,customerLinkError:'wrong customer'}],move:{...move,date:'2027-01-07'}}),/거래처 연결 오류/);
const subweekTarget={...row,orderWeek:'38-02',shipmentDates:[]};
assert.throws(()=>moveDraft({...input,plans:[moveSource],compareRows:[{...row,customerLinkError:'wrong source'},subweekTarget],move:{...move,date:'2026-09-21'}}),/거래처 연결 오류/,
  'a clean destination must not bypass a bad source in another subweek');
assert.throws(()=>moveDraft({...input,plans:[moveSource],compareRows:[row,subweekTarget,{...row,orderWeek:'38-03',customerLinkError:'wrong legacy',shipmentDates:[{date:'2026-09-21',shipmentQuantity:1}]}],move:{...move,date:'2026-09-21'}}),/거래처 연결 오류/,
  'bad actual-date parent remains blocked despite a clean canonical destination');
assert.deepEqual(moveDraft({...input,plans:[moveSource],compareRows:[row,{...row,year:2025,customerLinkError:'unrelated prior year'}],move}),moved,
  'prior-year errors outside the move scope do not block valid movement');
assert.equal(moved.plans.find(item=>item.id===plan.id).quantity,0,'full move retains explicit source cancellation');
assert.equal(moved.plans.find(item=>item.moveEventId===move.eventId).quantity,25,'destination final includes existing 20 plus moved 5');
assert.deepEqual(build({...input,plans:moved.plans}).payload.changes[0].dates.sort((a,b)=>a.date.localeCompare(b.date)),[{date:'2026-09-17',quantity:0},{date:'2026-09-18',quantity:25}]);
const partial=moveDraft({...input,plans:[moveSource],move:{...move,quantity:2}});
assert.equal(partial.plans.find(item=>item.id===plan.id).quantity,3);
assert.equal(partial.plans.find(item=>item.moveEventId===move.eventId).quantity,22);
assert.throws(()=>moveDraft({...input,plans:[moveSource,unchanged],move}),/既存|기존 초안/);
assert.throws(()=>moveDraft({...input,plans:[{...moveSource,draftScope:'stale'}],move}),/현재 조회 범위/);
const crossMove=moveDraft({...input,plans:[moveSource],compareRows:[row,crossRow],move:{...move,date:'2027-01-07'}});
assert.deepEqual(build({...input,plans:crossMove.plans,compareRows:[row,crossRow]}).payload.changes.map(item=>[item.year,item.orderWeek]),[[2027,'01-01'],[2026,'38-01']]);
assert.match(weekdayUnsavedPrintReason([plan],cycles[0],533),/ERP 저장 후/);
assert.equal(weekdayUnsavedPrintReason([plan],cycles[1],533),'');
assert.equal(weekdayUnsavedPrintReason([plan],cycles[0],534),'');

const reply=(code,data)=>({ok:code>=200&&code<300,status:code,json:async()=>data});
let calls=[];
const fetcher=async(url,options)=>{calls.push({url,options});return reply(200,{success:true,saved:true,operationId});};
assert.equal((await save(submission,{fetcher})).state,'saved');
assert.equal(calls.length,1);assert.equal(calls[0].options.method,'POST');
assert.deepEqual(JSON.parse(calls[0].options.body),submission.payload);
calls=[];
assert.equal((await save(submission,{fetcher:async(url,options)=>{calls.push({url,options});return reply(409,{success:false,error:'stale snapshot'});}})).state,'failed');
assert.equal(calls.length,1);
assert.deepEqual(submission.payload,input && build(input).payload,'failure does not mutate drafts/reason/UUID');
assert.equal(JSON.stringify(input.plans),draftsBeforeEligibility,'rejected save leaves the editable drafts intact');
for(const code of [500,503]) {
  calls=[];
  const failed=await save(submission,{fetcher:async(url,options)=>{calls.push({url,options});return reply(code,{success:false,rolledBack:true,error:'confirmed rollback'});}});
  assert.equal(failed.state,'failed');assert.equal(failed.error,'confirmed rollback');assert.equal(calls.length,1,'only explicit confirmed rollback permits manual new attempt, no status poll');
  assert.deepEqual(submission.payload,build(input).payload,'confirmed rollback keeps original drafts/reason/snapshot/UUID untouched');
}
for(const rolledBack of [undefined,false,'true',1]) {
  calls=[];
  const uncertain=await save(submission,{fetcher:async(url,options)=>{calls.push({url,options});return options.method==='POST'?reply(500,{success:false,rolledBack,error:'unknown commit'}):reply(200,{success:true,saved:false,operation:null});},pause:async()=>{}});
  assert.equal(uncertain.state,'pending');assert.equal(calls.length,4);assert.equal(calls.filter(call=>call.options.method==='POST').length,1);
}
let polls=0;calls=[];
const recovering=async(url,options)=>{
  calls.push({url,options});
  if(options.method==='POST') throw new Error('network timeout');
  polls++;
  return reply(200,polls<2?{success:true,saved:false,operation:null}:{success:true,saved:true,operation:{operationId}});
};
assert.equal((await save(submission,{fetcher:recovering,pause:async()=>{}})).state,'saved');
assert.equal(calls.filter(call=>call.options.method==='POST').length,1);
assert.ok(calls.slice(1).every(call=>call.url.includes(operationId)&&call.url.includes('custKey=533')));
calls=[];
const stillUnknown=async(url,options)=>{calls.push({url,options});return options.method==='POST'?reply(504,{success:false,error:'gateway'}):reply(200,{success:true,saved:false,operation:null});};
assert.equal((await save(submission,{fetcher:stillUnknown,pause:async()=>{}})).state,'pending');
assert.equal(calls.length,4);assert.equal(calls.filter(call=>call.options.method==='POST').length,1);
calls=[];
assert.equal((await status(submission,{fetcher:stillUnknown,pause:async()=>{}})).state,'pending');
assert.equal(calls.length,3);assert.ok(calls.every(call=>!call.options.method));
assert.equal((await status(submission,{fetcher:async()=>reply(200,{success:true,saved:true,operation:{operationId}})})).state,'saved');
assert.equal((await status(submission,{fetcher:async()=>reply(200,{success:true,saved:true,operation:null}),attempts:1})).state,'pending');
for(const operation of [{},{operationId:'different-uuid'}]) {
  assert.equal((await status(submission,{fetcher:async()=>reply(200,{success:true,saved:true,operation}),attempts:1})).state,'pending','foreign or missing operation identity cannot clear drafts');
}
calls=[];
assert.equal((await save(submission,{fetcher:async(url,options)=>{calls.push({url,options});return options.method==='POST'?reply(200,{success:true,saved:true,operationId:'different-uuid'}):reply(200,{success:true,saved:false,operation:null});},pause:async()=>{}})).state,'pending');
assert.equal(calls.length,4);assert.equal(calls.filter(call=>call.options.method==='POST').length,1);
calls=[];
assert.equal((await save(submission,{fetcher:async(url,options)=>{calls.push({url,options});return options.method==='POST'?reply(408,{success:false,error:'request timeout'}):reply(200,{success:true,saved:false,operation:null});},pause:async()=>{}})).state,'pending');
assert.equal(calls.length,4);assert.equal(calls.filter(call=>call.options.method==='POST').length,1,'HTTP request timeout is not known rollback');
assert.equal((await save(submission,{fetcher:async(url,options)=>options.method==='POST'?{ok:true,status:200,json:async()=>{throw new Error('lost JSON');}}:reply(200,{success:true,saved:true,operation:{operationId}})})).state,'saved');
console.log('weekdayDistributionClient: strict read scope/digest/confirmed rollback/full-date projection/legacy existing dates/changed-only/full snapshot/0/units/cross-year/scope/failed/status-only retry PASS');

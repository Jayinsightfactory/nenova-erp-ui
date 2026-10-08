import assert from 'node:assert/strict';
import test from 'node:test';
import { assertEarlyClassification, earlyStockDelta, exactEarlyQuantity,
  normalizeEarlyShipmentRequest } from '../lib/weekdayEarlyShipment.js';
import { assertActiveEarlyClassificationIntegrity,
  assertEarlyShipmentSourceIntegrity,
  getEarlyShipmentExclusions } from '../lib/weekdayEarlyShipmentStore.js';
import { assertActiveEarlyClassificationCap } from '../lib/weekdayDistributionApply.js';
import { applyEarlyShipment, earlyReverseDigestChange,
  resolveEarlyShipmentContext } from '../lib/weekdayEarlyShipmentApply.js';

const operationId='11111111-1111-4111-8111-111111111111';
function body(overrides={}) {
  const basic={action:'APPLY',operationId,reason:'대상 대차수 물량 선출고',
    sourceYear:2026,sourceMajorWeek:'40',targetYear:2026,targetMajorWeek:'41',
    custKey:533,prodKey:359,unit:'단',quantity:3,sourceDate:'2026-10-01',
    allocationIntent:'MARK_EXISTING',expectedRevision:0};
  return {...basic,allocationBody:{mode:'ALLOCATION',operationId,reason:basic.reason,custKey:533,
    changes:[{year:2026,orderWeek:'40-01',prodKey:359,unit:'단',
      expected:{snapshotDigest:'a'.repeat(64)},dates:[{date:'2026-10-01',quantity:3}]}]},...overrides};
}

test('기존 3단 분류는 날짜 증분 0이며 역처리도 기존 분배를 보존한다',()=>{
  const request=normalizeEarlyShipmentRequest(body());
  assert.equal(request.sourceDateFinal,3);
  assert.deepEqual(assertEarlyClassification({quantity:3,alreadyClassified:0,
    finalQuantity:3,beforeQuantity:3,intent:'MARK_EXISTING'}),{
    sourceDateBefore:3,sourceDateFinal:3,sourceDateDelta:0,classifiedQuantity:3});
  assert.equal(earlyStockDelta(3,'SOURCE'),3);
  assert.equal(earlyStockDelta(3,'TARGET'),-3);
  assert.equal(earlyStockDelta(3,'REVERSE_SOURCE'),-3);
  assert.equal(earlyStockDelta(3,'REVERSE_TARGET'),3);
});

test('10 원문, 선출고 3, 대상 기존 2는 최종 목표 7 및 저장 delta 5',()=>{
  const original=10, early=3, existing=2;
  const finalTarget=original-early;
  assert.equal(finalTarget,7);
  assert.equal(finalTarget-existing,5);
  const classification=assertEarlyClassification({quantity:3,alreadyClassified:0,
    finalQuantity:3,beforeQuantity:0,intent:'APPLY_ABSOLUTE'});
  assert.equal(classification.sourceDateDelta,3);
});

test('소수 둘째 자리 재고 정밀도와 중복 분류 의도 및 누계 cap을 검증한다',()=>{
  assert.throws(()=>exactEarlyQuantity(0.001),{code:'EARLY_QUANTITY_PRECISION'});
  assert.throws(()=>exactEarlyQuantity(null),{code:'EARLY_QUANTITY_PRECISION'});
  assert.throws(()=>assertEarlyClassification({quantity:2,alreadyClassified:1,
    finalQuantity:3,beforeQuantity:3,intent:'MARK_EXISTING'}),{code:'EARLY_ADDITIONAL_INTENT_REQUIRED'});
  assert.throws(()=>assertEarlyClassification({quantity:3,alreadyClassified:1,
    finalQuantity:3,beforeQuantity:3,intent:'MARK_EXISTING',allowAdditionalClassification:true}),
    {code:'EARLY_CLASSIFICATION_CAP'});
  assert.throws(()=>assertEarlyClassification({quantity:1,alreadyClassified:0,
    finalQuantity:3,beforeQuantity:2,intent:'MARK_EXISTING'}),{code:'EARLY_MARK_EXISTING_CHANGED'});
});

test('동일 전년도 40차 및 잘못된 출고일 업무키는 현재 요청에 섞이지 않는다',()=>{
  assert.throws(()=>normalizeEarlyShipmentRequest(body({allocationBody:{...body().allocationBody,
    changes:[{...body().allocationBody.changes[0],year:2025}]}})),
    {code:'EARLY_ALLOCATION_SCOPE'});
  assert.throws(()=>normalizeEarlyShipmentRequest(body({allocationBody:{...body().allocationBody,
    changes:[{...body().allocationBody.changes[0],orderWeek:'41-01'}]}})),
    {code:'EARLY_ALLOCATION_SCOPE'});
});

function fakeLedger(rows,{dateQuantity=3,detailCustKey=null,exactCalendarRows=1}={}) {
  const calls=[];
  const queryFn=async (statement,params)=>{
    calls.push({statement,params});
    if (/TOP \(0\)/.test(statement)) return {recordset:[]};
    if (statement.includes('AS Classified')) return {recordset:[{Classified:3}]};
    if (statement.includes('COUNT_BIG(*) AS DateRows')) return {recordset:[
      {OutUnit:'단',DateRows:1,DateQuantity:dateQuantity,
        DetailCustKey:detailCustKey,ExactCalendarRows:exactCalendarRows}]};
    return {recordset:rows};
  };
  return {calls,queryFn};
}

test('대상 41-01/41-02 업로드는 동일 연결 3단을 01에서만 제외한다',async()=>{
  const ledger=fakeLedger([{OperationId:operationId,CustKey:533,ProdKey:359,Unit:'단',
    Quantity:3,TargetYear:'2026',TargetMajorWeek:'41',TargetImportWeek:'41-01',Revision:1,
    SourceYear:'2026',SourceMajorWeek:'40',SourceOrderWeek:'40-01',SourceDate:'2026-10-01'}]);
  const scope={year:2026,majorWeek:'41',custKeys:[533],prodKeys:[359]};
  const first=await getEarlyShipmentExclusions(ledger.queryFn,{...scope,orderWeek:'41-01'});
  const second=await getEarlyShipmentExclusions(ledger.queryFn,{...scope,orderWeek:'41-02'});
  assert.equal(first.rows[0].processedEarlyTotal,3);
  assert.equal(first.rows[0].earlyExcludedApplied,3);
  assert.equal(second.rows[0].processedEarlyTotal,3);
  assert.equal(second.rows[0].earlyExcludedApplied,0);
  assert.notEqual(first.fingerprint,second.fingerprint);
  assert.match(ledger.calls[1].statement,/WITH \(UPDLOCK,HOLDLOCK\)/);
  assert.equal(ledger.calls[1].params.yr.value,'2026');
  assert.equal(ledger.calls[1].params.week.value,'41');
});

test('대상 import anchor 충돌은 차감을 중단하며 빈 선택도 안정된 fingerprint를 준다',async()=>{
  const ledger=fakeLedger([
    {OperationId:operationId,CustKey:533,ProdKey:359,Unit:'단',Quantity:2,
      TargetYear:'2026',TargetMajorWeek:'41',TargetImportWeek:'41-01',
      SourceYear:'2026',SourceMajorWeek:'40',SourceOrderWeek:'40-01',SourceDate:'2026-10-01'},
    {OperationId:'22222222-2222-4222-8222-222222222222',CustKey:533,ProdKey:359,Unit:'단',
      Quantity:1,TargetYear:'2026',TargetMajorWeek:'41',TargetImportWeek:'41-02',
      SourceYear:'2026',SourceMajorWeek:'40',SourceOrderWeek:'40-01',SourceDate:'2026-10-01'},
  ]);
  await assert.rejects(getEarlyShipmentExclusions(ledger.queryFn,{year:2026,majorWeek:'41',
    custKeys:[533],prodKeys:[359],orderWeek:'41-01'}),{code:'EARLY_IMPORT_ANCHOR_CONFLICT'});
  const empty=await getEarlyShipmentExclusions(ledger.queryFn,{year:2026,majorWeek:'41',
    custKeys:[],prodKeys:[359],orderWeek:'41-01'});
  assert.deepEqual(empty.rows,[]);
  assert.match(empty.fingerprint,/^[0-9a-f]{64}$/);
});

test('원천 날짜가 삭제되거나 활성 q 아래로 줄면 업로드 차감을 fail closed 한다',async()=>{
  const row={OperationId:operationId,CustKey:533,ProdKey:359,Unit:'단',Quantity:3,
    TargetYear:'2026',TargetMajorWeek:'41',TargetImportWeek:'41-01',
    SourceYear:'2026',SourceMajorWeek:'40',SourceOrderWeek:'40-01',SourceDate:'2026-10-01'};
  const stale=fakeLedger([row],{dateQuantity:2});
  await assert.rejects(getEarlyShipmentExclusions(stale.queryFn,{year:2026,majorWeek:'41',
    custKeys:[533],prodKeys:[359],orderWeek:'41-01'}),{code:'EARLY_SOURCE_CLASSIFICATION_STALE'});
  const missing=async(statement)=>statement.includes('AS Classified')
    ? {recordset:[{Classified:3}]}:{recordset:[]};
  await assert.rejects(assertActiveEarlyClassificationIntegrity(missing,[row]),
    {code:'EARLY_SOURCE_CLASSIFICATION_STALE'});
  for (const options of [{detailCustKey:999},{detailCustKey:0},{exactCalendarRows:0}]) {
    const broken=fakeLedger([row],options);
    await assert.rejects(getEarlyShipmentExclusions(broken.queryFn,{year:2026,majorWeek:'41',
      custKeys:[533],prodKeys:[359],orderWeek:'41-01'}),{code:'EARLY_SOURCE_CLASSIFICATION_STALE'});
  }
});

test('원천 차수 Excel 저장 뒤 활성 선출고 날짜 감소는 동일 transaction에서 차단한다',async()=>{
  const row={OperationId:operationId,Revision:1,SourceYear:'2026',SourceMajorWeek:'40',
    SourceOrderWeek:'40-01',SourceDate:'2026-10-01',CustKey:533,ProdKey:359,Unit:'단',Quantity:3};
  const scope={year:2026,majorWeek:'40',custKeys:[533],prodKeys:[359]};
  const healthy=fakeLedger([row],{dateQuantity:3});
  const result=await assertEarlyShipmentSourceIntegrity(healthy.queryFn,scope);
  assert.equal(result.checked,1);
  assert.match(result.fingerprint,/^[0-9a-f]{64}$/);
  assert.match(healthy.calls[1].statement,/SourceYear=@yr AND SourceMajorWeek=@week/);
  assert.equal(healthy.calls[1].params.yr.value,'2026');
  assert.equal(healthy.calls[1].params.week.value,'40');
  const reduced=fakeLedger([row],{dateQuantity:2});
  await assert.rejects(assertEarlyShipmentSourceIntegrity(reduced.queryFn,scope),
    {code:'EARLY_SOURCE_CLASSIFICATION_STALE'});
});

test('일반 요일별 저장은 원천 날짜를 활성 q 미만으로 낮출 수 없다',async()=>{
  const tQ=async statement=>statement.includes('HasLedger')
    ? {recordset:[{HasLedger:1}]}
    : {recordset:[{SourceDate:'2026-10-01',Unit:'단',Classified:3}]};
  const plan={identity:'2026/40-01/업체533/품목359',
    change:{year:'2026',orderWeek:'40-01',custKey:533,prodKey:359,unit:'단'},
    finalDates:[{date:'2026-10-01',shipmentQuantity:2}]};
  await assert.rejects(assertActiveEarlyClassificationCap(tQ,{
    NVarChar:'NVarChar',Int:'Int'},[plan]),{code:'EARLY_CLASSIFICATION_CAP'});
  plan.finalDates[0].shipmentQuantity=3;
  await assert.doesNotReject(assertActiveEarlyClassificationCap(tQ,{
    NVarChar:'NVarChar',Int:'Int'},[plan]));
  const absent=async()=>({recordset:[{HasLedger:0}]});
  plan.finalDates[0].shipmentQuantity=0;
  await assert.doesNotReject(assertActiveEarlyClassificationCap(absent,{},[plan]));
});

function transactionalFixture({ targetFailure=false, negativeFuture=false, targetYear=2026,
  targetMajorWeek='41', existingTuesday=false, fixedFraction=false,
  nullDateQuantity=false, initialLive=10 }={}) {
  const events=[];
  const state={live:initialLive,effects:[],operation:null,revision:0,engineAudit:false};
  const crossYear=targetYear>2026;
  const sourceMajorWeek=crossYear?'52':'40';
  const sourceDate=crossYear?'2026-12-31':existingTuesday?'2026-10-06':'2026-10-01';
  const sourceAnchorDate=crossYear?'2026-12-31':'2026-10-01';
  const targetDate=crossYear?'2027-01-07':'2026-10-08';
  const request=body({allocationIntent:'APPLY_ABSOLUTE',sourceMajorWeek,sourceDate,targetYear,targetMajorWeek,
    allocationBody:{...body().allocationBody,changes:[{...body().allocationBody.changes[0],
      orderWeek:`${sourceMajorWeek}-01`,dates:[{date:sourceDate,quantity:3}]}]}});
  const q=async(statement,params={})=>{
    if (statement.includes('SELECT TOP (0)')) return {recordset:[]};
    if (statement.includes('SELECT * FROM dbo.WebEarlyShipmentOperation')) return {recordset:state.operation?[state.operation]:[]};
    if (statement.includes('SELECT UUID FROM dbo.WebWeekdayDistributionOperation')) return {recordset:state.engineAudit?[{UUID:operationId}]:[]};
    if (statement.includes('FROM PeriodDay') && statement.includes('sourceYwk')) {
      return {recordset:[{OrderYearWeek:`2026${sourceMajorWeek}`,WeekDay:5,Date:sourceAnchorDate},
        {OrderYearWeek:`${targetYear}${targetMajorWeek}`,WeekDay:5,Date:targetDate}]};
    }
    if (statement.includes('WITH candidates AS')) return {recordset:[
      {OrderYear:'2026',OrderWeek:`${sourceMajorWeek}-01`},
      {OrderYear:String(targetYear),OrderWeek:`${targetMajorWeek}-01`} ]};
    if (statement.includes('FROM Product p') && statement.includes('CROSS JOIN Customer'))
      return {recordset:[{ProdKey:359,OutUnit:'단',Stock:state.live,CustKey:533}]};
    if (statement.includes('FROM ShipmentMaster sm') && statement.includes('JOIN ShipmentDate d'))
      return {recordset:existingTuesday||fixedFraction?[{ActualOrderWeek:'40-01',SdetailKey:88,
        DetailFix:fixedFraction?1:0,ShipmentKey:77,SdateKey:99,
        ShipmentQuantity:nullDateQuantity?null:fixedFraction?2.999:3}]:[]};
    if (statement.includes('AS Classified')) return {recordset:[{Classified:0}]};
    if (statement.includes("Category=N'StockType'")) return {recordset:[{DetailCode:'STOCK'}]};
    if (statement.includes('INSERT INTO dbo.WebEarlyShipmentOperation')) {
      state.operation={RequestHash:params.hash.value,Actor:params.actor.value,Status:'PENDING'};
      events.push('ledger-reserve');return {rowsAffected:[1]};
    }
    if (statement.includes('DECLARE @effect TABLE')) {
      const delta=Number(params.delta.value);
      if (delta<0 && targetFailure) throw new Error('TARGET_EFFECT_FAILED');
      const before=state.live;state.live=Math.round((before+delta)*100)/100;
      events.push(delta>0?'source-plus':'target-minus');
      return {recordset:[{StockHistoryKey:state.effects.length+1,BeforeStock:before,
        AfterStock:state.live,LiveStock:state.live}]};
    }
    if (statement.includes('INSERT INTO dbo.WebEarlyShipmentEffect')) {
      state.effects.push({EffectKind:params.kind.value,StockHistoryKey:params.history.value,
        OrderYear:params.year.value,OrderWeek:params.week.value,Delta:params.delta.value,
        NativeProdKey:359,NativeYear:params.year.value,NativeWeek:params.week.value,
        NativeDelta:params.delta.value});
      return {rowsAffected:[1]};
    }
    if (statement.includes('EXEC @returnCode=dbo.usp_StockCalculation')) {
      events.push(`calc:${params.yr.value}/${params.wk.value}`);
      return {recordset:[{returnCode:0,result:0,message:'',TransactionState:1}]};
    }
    if (statement.includes('SELECT sm.OrderYear,sm.OrderWeek,ps.Stock')) return {recordset:[
      {OrderYear:'2026',OrderWeek:'40-01',Stock:9},
      {OrderYear:String(targetYear),OrderWeek:`${targetMajorWeek}-01`,Stock:7}]};
    if (statement.includes('ROUND(ps.Stock,3)<0')) return {recordset:negativeFuture?
      [{OrderYear:String(targetYear),OrderWeek:`${targetMajorWeek}-01`,Stock:-1}]:[]};
    if (statement.includes('SELECT Stock FROM Product')) return {recordset:[{Stock:state.live}]};
    if (statement.includes('FROM dbo.WebEarlyShipmentEffect e')) return {recordset:state.effects};
    if (statement.includes("SET Status=N'APPLIED'")) {
      state.operation.Status='APPLIED';state.revision=1;events.push('ledger-applied');
      return {rowsAffected:[1]};
    }
    if (statement.includes('INSERT INTO dbo.WebEarlyShipmentRevision')) return {rowsAffected:[1]};
    throw new Error(`Unexpected SQL: ${statement.slice(0,100)}`);
  };
  const dependencies={assertGateCapability:async()=>{events.push('gate-capability');},
    lockGate:async()=>{events.push('gate-lock');},
    executeEngine:async(tQ,_types,_body,_user,inner)=>{
    // The production engine reserves UUID and acquires both leases first.
    events.push('gate-and-leases');
    await inner.beforePrepare(tQ,null,null,'tester');
    events.push('prepare-and-allocation');
    state.live-=3; // fixed source allocation -3 after +3 allowance
    return {operationId,changes:[{year:2026,orderWeek:'40-01',prodKey:359,
      delta:3,fixed:true,after:{snapshotDigest:'b'.repeat(64)}}]};
  }};
  const transact=async fn=>{
    const snapshot=structuredClone(state);
    try{return await fn(q);}catch(error){Object.assign(state,snapshot);throw error;}
  };
  return {q,request,dependencies,transact,events,state};
}

test('40→41 원천+3은 엔진 준비 전, 대상-3은 엔진 뒤에 한 transaction에서 기록한다',async()=>{
  const fixture=transactionalFixture();
  const result=await fixture.transact(q=>applyEarlyShipment(q,fixture.request,{userId:'tester'},fixture.dependencies));
  assert.equal(result.status,'APPLIED');
  assert.equal(result.stockValidation.finalLiveStock,7);
  assert.deepEqual(fixture.events,[
    'gate-capability','gate-lock','gate-and-leases','ledger-reserve','source-plus','calc:2026/40-01',
    'prepare-and-allocation','target-minus','calc:2026/41-01','calc:2026/40-01','ledger-applied']);
  assert.deepEqual(fixture.state.effects.map(effect=>effect.Delta),[3,-3]);
});

test('대상 이력 실패 및 후속 음수 재고는 원천 이력·분배·ledger까지 롤백된다',async()=>{
  for (const options of [{targetFailure:true},{negativeFuture:true}]) {
    const fixture=transactionalFixture(options);
    await assert.rejects(fixture.transact(q=>applyEarlyShipment(q,fixture.request,
      {userId:'tester'},fixture.dependencies)),options.targetFailure?
      /TARGET_EFFECT_FAILED/:{code:'EARLY_FUTURE_STOCK_SHORTAGE'});
    assert.equal(fixture.state.live,10);
    assert.deepEqual(fixture.state.effects,[]);
    assert.equal(fixture.state.operation,null);
  }
});

test('후속 snapshot이 양수여도 최종 Product 현재고가 음수면 전체 롤백한다',async()=>{
  const fixture=transactionalFixture({initialLive:2});
  await assert.rejects(fixture.transact(q=>applyEarlyShipment(q,fixture.request,
    {userId:'tester'},fixture.dependencies)),{code:'EARLY_LIVE_STOCK_SHORTAGE'});
  assert.equal(fixture.state.live,2);
  assert.deepEqual(fixture.state.effects,[]);
  assert.equal(fixture.state.operation,null);
});

test('실제 2026-12-31→2027-01-07 달력은 2027/01 anchor를 허용한다',async()=>{
  const fixture=transactionalFixture({targetYear:2027,targetMajorWeek:'01'});
  const request=normalizeEarlyShipmentRequest(fixture.request);
  const resolved=await resolveEarlyShipmentContext(fixture.q,request);
  assert.equal(resolved.nextCycle.year,2027);
  assert.equal(resolved.targetStockAnchorWeek,'01-01');
});

test('화요일 기존 40-01 출고는 날짜 suffix 추정보다 실제 ShipmentMaster 업무차수를 따른다',async()=>{
  const fixture=transactionalFixture({existingTuesday:true});
  const request=normalizeEarlyShipmentRequest(fixture.request);
  const context=await resolveEarlyShipmentContext(fixture.q,request);
  assert.equal(context.sourceOrderWeek,'40-01');
  assert.equal(context.sourceDateBefore,3);
});

test('확정 원천의 0.001 날짜 증분은 재고 두 자리 정밀도 손실로 preview에서 차단한다',async()=>{
  const fixture=transactionalFixture({fixedFraction:true});
  await assert.rejects(resolveEarlyShipmentContext(fixture.q,
    normalizeEarlyShipmentRequest(fixture.request)),{code:'EARLY_STOCK_PRECISION'});
});

test('기존 원천 날짜행의 NULL 수량은 0으로 오인하지 않는다',async()=>{
  const fixture=transactionalFixture({existingTuesday:true,nullDateQuantity:true});
  await assert.rejects(resolveEarlyShipmentContext(fixture.q,
    normalizeEarlyShipmentRequest(fixture.request)),{code:'EARLY_DATE_INVALID'});
});

test('역처리의 EXE snapshot 조회는 원래 OutUnit을 반드시 전달한다',()=>{
  assert.deepEqual(earlyReverseDigestChange({SourceOrderWeek:'40-01'},
    {sourceYear:2026,custKey:533,prodKey:359,unit:'박스'}),
  {year:'2026',orderWeek:'40-01',custKey:533,prodKey:359,unit:'박스'});
});

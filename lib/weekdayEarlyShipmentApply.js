import crypto from 'crypto';
import { sql } from './db.js';
import { assertNativeResult } from './estimateDirectionalQuantity.js';
import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';
import { dateKey } from './weekdayEstimateCycle.js';
import { executeWeekdayDistributionApply, readActualScope } from './weekdayDistributionApply.js';
import { weekdaySnapshotDigest } from './weekdayDistributionPolicy.js';
import { assertEarlyClassification, earlyShipmentError, earlyShipmentRequestHash,
  earlyStockDelta, normalizeEarlyShipmentRequest } from './weekdayEarlyShipment.js';
import { assertEarlyShipmentSchema, finishEarlyOperation, listEarlyOperations,
  readEarlyClassification, readEarlyOperation, reserveEarlyOperation,
  writeEarlyEffect } from './weekdayEarlyShipmentStore.js';

const S = value => ({ type: sql.NVarChar, value:String(value) });
const I = value => ({ type: sql.Int, value:Number(value) });
const D = value => ({ type: sql.Decimal(18, 2), value:Number(value) });
const U = value => ({ type: sql.UniqueIdentifier, value });
const EPS = 0.000001;
const contextRound2 = value => Math.round((value+Number.EPSILON)*100)/100;

function actorId(user) {
  const actor = String(user?.userId ?? '').trim();
  if (!actor) throw earlyShipmentError('EARLY_AUTH_REQUIRED', '로그인 사용자 식별값이 필요합니다.', 401);
  return actor;
}

export function earlyReverseDigestChange(row, request) {
  return {year:String(request.sourceYear),orderWeek:String(row.SourceOrderWeek),
    custKey:request.custKey,prodKey:request.prodKey,unit:request.unit};
}

function sourceParams(request) {
  return { sy:S(request.sourceYear), sw:S(request.sourceMajorWeek),
    ty:S(request.targetYear), tw:S(request.targetMajorWeek),
    ck:I(request.custKey), pk:I(request.prodKey), date:S(request.sourceDate) };
}

export async function resolveEarlyShipmentContext(queryFn, request, { lock = false } = {}) {
  const params = sourceParams(request);
  const cal = await queryFn(`SELECT OrderYearWeek,WeekDay,
      CONVERT(nvarchar(10),CONVERT(datetime,BaseYmd,121),120) AS [Date]
    FROM PeriodDay ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE (OrderYearWeek=@sourceYwk AND WeekDay=5)
       OR (CONVERT(datetime,BaseYmd,121)>=
         (SELECT DATEADD(day,7,CONVERT(datetime,MIN(BaseYmd),121)) FROM PeriodDay
           WHERE OrderYearWeek=@sourceYwk AND WeekDay=5)
         AND CONVERT(datetime,BaseYmd,121)<
         (SELECT DATEADD(day,8,CONVERT(datetime,MIN(BaseYmd),121)) FROM PeriodDay
           WHERE OrderYearWeek=@sourceYwk AND WeekDay=5) AND WeekDay=5)`,
    { ...params, sourceYwk:S(`${request.sourceYear}${request.sourceMajorWeek}`) });
  const sourceRows=(cal.recordset||[]).filter(row=>String(row.OrderYearWeek)===`${request.sourceYear}${request.sourceMajorWeek}`);
  const targetRows=(cal.recordset||[]).filter(row=>String(row.OrderYearWeek)===`${request.targetYear}${request.targetMajorWeek}`);
  if (sourceRows.length!==1 || targetRows.length!==1
    || new Date(`${sourceRows[0].Date}T00:00:00Z`).getUTCDay()!==4
    || targetRows[0].Date!==new Date(Date.parse(`${sourceRows[0].Date}T00:00:00Z`)+7*86400000).toISOString().slice(0,10))
    throw earlyShipmentError('EARLY_CALENDAR_MISMATCH', '실제 전산 달력에서 인접한 대차수를 확인할 수 없습니다.', 409);
  const sourceStart=sourceRows[0].Date;
  const sourceEnd=new Date(Date.parse(`${sourceStart}T00:00:00Z`)+6*86400000).toISOString().slice(0,10);
  if (request.sourceDate<sourceStart || request.sourceDate>sourceEnd)
    throw earlyShipmentError('EARLY_SOURCE_DATE', '원천 실제 출고일이 선택 대차수 범위 밖입니다.', 409);
  const dayIndex=Math.round((Date.parse(`${request.sourceDate}T00:00:00Z`)-Date.parse(`${sourceStart}T00:00:00Z`))/86400000);
  const proposedWeek=String(request.allocationBody?.changes?.[0]?.orderWeek||'');
  const anchorResult=await queryFn(`WITH candidates AS (
      SELECT OrderYear,OrderWeek FROM StockMaster WHERE OrderYear IN (@sy,@ty)
      UNION SELECT OrderYear,OrderWeek FROM ShipmentMaster WHERE OrderYear IN (@sy,@ty)
      UNION SELECT OrderYear,OrderWeek FROM OrderMaster WHERE OrderYear IN (@sy,@ty)
    ) SELECT OrderYear,OrderWeek FROM candidates
      WHERE (OrderYear=@sy AND OrderWeek LIKE @sourceLike)
         OR (OrderYear=@ty AND OrderWeek LIKE @targetLike)
      ORDER BY OrderYear,OrderWeek`, {
    ...params, sourceLike:S(`${request.sourceMajorWeek}-%`), targetLike:S(`${request.targetMajorWeek}-%`),
  });
  const candidate=(year,major)=>(anchorResult.recordset||[])
    .filter(row=>String(row.OrderYear)===String(year) && /^\d{2}-0[1-3]$/.test(String(row.OrderWeek))
      && String(row.OrderWeek).startsWith(`${major}-`))
    .map(row=>String(row.OrderWeek)).sort();
  const sourceWeeks=candidate(request.sourceYear,request.sourceMajorWeek);
  const targetWeeks=candidate(request.targetYear,request.targetMajorWeek);
  if (!sourceWeeks.length || !targetWeeks.length)
    throw earlyShipmentError('EARLY_STOCK_ANCHOR_MISSING', '실제 업무차수 원장에서 원천 또는 대상 재고 anchor를 확인할 수 없습니다.', 409);
  const sourceStockAnchorWeek=sourceWeeks[0],targetStockAnchorWeek=targetWeeks[0];
  // Native Thursday is -01. A late-only major has no verified first import bucket.
  if (!sourceStockAnchorWeek.endsWith('-01') || !targetStockAnchorWeek.endsWith('-01'))
    throw earlyShipmentError('EARLY_STOCK_ANCHOR_MISSING', '대차수의 첫 실제 업무차수 anchor를 확인할 수 없습니다.', 409);
  const product=await queryFn(`SELECT p.ProdKey,p.OutUnit,p.Stock,c.CustKey
    FROM Product p ${lock?'WITH (UPDLOCK,HOLDLOCK)':''}
    CROSS JOIN Customer c ${lock?'WITH (UPDLOCK,HOLDLOCK)':''}
    WHERE p.ProdKey=@pk AND ISNULL(p.isDeleted,0)=0
      AND c.CustKey=@ck AND ISNULL(c.isDeleted,0)=0`,params);
  if (product.recordset?.length!==1 || normalizeWeekdayUnit(product.recordset[0].OutUnit)!==request.unit
    || product.recordset[0].Stock==null || !Number.isFinite(Number(product.recordset[0].Stock)))
    throw earlyShipmentError('EARLY_PRODUCT_SCOPE', '실제 업체·품목·단위·현재고를 확인할 수 없습니다.', 409);
  const date=await queryFn(`SELECT sm.OrderWeek AS ActualOrderWeek,
      sd.SdetailKey,sd.isFix AS DetailFix,sm.ShipmentKey,
      d.SdateKey,d.ShipmentQuantity
    FROM ShipmentMaster sm ${lock?'WITH (UPDLOCK,HOLDLOCK)':''}
    JOIN ShipmentDetail sd ${lock?'WITH (UPDLOCK,HOLDLOCK)':''} ON sd.ShipmentKey=sm.ShipmentKey
    JOIN ShipmentDate d ${lock?'WITH (UPDLOCK,HOLDLOCK)':''} ON d.SdetailKey=sd.SdetailKey
    WHERE sm.OrderYear=@sy AND sm.OrderWeek LIKE @sourceLike AND sm.CustKey=@ck
      AND sd.ProdKey=@pk AND ISNULL(sm.isDeleted,0)=0
      AND d.ShipmentDtm>=CONVERT(date,@date,23)
      AND d.ShipmentDtm<DATEADD(day,1,CONVERT(date,@date,23))`,
    { ...params,sourceLike:S(`${request.sourceMajorWeek}-%`) });
  if ((date.recordset||[]).length>1)
    throw earlyShipmentError('EARLY_DATE_AMBIGUOUS', '같은 날짜의 출고 날짜행이 중복됩니다.', 409);
  const dateWeek=date.recordset?.length
    ? String(date.recordset[0].ActualOrderWeek)
    : `${request.sourceMajorWeek}-${dayIndex<4?'01':'02'}`;
  if (proposedWeek!==dateWeek)
    throw earlyShipmentError('EARLY_DATE_WEEK_MISMATCH', '원천 날짜의 실제 세부업무차수가 전산 원장과 다릅니다.', 409);
  const rawBefore=date.recordset?.length?date.recordset[0].ShipmentQuantity:0;
  const before=Number(rawBefore);
  if (rawBefore==null || rawBefore==='' || !Number.isFinite(before) || before<0)
    throw earlyShipmentError('EARLY_DATE_INVALID', '원천 날짜의 현재 분배량을 확인할 수 없습니다.', 409);
  const fixed=date.recordset?.[0]?.DetailFix===1||date.recordset?.[0]?.DetailFix===true;
  const requestedDelta=request.sourceDateFinal-before;
  if (Math.abs(contextRound2(Number(product.recordset[0].Stock))-Number(product.recordset[0].Stock))>EPS
    || fixed && Math.abs(contextRound2(requestedDelta)-requestedDelta)>EPS)
    throw earlyShipmentError('EARLY_STOCK_PRECISION','현재고 또는 확정 분배 증분이 native 두 자리 재고 정밀도로 정확히 표현되지 않습니다.',409);
  return { sourceOrderWeek:dateWeek,sourceStockAnchorWeek,targetStockAnchorWeek,
    targetImportWeek:targetStockAnchorWeek,sourceDateBefore:before,
    sourceDateFinal:request.sourceDateFinal,sourceDateDelta:Math.round((request.sourceDateFinal-before)*1000)/1000,
    beforeDigest:String(request.allocationBody?.changes?.[0]?.expected?.snapshotDigest||''),
    currentStock:Number(product.recordset[0].Stock),
    sourceSdateKey:date.recordset?.[0]?.SdateKey??null,
    sourceSdetailKey:date.recordset?.[0]?.SdetailKey??null,
    detailFixed:fixed,
    nextCycle:{year:request.targetYear,majorWeek:request.targetMajorWeek} };
}

async function assertAdjustmentType(tQ) {
  const types=await tQ(`SELECT DetailCode FROM CodeInfo WITH (UPDLOCK,HOLDLOCK)
    WHERE Category=N'StockType' AND Descr=N'재고조정'`);
  if (types.recordset?.length!==1)
    throw earlyShipmentError('EARLY_STOCK_TYPE_UNAVAILABLE', 'native 재고조정 유형이 없거나 중복입니다.', 409);
}

async function nativeCalculate(tQ, year, week, prodKey, actor) {
  const result=await tQ(`DECLARE @r int,@m nvarchar(max),@returnCode int;
    EXEC @returnCode=dbo.usp_StockCalculation @OrderYear=@yr,@OrderWeek=@wk,
      @ProdKey=@pk,@iUserID=@uid,@oResult=@r OUTPUT,@oMessage=@m OUTPUT;
    SELECT @returnCode AS returnCode,@r AS result,@m AS message,XACT_STATE() AS TransactionState`,
    {yr:S(year),wk:S(week),pk:I(prodKey),uid:S(actor)});
  assertNativeResult(result);
}

async function writeAdjustment(tQ, request, year, week, delta, actor, kind) {
  const result=await tQ(`DECLARE @effect TABLE (StockHistoryKey int);
    DECLARE @rawBefore decimal(18,6),@before decimal(18,2);
    SELECT @rawBefore=Stock FROM Product WITH (UPDLOCK,HOLDLOCK)
      WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0;
    IF @rawBefore IS NULL OR @rawBefore<>ROUND(@rawBefore,2)
      THROW 51030,N'Product current stock missing or precision unsupported',1;
    SET @before=CONVERT(decimal(18,2),@rawBefore);
    INSERT INTO StockHistory
      (ChangeDtm,OrderYear,OrderWeek,ChangeID,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ProdKey)
      OUTPUT INSERTED.StockHistoryKey INTO @effect
      VALUES (GETDATE(),@yr,@wk,@uid,N'재고조정',N'수량',@before,@before+@delta,@descr,@pk);
    UPDATE Product SET Stock=ROUND(@before+@delta,2) WHERE ProdKey=@pk;
    SELECT e.StockHistoryKey,@before AS BeforeStock,ROUND(@before+@delta,2) AS AfterStock,
      p.Stock AS LiveStock FROM @effect e CROSS JOIN Product p WHERE p.ProdKey=@pk`, {
    yr:S(year),wk:S(week),uid:S(actor),pk:I(request.prodKey),delta:D(delta),
    descr:S(`선출고 연결 ${request.operationId} ${kind}`),
  });
  const row=result.recordset?.[0];
  if (!row || Math.abs(Number(row.LiveStock)-Number(row.AfterStock))>EPS)
    throw earlyShipmentError('EARLY_STOCK_READBACK', '현재고 증감 readback이 다릅니다.', 500);
  const effect={stockHistoryKey:Number(row.StockHistoryKey),orderYear:String(year),orderWeek:week,
    prodKey:request.prodKey,delta,beforeStock:Number(row.BeforeStock),afterStock:Number(row.AfterStock)};
  await writeEarlyEffect(tQ,request.operationId,kind,effect);
  return effect;
}

async function assertFinalStock(tQ, request, context, sourceEffect, targetEffect, finalLive) {
  // Materialize target by native procedure, then recalculate from the earlier source.
  await nativeCalculate(tQ,request.targetYear,context.targetStockAnchorWeek,request.prodKey,finalLive.actor);
  await nativeCalculate(tQ,request.sourceYear,context.sourceStockAnchorWeek,request.prodKey,finalLive.actor);
  const anchors=await tQ(`SELECT sm.OrderYear,sm.OrderWeek,ps.Stock
    FROM StockMaster sm JOIN ProductStock ps ON ps.StockKey=sm.StockKey
    WHERE ps.ProdKey=@pk AND ((sm.OrderYear=@sy AND sm.OrderWeek=@sourceAnchor)
      OR (sm.OrderYear=@ty AND sm.OrderWeek=@targetAnchor))`,{
    pk:I(request.prodKey),sy:S(request.sourceYear),sourceAnchor:S(context.sourceStockAnchorWeek),
    ty:S(request.targetYear),targetAnchor:S(context.targetStockAnchorWeek),
  });
  const sourceAnchor=(anchors.recordset||[]).find(item=>String(item.OrderYear)===String(request.sourceYear)
    && String(item.OrderWeek)===context.sourceStockAnchorWeek);
  const targetAnchor=(anchors.recordset||[]).find(item=>String(item.OrderYear)===String(request.targetYear)
    && String(item.OrderWeek)===context.targetStockAnchorWeek);
  if (anchors.recordset?.length!==2 || !sourceAnchor || !targetAnchor
    || sourceAnchor.Stock==null || targetAnchor.Stock==null
    || !Number.isFinite(Number(sourceAnchor.Stock)) || !Number.isFinite(Number(targetAnchor.Stock)))
    throw earlyShipmentError('EARLY_ANCHOR_READBACK', 'native 원천·대상 재고 anchor materialization이 불완전합니다.', 500);
  const future=await tQ(`SELECT TOP (1) sm.OrderYear,sm.OrderWeek,ps.Stock
    FROM StockMaster sm JOIN ProductStock ps ON ps.StockKey=sm.StockKey
    WHERE ps.ProdKey=@pk AND sm.OrderYearWeek>=@fromYwk AND ROUND(ps.Stock,3)<0
    ORDER BY sm.OrderYearWeek,sm.StockKey`,{
    pk:I(request.prodKey),fromYwk:S(`${request.sourceYear}${context.sourceStockAnchorWeek.replace('-','')}`),
  });
  if (future.recordset?.length)
    throw earlyShipmentError('EARLY_FUTURE_STOCK_SHORTAGE', '원천·대상 조정 뒤 현재 또는 후속 차수 재고가 음수입니다.',409,
      {negativeStock:future.recordset[0]});
  const live=await tQ(`SELECT Stock FROM Product WITH (UPDLOCK,HOLDLOCK) WHERE ProdKey=@pk`,{pk:I(request.prodKey)});
  const rawLive=live.recordset?.[0]?.Stock;
  if (rawLive==null || rawLive==='' || !Number.isFinite(Number(rawLive))
    || Number(rawLive)<-EPS)
    throw earlyShipmentError('EARLY_LIVE_STOCK_SHORTAGE','연결 조정 뒤 실제 Product 현재고가 음수 또는 불명입니다.',409);
  if (Math.abs(Number(live.recordset?.[0]?.Stock)-finalLive.expected)>EPS)
    throw earlyShipmentError('EARLY_FINAL_LIVE_MISMATCH', '선출고 최종 현재고가 분배·조정 기대값과 다릅니다.',500);
  const effects=await tQ(`SELECT e.EffectKind,e.StockHistoryKey,e.OrderYear,e.OrderWeek,e.Delta,
      h.ProdKey AS NativeProdKey,h.OrderYear AS NativeYear,h.OrderWeek AS NativeWeek,
      h.AfterValue-h.BeforeValue AS NativeDelta
    FROM dbo.WebEarlyShipmentEffect e
    JOIN StockHistory h ON h.StockHistoryKey=e.StockHistoryKey
    WHERE e.OperationId=@op`,{op:U(request.operationId)});
  const expectedCount=sourceEffect.delta<0?4:2;
  if (effects.recordset?.length!==expectedCount || !effects.recordset.some(row=>Number(row.StockHistoryKey)===sourceEffect.stockHistoryKey)
    || !effects.recordset.some(row=>Number(row.StockHistoryKey)===targetEffect.stockHistoryKey))
    throw earlyShipmentError('EARLY_EFFECT_READBACK', '선출고 재고 이력 연결쌍이 불완전합니다.',500);
  for (const effect of effects.recordset) if (Number(effect.NativeProdKey)!==request.prodKey
    || String(effect.NativeYear)!==String(effect.OrderYear)
    || String(effect.NativeWeek)!==String(effect.OrderWeek)
    || Math.abs(Number(effect.NativeDelta)-Number(effect.Delta))>EPS)
    throw earlyShipmentError('EARLY_EFFECT_READBACK','native 재고 이력과 연결 원장이 다릅니다.',500);
  return {sourceAnchorStock:Number(sourceAnchor.Stock),targetAnchorStock:Number(targetAnchor.Stock),
    finalLiveStock:Number(live.recordset[0].Stock),negativeFuture:false};
}

export async function previewEarlyShipment(queryFn, rawBody) {
  const request=normalizeEarlyShipmentRequest({...rawBody,action:'PREVIEW'});
  await assertEarlyShipmentSchema(queryFn);
  const context=await resolveEarlyShipmentContext(queryFn,request);
  const alreadyClassified=await readEarlyClassification(queryFn,request);
  const classification=assertEarlyClassification({quantity:request.quantity,alreadyClassified,
    finalQuantity:request.sourceDateFinal,beforeQuantity:context.sourceDateBefore,intent:request.allocationIntent,
    allowAdditionalClassification:request.allowAdditionalClassification});
  return {success:true,readOnly:true,expectedRevision:0,requestHash:earlyShipmentRequestHash(request),
    preview:{...classification,quantity:request.quantity,sourceYear:request.sourceYear,
      sourceMajorWeek:request.sourceMajorWeek,targetYear:request.targetYear,
      targetMajorWeek:request.targetMajorWeek,sourceDate:request.sourceDate,
      sourceOrderWeek:context.sourceOrderWeek,sourceStockAnchor:context.sourceStockAnchorWeek,
      targetStockAnchor:context.targetStockAnchorWeek,targetImportYear:request.targetYear,
      targetImportWeek:context.targetImportWeek,alreadyClassified,
      remainingCap:Math.round((request.sourceDateFinal-alreadyClassified-request.quantity)*1000)/1000,
      sourceAdjustment:request.quantity,targetAdjustment:-request.quantity,
      confirmationAfter:context.detailFixed,sourceLiveBefore:context.currentStock}};
}

export async function applyEarlyShipment(tQ, rawBody, user, dependencies) {
  const request=normalizeEarlyShipmentRequest({...rawBody,action:'APPLY'});
  const actor=actorId(user);
  if (request.expectedRevision!==0)
    throw earlyShipmentError('EARLY_REVISION_CONFLICT','신규 선출고의 expectedRevision은 0이어야 합니다.',409);
  await assertEarlyShipmentSchema(tQ);
  // Gate V2 precedes even the linked ledger row lock. The inner engine
  // rechecks the same singleton under this transaction before touching ERP.
  await dependencies.assertGateCapability(tQ);
  await dependencies.lockGate(tQ);
  const hash=earlyShipmentRequestHash(request);
  const prior=await readEarlyOperation(tQ,request.operationId,{lock:true});
  if (prior) {
    if (prior.RequestHash!==hash || prior.Actor!==actor)
      throw earlyShipmentError('EARLY_OPERATION_CONFLICT','같은 UUID의 요청 내용이 다릅니다.',409);
    if (prior.Status!=='APPLIED')
      throw earlyShipmentError('EARLY_OPERATION_INCOMPLETE','작업 상태를 확인할 수 없습니다.',409);
    return {success:true,saved:true,replayed:true,operationId:request.operationId,status:'APPLIED',revision:Number(prior.Revision),
      allocation:JSON.parse(prior.AllocationResponseJson)};
  }
  const engineAudit=await tQ(`SELECT UUID FROM dbo.WebWeekdayDistributionOperation WHERE UUID=@op`,{op:U(request.operationId)});
  if (engineAudit.recordset?.length)
    throw earlyShipmentError('EARLY_ENGINE_ONLY_CONFLICT','연결 원장 없이 동일 UUID의 분배 감사가 존재합니다.',409);
  let context,sourceEffect,classified,originalLive;
  const combinedDependencies={...dependencies,
    additionalLeaseScopes:[{orderYear:String(request.targetYear),orderWeek:request.targetMajorWeek,custKey:request.custKey}],
    beforePrepare:async (innerTQ,_types,_normalized,innerActor)=>{
      context=await resolveEarlyShipmentContext(innerTQ,request,{lock:true});
      classified=await readEarlyClassification(innerTQ,request,{lock:true});
      assertEarlyClassification({quantity:request.quantity,alreadyClassified:classified,
        finalQuantity:request.sourceDateFinal,beforeQuantity:context.sourceDateBefore,intent:request.allocationIntent,
        allowAdditionalClassification:request.allowAdditionalClassification});
      await assertAdjustmentType(innerTQ);
      const same=await reserveEarlyOperation(innerTQ,request,hash,innerActor,context);
      if (same) throw earlyShipmentError('EARLY_OPERATION_CONFLICT','연결 원장이 저장 중에 변경됐습니다.',409);
      originalLive=context.currentStock;
      sourceEffect=await writeAdjustment(innerTQ,request,request.sourceYear,
        context.sourceStockAnchorWeek,earlyStockDelta(request.quantity,'SOURCE'),innerActor,'SOURCE');
      await nativeCalculate(innerTQ,request.sourceYear,context.sourceStockAnchorWeek,request.prodKey,innerActor);
    }};
  const trustedEngine=dependencies.executeEngine || executeWeekdayDistributionApply;
  const allocation=await trustedEngine(tQ,sql,request.allocationBody,user,combinedDependencies);
  if (!sourceEffect || !context || allocation.operationId!==request.operationId)
    throw earlyShipmentError('EARLY_ENGINE_REPLAY_CONFLICT','분배 엔진이 선출고 원천 조정 없이 replay됐습니다.',409);
  const targetEffect=await writeAdjustment(tQ,request,request.targetYear,
    context.targetStockAnchorWeek,earlyStockDelta(request.quantity,'TARGET'),actor,'TARGET');
  const fixedDelta=(allocation.changes||[]).reduce((sum,row)=>sum+(row.fixed?Number(row.delta):0),0);
  const stockValidation=await assertFinalStock(tQ,request,context,sourceEffect,targetEffect,
    {actor,expected:Math.round((originalLive-fixedDelta)*100)/100});
  const confirmationAfter=(allocation.changes||[]).map(row=>({year:row.year,orderWeek:row.orderWeek,
    prodKey:row.prodKey,fixed:row.fixed}));
  await finishEarlyOperation(tQ,request.operationId,allocation,confirmationAfter);
  return {success:true,saved:true,operationId:request.operationId,status:'APPLIED',revision:1,
    sourceDateBefore:context.sourceDateBefore,sourceDateFinal:request.sourceDateFinal,
    sourceDateDelta:context.sourceDateDelta,quantity:request.quantity,alreadyClassified:classified,
    sourceStockAnchor:context.sourceStockAnchorWeek,targetStockAnchor:context.targetStockAnchorWeek,
    targetImportWeek:context.targetImportWeek,stockValidation,allocation};
}

export async function reverseEarlyShipment(tQ, rawBody, user, dependencies) {
  const operationId=String(rawBody?.operationId||''),reversalOperationId=String(rawBody?.reversalOperationId||'');
  const expectedRevision=Number(rawBody?.expectedRevision);
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const reason=String(rawBody?.reason??'').trim();
  if (!uuid.test(operationId) || !uuid.test(reversalOperationId)
    || reversalOperationId===operationId || !Number.isSafeInteger(expectedRevision))
    throw earlyShipmentError('EARLY_REVERSE_INVALID','원본·역처리 작업번호와 revision을 확인하세요.',400);
  if (!reason || reason.length>1000)
    throw earlyShipmentError('EARLY_REVERSE_REASON','역처리 사유를 1~1000자로 입력하세요.',400);
  const actor=actorId(user);
  const reversalHash=crypto.createHash('sha256').update(JSON.stringify({operationId,
    reversalOperationId,expectedRevision,reason,actor})).digest('hex');
  await dependencies.assertGateCapability(tQ);
  await dependencies.lockGate(tQ);
  await assertEarlyShipmentSchema(tQ);
  const row=await readEarlyOperation(tQ,operationId,{lock:true});
  if (!row) throw earlyShipmentError('EARLY_NOT_FOUND','선출고 처리 이력을 찾을 수 없습니다.',404);
  if (row.Status==='REVERSED' && String(row.ReversalOperationId)===reversalOperationId
    && String(row.ReversalRequestHash)===reversalHash)
    return {success:true,saved:true,replayed:true,operationId,status:'REVERSED',revision:Number(row.Revision),allocationPreserved:true};
  if (row.Status!=='APPLIED' || Number(row.Revision)!==expectedRevision)
    throw earlyShipmentError('EARLY_REVISION_CONFLICT','선출고 상태 또는 revision이 변경됐습니다.',409);
  const request={operationId,sourceYear:Number(row.SourceYear),sourceMajorWeek:String(row.SourceMajorWeek),
    targetYear:Number(row.TargetYear),targetMajorWeek:String(row.TargetMajorWeek),custKey:Number(row.CustKey),
    prodKey:Number(row.ProdKey),unit:String(row.Unit),quantity:Number(row.Quantity),sourceDate:dateKey(row.SourceDate),
    sourceDateFinal:Number(row.SourceDateFinal),allocationBody:{changes:[{orderWeek:String(row.SourceOrderWeek)}]}};
  const scopes=[{orderYear:String(request.sourceYear),orderWeek:request.sourceMajorWeek,custKey:request.custKey},
    {orderYear:String(request.targetYear),orderWeek:request.targetMajorWeek,custKey:request.custKey}]
    .sort((a,b)=>`${a.orderYear}|${a.orderWeek}|${a.custKey}`.localeCompare(`${b.orderYear}|${b.orderWeek}|${b.custKey}`));
  const leases=[];
  try {
    for (const scope of scopes) {
      const acquired=await dependencies.acquireEditLease(tQ,scope,user,{clientId:`early-reverse:${reversalOperationId}`,pageCode:'estimate-weekday-early-shipment',takeover:false,forceTakeover:false});
      const editGuard={leaseToken:acquired?.lease?.leaseToken,clientId:`early-reverse:${reversalOperationId}`};
      if (!editGuard.leaseToken) throw earlyShipmentError('EARLY_LEASE_INVALID','역처리 편집 보호를 획득하지 못했습니다.',409);
      await dependencies.assertEditGuard(tQ,scope,user,{editGuard});
      leases.push({scope,editGuard});
    }
    await assertAdjustmentType(tQ);
    const context=await resolveEarlyShipmentContext(tQ,request,{lock:true});
    if (context.sourceStockAnchorWeek!==String(row.SourceStockAnchorWeek)
      || context.targetStockAnchorWeek!==String(row.TargetStockAnchorWeek)
      || Math.abs(context.sourceDateBefore-Number(row.SourceDateFinal))>EPS)
      throw earlyShipmentError('EARLY_EXTERNAL_EDIT_CONFLICT','EXE 또는 웹에서 연결 분배·재고 anchor가 변경됐습니다.',409);
    const savedAllocation=JSON.parse(String(row.AllocationResponseJson||'null'));
    const savedAfter=savedAllocation?.changes?.[0]?.after;
    const digestChange=earlyReverseDigestChange(row,request);
    const currentActual=await readActualScope(tQ,sql,digestChange,{mode:'ALLOCATION'});
    if (!savedAfter?.snapshotDigest
      || weekdaySnapshotDigest(digestChange,currentActual)!==savedAfter.snapshotDigest)
      throw earlyShipmentError('EARLY_EXTERNAL_EDIT_CONFLICT','EXE 또는 웹에서 연결 분배 snapshot이 변경됐습니다.',409);
    const sourceEffect=await writeAdjustment(tQ,request,request.sourceYear,
      context.sourceStockAnchorWeek,earlyStockDelta(request.quantity,'REVERSE_SOURCE'),actor,'REVERSE_SOURCE');
    const targetEffect=await writeAdjustment(tQ,request,request.targetYear,
      context.targetStockAnchorWeek,earlyStockDelta(request.quantity,'REVERSE_TARGET'),actor,'REVERSE_TARGET');
    const stockValidation=await assertFinalStock(tQ,request,context,sourceEffect,targetEffect,
      {actor,expected:Math.round(context.currentStock*100)/100});
    const updated=await tQ(`UPDATE dbo.WebEarlyShipmentOperation SET Status=N'REVERSED',Revision=Revision+1,
      ReversalOperationId=@reverse,ReversalRequestHash=@hash,UpdatedAt=SYSUTCDATETIME()
      WHERE OperationId=@op AND Status=N'APPLIED' AND Revision=@revision`,{
      reverse:U(reversalOperationId),hash:{type:sql.Char(64),value:reversalHash},
      op:U(operationId),revision:I(expectedRevision)});
    if (Number(updated.rowsAffected?.[0]??0)!==1)
      throw earlyShipmentError('EARLY_REVISION_CONFLICT','역처리 revision이 변경됐습니다.',409);
    await tQ(`INSERT INTO dbo.WebEarlyShipmentRevision (OperationId,Revision,Action,Actor,Reason,CreatedAt)
      VALUES (@op,@revision,N'REVERSE',@actor,@reason,SYSUTCDATETIME())`,{
      op:U(operationId),revision:I(expectedRevision+1),actor:S(actor),reason:S(reason)});
    for (const owned of leases) await dependencies.advanceEditGuard(tQ,owned.scope,user,{editGuard:owned.editGuard});
    return {success:true,saved:true,operationId,status:'REVERSED',revision:expectedRevision+1,
      allocationPreserved:true,stockValidation};
  } finally {
    for (const owned of [...leases].reverse())
      await dependencies.releaseEditLease(tQ,owned.scope,user,{editGuard:owned.editGuard});
  }
}

export async function listEarlyShipmentStatus(queryFn,{year,majorWeek,custKey}) {
  await assertEarlyShipmentSchema(queryFn);
  const result=await queryFn(`SELECT TOP (1) OrderYearWeek
    FROM PeriodDay WHERE WeekDay=5 AND OrderYearWeek=@ywk
    ORDER BY CONVERT(datetime,BaseYmd,121)`,{ywk:S(`${year}${majorWeek}`)});
  const first=result.recordset?.[0];
  let nextCycle=null;
  if (first) {
    const next=await queryFn(`SELECT TOP (2) OrderYearWeek
      FROM PeriodDay WHERE WeekDay=5 AND CONVERT(datetime,BaseYmd,121)=
      (SELECT DATEADD(day,7,CONVERT(datetime,MIN(BaseYmd),121)) FROM PeriodDay
        WHERE OrderYearWeek=@ywk AND WeekDay=5)`,{ywk:S(`${year}${majorWeek}`)});
    if (next.recordset?.length===1 && /^\d{6}$/.test(String(next.recordset[0].OrderYearWeek)))
      nextCycle={year:Number(String(next.recordset[0].OrderYearWeek).slice(0,4)),
        majorWeek:String(next.recordset[0].OrderYearWeek).slice(4)};
  }
  return {success:true,readOnly:true,records:await listEarlyOperations(queryFn,{year,majorWeek,custKey}),nextCycle};
}

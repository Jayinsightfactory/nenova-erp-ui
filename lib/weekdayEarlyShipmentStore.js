import crypto from 'crypto';
import { sql } from './db.js';
import { earlyShipmentError } from './weekdayEarlyShipment.js';
import { normalizeWeekdayUnit } from './weekdayEstimateCompare.js';
import { weekdayDetailCustomerMatchesMaster } from './weekdayCustomerLink.js';

const int = value => ({ type: sql.Int, value: Number(value) });
const str = value => ({ type: sql.NVarChar, value: String(value) });
const uuid = value => ({ type: sql.UniqueIdentifier, value: value });
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function assertEarlyShipmentSchema(queryFn) {
  try {
    await queryFn(`SELECT TOP (0) OperationId,RequestHash,Status,Revision,SourceYear,SourceMajorWeek,
      TargetYear,TargetMajorWeek,CustKey,ProdKey,Unit,Quantity,SourceDate,SourceOrderWeek,
      SourceStockAnchorWeek,TargetStockAnchorWeek,TargetImportWeek,AllocationIntent,
      SourceDateBefore,SourceDateFinal,SourceDateDelta,BeforeDigest,AllocationResponseJson,
      ConfirmationAfterJson,Actor,Reason,ReversalOperationId,ReversalRequestHash,CreatedAt,UpdatedAt
      FROM dbo.WebEarlyShipmentOperation;
      SELECT TOP (0) OperationId,EffectKind,StockHistoryKey,OrderYear,OrderWeek,
        ProdKey,Delta,BeforeStock,AfterStock FROM dbo.WebEarlyShipmentEffect;
      SELECT TOP (0) OperationId,Revision,Action,Actor,Reason,CreatedAt
      FROM dbo.WebEarlyShipmentRevision;`);
  } catch (cause) {
    throw earlyShipmentError('EARLY_SCHEMA_REQUIRED', '선출고 연결 원장 migration이 준비되지 않았습니다.', 503, { cause });
  }
}

export async function readEarlyOperation(queryFn, operationId, { lock = false } = {}) {
  const result = await queryFn(`SELECT * FROM dbo.WebEarlyShipmentOperation ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE OperationId=@op`, { op: uuid(operationId) });
  if ((result.recordset || []).length > 1) throw earlyShipmentError('EARLY_LEDGER_DUPLICATE', '중복 선출고 작업이 확인됐습니다.', 500);
  return result.recordset?.[0] || null;
}

export async function reserveEarlyOperation(tQ, request, requestHash, actor, resolved) {
  const prior = await readEarlyOperation(tQ, request.operationId, { lock: true });
  if (prior) {
    if (String(prior.RequestHash) !== requestHash || String(prior.Actor) !== actor)
      throw earlyShipmentError('EARLY_OPERATION_CONFLICT', '같은 작업번호를 다른 요청으로 재사용할 수 없습니다.', 409);
    if (prior.Status !== 'APPLIED' || !prior.AllocationResponseJson)
      throw earlyShipmentError('EARLY_OPERATION_INCOMPLETE', '선출고 연결 원장이 불완전합니다. 자동 재실행을 중단했습니다.', 409);
    return prior;
  }
  await tQ(`INSERT INTO dbo.WebEarlyShipmentOperation
    (OperationId,RequestHash,Status,Revision,SourceYear,SourceMajorWeek,TargetYear,TargetMajorWeek,
     CustKey,ProdKey,Unit,Quantity,SourceDate,SourceOrderWeek,SourceStockAnchorWeek,
     TargetStockAnchorWeek,TargetImportWeek,AllocationIntent,SourceDateBefore,SourceDateFinal,
     SourceDateDelta,BeforeDigest,Actor,Reason,CreatedAt,UpdatedAt)
    VALUES (@op,@hash,N'PENDING',0,@sy,@sw,@ty,@tw,@ck,@pk,@unit,@qty,@date,@sourceWeek,
      @sourceAnchor,@targetAnchor,@targetImport,@intent,@before,@final,@delta,@beforeDigest,
      @actor,@reason,SYSUTCDATETIME(),SYSUTCDATETIME())`, {
    op: uuid(request.operationId), hash: { type: sql.Char(64), value: requestHash },
    sy: str(request.sourceYear), sw: str(request.sourceMajorWeek),
    ty: str(request.targetYear), tw: str(request.targetMajorWeek),
    ck: int(request.custKey), pk: int(request.prodKey), unit: str(request.unit),
    qty: { type: sql.Decimal(18, 2), value: request.quantity }, date: str(request.sourceDate),
    sourceWeek: str(resolved.sourceOrderWeek), sourceAnchor: str(resolved.sourceStockAnchorWeek),
    targetAnchor: str(resolved.targetStockAnchorWeek), targetImport: str(resolved.targetImportWeek),
    intent: str(request.allocationIntent),
    before: { type: sql.Decimal(18, 3), value: resolved.sourceDateBefore },
    final: { type: sql.Decimal(18, 3), value: resolved.sourceDateFinal },
    delta: { type: sql.Decimal(18, 3), value: resolved.sourceDateDelta },
    beforeDigest: { type: sql.Char(64), value: resolved.beforeDigest },
    actor: str(actor), reason: str(request.reason),
  });
  return null;
}

export async function writeEarlyEffect(tQ, operationId, kind, effect) {
  await tQ(`INSERT INTO dbo.WebEarlyShipmentEffect
    (OperationId,EffectKind,StockHistoryKey,OrderYear,OrderWeek,ProdKey,Delta,BeforeStock,AfterStock)
    VALUES (@op,@kind,@history,@year,@week,@pk,@delta,@before,@after)`, {
    op: uuid(operationId), kind: str(kind), history: int(effect.stockHistoryKey),
    year: str(effect.orderYear), week: str(effect.orderWeek), pk: int(effect.prodKey),
    delta: { type: sql.Decimal(18, 2), value: effect.delta },
    before: { type: sql.Decimal(18, 2), value: effect.beforeStock },
    after: { type: sql.Decimal(18, 2), value: effect.afterStock },
  });
}

export async function finishEarlyOperation(tQ, operationId, allocationResponse, confirmationAfter) {
  const response = await tQ(`UPDATE dbo.WebEarlyShipmentOperation SET Status=N'APPLIED',Revision=1,
    AllocationResponseJson=@response,ConfirmationAfterJson=@confirmation,UpdatedAt=SYSUTCDATETIME()
    WHERE OperationId=@op AND Status=N'PENDING' AND Revision=0`, {
    op: uuid(operationId), response: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(allocationResponse) },
    confirmation: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(confirmationAfter) },
  });
  if (Number(response.rowsAffected?.[0] ?? 0) !== 1)
    throw earlyShipmentError('EARLY_REVISION_CONFLICT', '선출고 연결 원장 갱신 기준이 달라졌습니다.', 409);
  await tQ(`INSERT INTO dbo.WebEarlyShipmentRevision (OperationId,Revision,Action,Actor,Reason,CreatedAt)
    SELECT OperationId,Revision,N'APPLY',Actor,Reason,SYSUTCDATETIME()
      FROM dbo.WebEarlyShipmentOperation WHERE OperationId=@op AND Status=N'APPLIED'`, { op: uuid(operationId) });
}

export async function readEarlyClassification(queryFn, request, { lock = false } = {}) {
  const result = await queryFn(`SELECT ISNULL(SUM(Quantity),0) AS Classified
    FROM dbo.WebEarlyShipmentOperation ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE Status=N'APPLIED' AND SourceYear=@yr AND SourceMajorWeek=@week
      AND CustKey=@ck AND ProdKey=@pk AND Unit=@unit AND SourceDate=@date`, {
    yr: str(request.sourceYear), week: str(request.sourceMajorWeek), ck: int(request.custKey),
    pk: int(request.prodKey), unit: str(request.unit), date: str(request.sourceDate),
  });
  const classified=result.recordset?.[0]?.Classified;
  if (classified==null || !Number.isFinite(Number(classified)) || Number(classified)<0)
    throw earlyShipmentError('EARLY_CLASSIFICATION_UNKNOWN','활성 선출고 분류 합계를 확인할 수 없습니다.',409);
  return Number(classified);
}

// A linked APPLIED record is useful only while its exact native source date
// still contains the classified quantity. Both history GET and upload call this.
export async function assertActiveEarlyClassificationIntegrity(queryFn, operations = []) {
  const groups=new Map();
  for (const row of operations) {
    const scope={sourceYear:Number(row.sourceYear??row.SourceYear),
      sourceMajorWeek:String(row.sourceMajorWeek??row.SourceMajorWeek),
      sourceOrderWeek:String(row.sourceOrderWeek??row.SourceOrderWeek),
      sourceDate:String(row.sourceDate??row.SourceDate).slice(0,10),
      custKey:Number(row.custKey??row.CustKey),prodKey:Number(row.prodKey??row.ProdKey),
      unit:String(row.unit??row.Unit)};
    const key=`${scope.sourceYear}|${scope.sourceMajorWeek}|${scope.sourceOrderWeek}|${scope.sourceDate}|${scope.custKey}|${scope.prodKey}|${scope.unit}`;
    groups.set(key,scope);
  }
  for (const scope of groups.values()) {
    const active=await readEarlyClassification(queryFn,scope);
    if (active<=0)
      throw earlyShipmentError('EARLY_SOURCE_CLASSIFICATION_STALE','APPLIED 선출고의 활성 분류 합계가 없습니다.',409,{scope});
    const actual=await queryFn(`SELECT p.OutUnit,COUNT_BIG(*) AS DateRows,
        COUNT_BIG(pd.OrderYearWeek) AS ExactCalendarRows,
        MIN(sd.CustKey) AS DetailCustKey,
        SUM(d.ShipmentQuantity) AS DateQuantity
      FROM Product p WITH (UPDLOCK,HOLDLOCK)
      JOIN ShipmentDetail sd WITH (UPDLOCK,HOLDLOCK) ON sd.ProdKey=p.ProdKey
      JOIN ShipmentMaster sm WITH (UPDLOCK,HOLDLOCK) ON sm.ShipmentKey=sd.ShipmentKey
      JOIN ShipmentDate d WITH (UPDLOCK,HOLDLOCK) ON d.SdetailKey=sd.SdetailKey
      LEFT JOIN PeriodDay pd WITH (UPDLOCK,HOLDLOCK)
        ON pd.OrderYearWeek=@majorYwk
        AND CONVERT(datetime,pd.BaseYmd,121)=d.ShipmentDtm
      WHERE p.ProdKey=@pk AND ISNULL(p.isDeleted,0)=0
        AND sm.OrderYear=@yr AND sm.OrderWeek=@week AND sm.CustKey=@ck
        AND ISNULL(sm.isDeleted,0)=0
        AND d.ShipmentDtm>=CONVERT(date,@date,23)
        AND d.ShipmentDtm<DATEADD(day,1,CONVERT(date,@date,23))
      GROUP BY p.OutUnit`,{
      pk:int(scope.prodKey),yr:str(scope.sourceYear),week:str(scope.sourceOrderWeek),
      majorYwk:str(`${scope.sourceYear}${scope.sourceMajorWeek}`),
      ck:int(scope.custKey),date:str(scope.sourceDate),
    });
    const rows=actual.recordset||[];
    const native=rows[0];
    if (rows.length!==1 || Number(native.DateRows)!==1
      || Number(native.ExactCalendarRows)!==1
      || !weekdayDetailCustomerMatchesMaster(native.DetailCustKey,scope.custKey)
      || normalizeWeekdayUnit(native.OutUnit)!==scope.unit
      || !Number.isFinite(Number(native.DateQuantity))
      || Number(native.DateQuantity)+1e-6<active)
      throw earlyShipmentError('EARLY_SOURCE_CLASSIFICATION_STALE',
        `원천 ${scope.sourceYear}/${scope.sourceOrderWeek}/${scope.sourceDate} 분배량이 활성 선출고 ${active}${scope.unit}보다 작거나 연결이 바뀌었습니다. 연결 이력을 먼저 확인하세요.`,409,
        {scope,activeClassified:active,actualQuantity:native?.DateQuantity??null});
  }
}

export async function listEarlyOperations(queryFn, { year, majorWeek, custKey }) {
  const result = await queryFn(`SELECT OperationId,Status,Revision,SourceYear,SourceMajorWeek,
    TargetYear,TargetMajorWeek,CustKey,ProdKey,Unit,Quantity,
    CONVERT(nvarchar(10),SourceDate,120) AS SourceDate,SourceDateBefore,SourceDateFinal,
    SourceDateDelta,SourceOrderWeek,SourceStockAnchorWeek,TargetStockAnchorWeek,
    TargetImportWeek,AllocationIntent,ConfirmationAfterJson,CreatedAt,UpdatedAt
    FROM dbo.WebEarlyShipmentOperation
    WHERE CustKey=@ck AND ((SourceYear=@yr AND SourceMajorWeek=@week)
      OR (TargetYear=@yr AND TargetMajorWeek=@week))
      AND Status IN (N'APPLIED',N'REVERSED')
    ORDER BY CreatedAt DESC,OperationId DESC`, {
    yr: str(year), week: str(majorWeek), ck: int(custKey),
  });
  const records=(result.recordset || []).map(row => ({
    operationId: String(row.OperationId), status: String(row.Status), revision: Number(row.Revision),
    sourceYear: Number(row.SourceYear), sourceMajorWeek: String(row.SourceMajorWeek),
    targetYear: Number(row.TargetYear), targetMajorWeek: String(row.TargetMajorWeek),
    custKey: Number(row.CustKey), prodKey: Number(row.ProdKey), unit: String(row.Unit),
    quantity: Number(row.Quantity), sourceDate: row.SourceDate,
    sourceDateBefore: Number(row.SourceDateBefore), sourceDateFinal: Number(row.SourceDateFinal),
    sourceDateDelta: Number(row.SourceDateDelta), sourceOrderWeek: String(row.SourceOrderWeek),
    sourceStockAnchorWeek: String(row.SourceStockAnchorWeek),
    targetStockAnchorWeek: String(row.TargetStockAnchorWeek),
    targetImportWeek: String(row.TargetImportWeek), allocationIntent: String(row.AllocationIntent),
    confirmationAfter: row.ConfirmationAfterJson ? JSON.parse(row.ConfirmationAfterJson) : null,
    createdAt: row.CreatedAt, updatedAt: row.UpdatedAt,
  }));
  await assertActiveEarlyClassificationIntegrity(queryFn,records.filter(row=>row.status==='APPLIED'));
  return records;
}

// Same helper is used by upload preview and the locked apply transaction.
export async function getEarlyShipmentExclusions(queryFn, { year, majorWeek, custKeys, prodKeys, orderWeek }) {
  const normalizedYear = String(year ?? '');
  const normalizedMajor = String(majorWeek ?? '').padStart(2, '0');
  const customerList = [...new Set((custKeys || []).map(Number))].sort((a,b) => a-b);
  const productList = [...new Set((prodKeys || []).map(Number))].sort((a,b) => a-b);
  if (!/^\d{4}$/.test(normalizedYear) || !/^\d{2}$/.test(normalizedMajor)
    || [...customerList,...productList].some(value => !Number.isSafeInteger(value) || value <= 0)
    || orderWeek != null && !new RegExp(`^${normalizedMajor}-0[1-4]$`).test(String(orderWeek)))
    throw earlyShipmentError('EARLY_EXCLUSION_SCOPE', '업로드 선출고 조회 범위가 올바르지 않습니다.', 400);
  await assertEarlyShipmentSchema(queryFn);
  const scope = { year:Number(normalizedYear), majorWeek:normalizedMajor, orderWeek:orderWeek || null };
  if (!customerList.length || !productList.length)
    return { scope, rows:[], fingerprint:digest({scope,rows:[]}) };
  const params = { yr: str(normalizedYear), week: str(normalizedMajor) };
  const ckNames = customerList.map((value, index) => { params[`ck${index}`] = int(value); return `@ck${index}`; });
  const pkNames = productList.map((value, index) => { params[`pk${index}`] = int(value); return `@pk${index}`; });
  const result = await queryFn(`SELECT OperationId,CustKey,ProdKey,Unit,Quantity,TargetImportWeek,
      TargetYear,TargetMajorWeek,Revision,SourceYear,SourceMajorWeek,SourceOrderWeek,
      CONVERT(nvarchar(10),SourceDate,120) AS SourceDate
    FROM dbo.WebEarlyShipmentOperation WITH (UPDLOCK,HOLDLOCK)
    WHERE Status=N'APPLIED' AND TargetYear=@yr AND TargetMajorWeek=@week
      AND CustKey IN (${ckNames.join(',')}) AND ProdKey IN (${pkNames.join(',')})
    ORDER BY CustKey,ProdKey,Unit,OperationId`, params);
  await assertActiveEarlyClassificationIntegrity(queryFn,result.recordset||[]);
  const buckets = new Map();
  for (const row of result.recordset || []) {
    const key = `${Number(row.CustKey)}|${Number(row.ProdKey)}|${String(row.Unit)}`;
    const entry = buckets.get(key) || { custKey:Number(row.CustKey), prodKey:Number(row.ProdKey),
      unit:String(row.Unit), processedEarlyTotal:0, targetImportYear:Number(row.TargetYear),
      targetImportWeek:String(row.TargetImportWeek), operationIds:[], operationVersions:[] };
    if (entry.targetImportWeek !== String(row.TargetImportWeek)
      || entry.targetImportYear !== Number(row.TargetYear))
      throw earlyShipmentError('EARLY_IMPORT_ANCHOR_CONFLICT', '같은 대상 물량의 업로드 세부차수가 충돌합니다.', 409);
    entry.processedEarlyTotal = Math.round((entry.processedEarlyTotal + Number(row.Quantity)) * 100) / 100;
    entry.operationIds.push(String(row.OperationId));
    entry.operationVersions.push(`${String(row.OperationId)}:${Number(row.Revision)}`);
    buckets.set(key, entry);
  }
  const rows = [...buckets.values()].map(row => ({ ...row,
    earlyExcludedApplied: orderWeek == null || orderWeek === row.targetImportWeek ? row.processedEarlyTotal : 0 }));
  return { scope, rows, fingerprint:digest({ scope, rows }) };
}

// Call after an early-mode Excel import's physical readback and before its
// outer transaction commits. A source-cycle import must not erase APPLIED q.
export async function assertEarlyShipmentSourceIntegrity(queryFn,{year,majorWeek,custKeys,prodKeys}) {
  const normalizedYear=String(year??'');
  const normalizedMajor=String(majorWeek??'').padStart(2,'0');
  const customerList=[...new Set((custKeys||[]).map(Number))].sort((a,b)=>a-b);
  const productList=[...new Set((prodKeys||[]).map(Number))].sort((a,b)=>a-b);
  if (!/^\d{4}$/.test(normalizedYear)||Number(normalizedYear)<2026
    || !/^\d{2}$/.test(normalizedMajor)||Number(normalizedMajor)<1||Number(normalizedMajor)>53
    || [...customerList,...productList].some(value=>!Number.isSafeInteger(value)||value<=0))
    throw earlyShipmentError('EARLY_SOURCE_SCOPE','원천 선출고 검증 범위가 올바르지 않습니다.',400);
  await assertEarlyShipmentSchema(queryFn);
  const scope={year:Number(normalizedYear),majorWeek:normalizedMajor,
    custKeys:customerList,prodKeys:productList};
  if (!customerList.length||!productList.length)
    return {scope,checked:0,fingerprint:digest({scope,operations:[]})};
  const params={yr:str(normalizedYear),week:str(normalizedMajor)};
  const ckNames=customerList.map((value,index)=>{
    params[`ck${index}`]=int(value);return `@ck${index}`;
  });
  const pkNames=productList.map((value,index)=>{
    params[`pk${index}`]=int(value);return `@pk${index}`;
  });
  const result=await queryFn(`SELECT OperationId,Revision,SourceYear,SourceMajorWeek,
      SourceOrderWeek,CONVERT(nvarchar(10),SourceDate,120) AS SourceDate,
      CustKey,ProdKey,Unit,Quantity
    FROM dbo.WebEarlyShipmentOperation WITH (UPDLOCK,HOLDLOCK)
    WHERE Status=N'APPLIED' AND SourceYear=@yr AND SourceMajorWeek=@week
      AND CustKey IN (${ckNames.join(',')}) AND ProdKey IN (${pkNames.join(',')})
    ORDER BY SourceOrderWeek,SourceDate,CustKey,ProdKey,OperationId`,params);
  const operations=result.recordset||[];
  await assertActiveEarlyClassificationIntegrity(queryFn,operations);
  return {scope,checked:operations.length,
    fingerprint:digest({scope,operations:operations.map(row=>({
      operationId:String(row.OperationId),revision:Number(row.Revision),
      sourceOrderWeek:String(row.SourceOrderWeek),sourceDate:String(row.SourceDate),
      custKey:Number(row.CustKey),prodKey:Number(row.ProdKey),unit:String(row.Unit),
      quantity:Number(row.Quantity)}))})};
}

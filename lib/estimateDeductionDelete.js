// 견적서의 불량/검역 차감 Estimate만 선택적으로 삭제한다.
// 이 모듈은 DB executor를 주입받아 API와 rollback fixture가 같은 경로를 사용한다.
import { isLegacyDeductionType } from './estimateDeductionTypes.js';

const DEDUCTION_LABELS = new Set(['불량차감', '검역차감']);

function failure(message, code = 'ESTIMATE_DEDUCTION_DELETE_INVALID', statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function positiveInteger(value, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 2147483647) {
    throw failure(`${label}는 0보다 큰 정수여야 합니다.`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw failure(`${label} 스냅샷 값이 올바르지 않습니다.`);
  }
  return value;
}

function requiredText(value, label) {
  if (typeof value !== 'string') throw failure(`${label} 스냅샷 값이 필요합니다.`);
  return value;
}

function normalizeDeductionLabel(value) {
  return String(value || '').trim().replace(/[\s\-]/g, '');
}

function isDeductionType(row = {}) {
  const labels = [row.TypeDescr2, row.TypeDescr, row.EstimateType]
    .map(normalizeDeductionLabel);
  // Code rows must be classified by CodeInfo.Descr2/Descr.  Only old Estimate
  // values that literally contain the legacy deduction label can bypass it.
  return DEDUCTION_LABELS.has(labels[0]) || DEDUCTION_LABELS.has(labels[1])
    || isLegacyDeductionType(row.TypeDescr) || isLegacyDeductionType(row.EstimateType);
}

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function sameFinite(actual, expected) {
  // Estimate numeric columns include Float in legacy rows.  Exact client snapshots
  // are still compared without allowing a value-changing display round trip.
  return Number.isFinite(Number(actual)) && Number(actual) === expected;
}

function decimal4(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  return Math.round((numeric + Number.EPSILON) * 10000) / 10000;
}

function assertExpected(row, entry) {
  const expected = entry.expected;
  const comparisons = [
    ['Quantity', expected.quantity, '수량'], ['Cost', expected.cost, '단가'],
    ['Amount', expected.amount, '공급가'], ['Vat', expected.vat, '부가세'],
  ];
  for (const [column, value, label] of comparisons) {
    if (!sameFinite(row[column], value)) {
      throw failure(`견적 ${entry.estimateKey}의 ${label}이 조회 이후 변경되었습니다. 다시 조회하세요.`, 'ESTIMATE_DEDUCTION_DELETE_STALE', 409);
    }
  }
  if (String(row.Unit || '') !== expected.unit
      || String(row.EstimateType || '') !== expected.estimateType
      || String(row.Descr || '') !== expected.descr
      || dateOnly(row.EstimateDate) !== (expected.estimateDate || '')) {
    throw failure(`견적 ${entry.estimateKey}의 유형·단위·적요·일자가 조회 이후 변경되었습니다. 다시 조회하세요.`, 'ESTIMATE_DEDUCTION_DELETE_STALE', 409);
  }
}

export function normalizeEstimateDeductionDeleteRequest(body = {}) {
  const orderYear = String(body.orderYear || '').trim();
  const orderWeek = String(body.orderWeek || '').trim();
  if (!/^\d{4}$/.test(orderYear)) throw failure('선택 연도(4자리)가 필요합니다.');
  if (!/^\d{1,2}$/.test(orderWeek) || Number(orderWeek) < 1 || Number(orderWeek) > 53) {
    throw failure('삭제할 부모 차수(예: 34)를 확인하세요.');
  }
  const custKey = positiveInteger(body.custKey, '거래처 번호');
  if (!body.editGuard || typeof body.editGuard !== 'object') {
    throw failure('편집 보호 정보가 없습니다. 화면을 다시 조회한 뒤 삭제하세요.', 'ERP_EDIT_GUARD_INVALID', 409);
  }
  if (!String(body.editGuard.leaseToken || body.editGuard.token || '').trim() || !String(body.editGuard.clientId || '').trim()) {
    throw failure('편집 보호 정보가 불완전합니다. 화면을 다시 조회한 뒤 삭제하세요.', 'ERP_EDIT_GUARD_INVALID', 409);
  }
  if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 200) {
    throw failure('삭제할 차감 견적을 1~200건 선택하세요.');
  }
  const seen = new Set();
  const entries = body.entries.map((raw, index) => {
    const estimateKey = positiveInteger(raw?.estimateKey, `${index + 1}번째 견적 번호`);
    const shipmentKey = positiveInteger(raw?.shipmentKey, `${index + 1}번째 출고 번호`);
    const prodKey = positiveInteger(raw?.prodKey, `${index + 1}번째 품목 번호`);
    if (seen.has(estimateKey)) throw failure('같은 견적을 중복 선택할 수 없습니다.');
    seen.add(estimateKey);
    const expected = raw?.expected;
    if (!expected || typeof expected !== 'object') throw failure(`${index + 1}번째 견적의 조회 스냅샷이 필요합니다.`);
    const estimateDate = expected.estimateDate == null ? null : requiredText(expected.estimateDate, '견적 일자');
    if (estimateDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(estimateDate)) throw failure('견적 일자는 YYYY-MM-DD 형식이거나 null이어야 합니다.');
    return {
      estimateKey, shipmentKey, prodKey,
      expected: {
        quantity: finiteNumber(expected.quantity, '수량'), cost: finiteNumber(expected.cost, '단가'),
        amount: finiteNumber(expected.amount, '공급가'), vat: finiteNumber(expected.vat, '부가세'),
        unit: requiredText(expected.unit, '단위'), estimateType: requiredText(expected.estimateType, '견적 유형'),
        descr: requiredText(expected.descr, '적요'), estimateDate,
      },
    };
  });
  // A stable lock order avoids avoidable lock inversions when callers submit
  // the same selected rows in a different visual order.
  entries.sort((left, right) => left.estimateKey - right.estimateKey);
  return { orderYear, orderWeek: String(Number(orderWeek)).padStart(2, '0'), custKey, entries, editGuard: body.editGuard };
}

function p(sql, value) { return { type: sql.Int, value }; }
function textParam(sql, value) { return { type: sql.NVarChar, value: String(value ?? '') }; }
function nullableTextParam(sql, value) { return { type: sql.NVarChar, value: value == null ? null : String(value) }; }

function beforeSnapshot(row) {
  return {
    estimateKey: Number(row.EstimateKey), shipmentKey: Number(row.ShipmentKey), prodKey: Number(row.ProdKey),
    orderYear: String(row.OrderYear), orderWeek: String(row.OrderWeek), custKey: Number(row.CustKey),
    estimateType: String(row.EstimateType || ''), typeDescr: String(row.TypeDescr || ''), typeDescr2: String(row.TypeDescr2 || ''), estimateDtm: row.RawEstimateDtm ?? null,
    quantity: Number(row.Quantity), cost: Number(row.Cost), amount: Number(row.Amount), vat: Number(row.Vat),
    unit: String(row.Unit || ''), descr: String(row.Descr || ''), estimateDate: dateOnly(row.EstimateDate),
  };
}

function ledgerSnapshot(row) {
  const copy = {};
  for (const key of ['DeductionKey', 'EstimateKey', 'EstimateCost', 'EstimateDtm', 'AppliedOrderYear', 'AppliedOrderWeek', 'AppliedShipmentKey', 'AppliedCostSourceYear', 'AppliedCostSourceWeek', 'Quantity', 'OriginalQuantity', 'RemainingQuantity', 'SourceUnit', 'Status', 'IsCarryoverLedger', 'IsDeleted', 'RowVersionNo', 'CreatedBy', 'CreatedByName', 'ImportConfirmed', 'ImportReviewRequired']) copy[key] = row[key] ?? null;
  return copy;
}

async function tableReady(tQ) {
  const result = await tQ(
    `SELECT CASE WHEN OBJECT_ID(N'dbo.WebSalesDefectDeduction', N'U') IS NULL THEN 0 ELSE 1 END AS DeductionReady,
            CASE WHEN OBJECT_ID(N'dbo.WebSalesCarryoverApplication', N'U') IS NULL THEN 0 ELSE 1 END AS ApplicationReady,
            CASE WHEN OBJECT_ID(N'dbo.WebSalesDefectDeductionHistory', N'U') IS NULL THEN 0 ELSE 1 END AS HistoryReady`, {},
  );
  const row = result.recordset?.[0] || {};
  const readiness = [row.DeductionReady, row.ApplicationReady, row.HistoryReady].map(Number);
  if (readiness.every((ready) => ready === 0)) return false;
  if (!readiness.every((ready) => ready === 1)) {
    throw failure('웹 차감 원장 스키마가 일부만 적용되어 삭제를 진행할 수 없습니다. 관리자에게 마이그레이션 적용을 요청하세요.', 'ESTIMATE_DEDUCTION_DELETE_SCHEMA', 503);
  }
  return true;
}

async function readLockedEstimate(tQ, sql, scope, entry) {
  const result = await tQ(
    `SELECT e.EstimateKey, e.ShipmentKey, e.ProdKey, e.EstimateType, e.EstimateDtm AS RawEstimateDtm, CONVERT(NVARCHAR(10),e.EstimateDtm,23) AS EstimateDate,
            ISNULL(e.Unit,N'') AS Unit, ISNULL(e.Quantity,0) AS Quantity, ISNULL(e.Cost,0) AS Cost,
            ISNULL(e.Amount,0) AS Amount, ISNULL(e.Vat,0) AS Vat, ISNULL(e.Descr,N'') AS Descr,
            sm.OrderYear, sm.OrderWeek, sm.CustKey,
            ISNULL(ci.Descr,N'') AS TypeDescr, ISNULL(ci.Descr2,N'') AS TypeDescr2
       FROM Estimate e WITH (UPDLOCK,HOLDLOCK)
       JOIN ShipmentMaster sm WITH (UPDLOCK,HOLDLOCK) ON sm.ShipmentKey=e.ShipmentKey AND ISNULL(sm.isDeleted,0)=0
       LEFT JOIN CodeInfo ci WITH (UPDLOCK,HOLDLOCK) ON ci.Category=N'EstimateType' AND ci.DetailCode=e.EstimateType
      WHERE e.EstimateKey=@ek AND e.ShipmentKey=@sk AND e.ProdKey=@pk
        AND sm.OrderYear=@year AND sm.CustKey=@cust
        AND TRY_CONVERT(INT,LEFT(sm.OrderWeek,CHARINDEX(N'-',sm.OrderWeek+N'-')-1))=@week`,
    { ek: p(sql, entry.estimateKey), sk: p(sql, entry.shipmentKey), pk: p(sql, entry.prodKey), year: textParam(sql, scope.orderYear), cust: p(sql, scope.custKey), week: p(sql, Number(scope.orderWeek)) },
  );
  const row = result.recordset?.[0];
  if (!row) throw failure(`견적 ${entry.estimateKey}은(는) 선택한 연도·차수·업체의 활성 출고 행이 아닙니다.`, 'ESTIMATE_DEDUCTION_DELETE_SCOPE', 409);
  if (!(Number(row.Quantity) < 0) || !isDeductionType(row)) {
    throw failure(`견적 ${entry.estimateKey}은(는) 불량차감 또는 검역차감 음수 행이 아니므로 삭제할 수 없습니다.`, 'ESTIMATE_DEDUCTION_DELETE_INELIGIBLE', 409);
  }
  assertExpected(row, entry);
  return row;
}

async function writeHistory(tQ, sql, row, user, before, after) {
  await tQ(
    `INSERT INTO WebSalesDefectDeductionHistory
       (DeductionKey,ActionType,ChangedBy,ChangedByName,ChangeSummary,BeforeJson,AfterJson)
     VALUES (@key,N'ESTIMATE_UNLINK',@by,@name,N'견적서 선택 삭제 연결 해제',@before,@after)`,
    { key: p(sql, Number(row.DeductionKey)), by: textParam(sql, user?.userId), name: textParam(sql, user?.userName), before: textParam(sql, JSON.stringify(before)), after: textParam(sql, JSON.stringify(after)) },
  );
}

function assertLinkedSourceScope(locked, selected, key) {
  if (Number(locked.CustKey) !== Number(selected.CustKey) || Number(locked.ProdKey) !== Number(selected.ProdKey)) {
    throw failure(`웹 차감 원장 ${key}의 업체 또는 품목이 삭제 견적과 달라 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_LEDGER_AMBIGUOUS', 409);
  }
}

async function lockLedgerUnlinkPlans(tQ, sql, deletedKeys, selectedByEstimateKey) {
  if (!await tableReady(tQ)) return [];
  const affected = new Map();
  for (const estimateKey of deletedKeys) {
    const direct = await tQ(
      `SELECT * FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK)
        WHERE IsDeleted=0 AND EstimateKey=@ek`, { ek: p(sql, estimateKey) },
    );
    const applied = await tQ(
      `SELECT d.* FROM WebSalesDefectDeduction d WITH (UPDLOCK,HOLDLOCK)
        JOIN WebSalesCarryoverApplication a WITH (UPDLOCK,HOLDLOCK) ON a.DeductionKey=d.DeductionKey
       WHERE d.IsDeleted=0 AND a.EstimateKey=@ek`, { ek: p(sql, estimateKey) },
    );
    for (const row of [...(direct.recordset || []), ...(applied.recordset || [])]) affected.set(Number(row.DeductionKey), row);
  }
  const plans = [];
  for (const [key, locked] of affected) {
    const appsResult = await tQ(
      `SELECT a.ApplicationKey,a.EstimateKey,a.AppliedOrderYear,a.AppliedOrderWeek,a.AppliedShipmentKey,a.AppliedQuantity,a.AppliedCost,a.AppliedAt,
              CASE WHEN e.EstimateKey IS NULL THEN 0 ELSE 1 END AS EstimateLive, e.EstimateDtm
         FROM WebSalesCarryoverApplication a WITH (UPDLOCK,HOLDLOCK)
         LEFT JOIN Estimate e WITH (UPDLOCK,HOLDLOCK) ON e.EstimateKey=a.EstimateKey
        WHERE a.DeductionKey=@key
        ORDER BY a.AppliedAt DESC,a.ApplicationKey DESC`, { key: p(sql, key) },
    );
    const apps = appsResult.recordset || [];
    const before = ledgerSnapshot(locked);
    if (!Number(locked.IsCarryoverLedger)) {
      if (!deletedKeys.has(Number(locked.EstimateKey))) continue;
      assertLinkedSourceScope(locked, selectedByEstimateKey.get(Number(locked.EstimateKey)), key);
      plans.push({ kind: 'DIRECT', key, locked, before });
      continue;
    }
    const selected = apps.filter((app) => deletedKeys.has(Number(app.EstimateKey)));
    if (!selected.length) {
      throw failure(`이월 차감 원장 ${key}의 삭제 견적 연결에 적용 이력이 없어 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_LEDGER_AMBIGUOUS', 409);
    }
    const selectedEstimateKeys = new Set();
    let restored = 0;
    for (const app of selected) {
      const appKey = Number(app.EstimateKey);
      const quantity = Number(app.AppliedQuantity);
      if (!Number.isFinite(quantity) || !(quantity > 0) || selectedEstimateKeys.has(appKey)) {
        throw failure(`이월 차감 원장 ${key}의 적용 이력이 중복되었거나 수량이 올바르지 않아 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_LEDGER_AMBIGUOUS', 409);
      }
      selectedEstimateKeys.add(appKey);
      assertLinkedSourceScope(locked, selectedByEstimateKey.get(appKey), key);
      restored = decimal4(restored + quantity);
      if (!Number.isFinite(restored) || Math.abs(restored) > Number.MAX_SAFE_INTEGER) {
        throw failure(`이월 차감 원장 ${key}의 복원 수량이 너무 커 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_LEDGER_AMBIGUOUS', 409);
      }
    }
    const original = Number(locked.OriginalQuantity ?? locked.Quantity);
    const nextRemaining = decimal4(Number(locked.RemainingQuantity ?? locked.Quantity) + restored);
    if (!(original >= 0) || !Number.isFinite(nextRemaining) || Math.abs(nextRemaining) > Number.MAX_SAFE_INTEGER || nextRemaining < -0.0001 || nextRemaining > original + 0.0001) {
      throw failure(`이월 차감 원장 ${key}의 복원 수량이 원본 수량을 초과하여 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_LEDGER_AMBIGUOUS', 409);
    }
    const survivor = apps.find((app) => !deletedKeys.has(Number(app.EstimateKey)) && Number(app.EstimateLive) === 1) || null;
    const preserveCostSource = Boolean(survivor && Number(locked.EstimateKey) === Number(survivor.EstimateKey));
    plans.push({ kind: 'CARRYOVER', key, locked, before, survivor, nextRemaining, preserveCostSource });
  }
  return plans;
}

async function readPersistedLedger(tQ, sql, key) {
  const result = await tQ(
    `SELECT * FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`,
    { key: p(sql, key) },
  );
  const row = result.recordset?.[0];
  if (!row) throw failure(`웹 차감 원장 ${key} 저장 결과를 확인하지 못해 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_VERIFY', 409);
  return row;
}

function assertPersistedLedger(plan, after) {
  const expectedVersion = Number(plan.before.RowVersionNo || 0) + 1;
  if (Number(after.RowVersionNo) !== expectedVersion) throw failure(`웹 차감 원장 ${plan.key}의 버전 확인에 실패해 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_VERIFY', 409);
  if (plan.kind === 'DIRECT') {
    if (after.EstimateKey != null || String(after.Status) !== 'DRAFT') throw failure(`웹 차감 원장 ${plan.key}의 연결 해제를 확인하지 못해 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_VERIFY', 409);
    return;
  }
  const expectedKey = plan.survivor ? Number(plan.survivor.EstimateKey) : null;
  if (decimal4(after.RemainingQuantity) !== decimal4(plan.nextRemaining)
      || (after.EstimateKey == null ? null : Number(after.EstimateKey)) !== expectedKey
      || String(after.Status) !== (plan.nextRemaining > 0 ? 'CARRYOVER' : 'COMPLETED')
      || (!plan.preserveCostSource && (after.AppliedCostSourceYear != null || after.AppliedCostSourceWeek != null))) {
    throw failure(`이월 차감 원장 ${plan.key}의 복원 결과를 확인하지 못해 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_VERIFY', 409);
  }
}

async function applyLockedLedgerUnlinkPlans(tQ, sql, plans, user) {
  const persisted = [];
  for (const plan of plans) {
    const { key, locked, before } = plan;
    if (plan.kind === 'DIRECT') {
      await tQ(
        `UPDATE WebSalesDefectDeduction
            SET EstimateKey=NULL, EstimateCost=NULL, EstimateDtm=NULL,
                AppliedOrderYear=NULL, AppliedOrderWeek=NULL, AppliedShipmentKey=NULL,
                AppliedCostSourceYear=NULL, AppliedCostSourceWeek=NULL, Status=N'DRAFT',
                UpdatedBy=@by, UpdatedByName=@name, UpdatedAt=GETDATE(), RowVersionNo=ISNULL(RowVersionNo,0)+1
          WHERE DeductionKey=@key AND IsDeleted=0 AND EstimateKey=@deletedEstimateKey`,
        { key: p(sql, key), deletedEstimateKey: p(sql, Number(locked.EstimateKey)), by: textParam(sql, user?.userId), name: textParam(sql, user?.userName) },
      );
      const actual = await readPersistedLedger(tQ, sql, key);
      assertPersistedLedger(plan, actual);
      const after = ledgerSnapshot(actual);
      await writeHistory(tQ, sql, locked, user, before, after);
      persisted.push(after);
      continue;
    }
    const { survivor, nextRemaining, preserveCostSource } = plan;
    await tQ(
      `UPDATE WebSalesDefectDeduction
          SET EstimateKey=@estimateKey, EstimateCost=@cost, EstimateDtm=@date,
              AppliedOrderYear=@year, AppliedOrderWeek=@week, AppliedShipmentKey=@shipment,
              AppliedCostSourceYear=@sourceYear, AppliedCostSourceWeek=@sourceWeek,
              RemainingQuantity=@remaining, Status=@status,
              UpdatedBy=@by, UpdatedByName=@name, UpdatedAt=GETDATE(), RowVersionNo=ISNULL(RowVersionNo,0)+1
        WHERE DeductionKey=@key AND IsDeleted=0`,
      {
        key: p(sql, key), estimateKey: p(sql, survivor ? Number(survivor.EstimateKey) : null), cost: { type: sql.Decimal(18, 4), value: survivor ? Number(survivor.AppliedCost) : null }, date: { type: sql.DateTime, value: survivor?.EstimateDtm || null },
        year: p(sql, survivor ? Number(survivor.AppliedOrderYear) : null), week: nullableTextParam(sql, survivor ? survivor.AppliedOrderWeek : null), shipment: p(sql, survivor ? Number(survivor.AppliedShipmentKey) : null),
        sourceYear: p(sql, preserveCostSource ? Number(locked.AppliedCostSourceYear) || null : null), sourceWeek: nullableTextParam(sql, preserveCostSource ? locked.AppliedCostSourceWeek : null),
        remaining: { type: sql.Decimal(18, 4), value: nextRemaining }, status: textParam(sql, nextRemaining > 0 ? 'CARRYOVER' : 'COMPLETED'), by: textParam(sql, user?.userId), name: textParam(sql, user?.userName),
      },
    );
    const actual = await readPersistedLedger(tQ, sql, key);
    assertPersistedLedger(plan, actual);
    const after = ledgerSnapshot(actual);
    await writeHistory(tQ, sql, locked, user, before, after);
    persisted.push(after);
  }
  return persisted;
}

async function writeAudit(tQ, sql, { rows, scope, user, request, linkedAfter }) {
  const payload = JSON.stringify({
    scope, actor: { userId: String(user?.userId || ''), userName: String(user?.userName || '') }, selected: rows.map(beforeSnapshot),
    linkedAfter: linkedAfter.map((row) => ({ ...row, unlinkActor: { userId: String(user?.userId || ''), userName: String(user?.userName || '') } })),
    requested: request.entries.map((entry) => ({ estimateKey: entry.estimateKey, shipmentKey: entry.shipmentKey, prodKey: entry.prodKey })),
  });
  await tQ(
    `INSERT INTO SystemActionLog
       (ActionDtm,Actor,SessionId,ActionType,Method,Endpoint,AffectedTable,AffectedCount,Payload,Result,ResultDesc,RiskLevel,IpAddress,UserAgent)
     VALUES (GETDATE(),@actor,@session,N'ESTIMATE_DEDUCTION_DELETE',N'POST',N'/api/estimate/delete-deductions',N'Estimate',@count,@payload,N'SUCCESS',N'불량/검역 차감 선택 삭제',N'HIGH',@ip,@ua)`,
    { actor: textParam(sql, user?.userId || user?.userName), session: textParam(sql, user?.sessionId), count: p(sql, rows.length), payload: textParam(sql, payload), ip: textParam(sql, user?.ipAddress), ua: textParam(sql, user?.userAgent) },
  );
}

export async function executeEstimateDeductionDelete(tQ, request, deps = {}) {
  const { sql, user = {}, assertEditGuard, advanceEditGuard } = deps;
  if (!sql || typeof tQ !== 'function' || typeof assertEditGuard !== 'function' || typeof advanceEditGuard !== 'function') {
    throw new TypeError('삭제 실행에는 sql, transaction query, 편집 보호 의존성이 필요합니다.');
  }
  const scope = { orderYear: request.orderYear, orderWeek: request.orderWeek, custKey: request.custKey };
  await assertEditGuard(tQ, scope, user, { editGuard: request.editGuard });
  const rows = [];
  for (const entry of request.entries) rows.push(await readLockedEstimate(tQ, sql, scope, entry));
  const deletedKeys = new Set(rows.map((row) => Number(row.EstimateKey)));
  const selectedByEstimateKey = new Map(rows.map((row) => [Number(row.EstimateKey), row]));
  // All affected web-ledger/application rows are locked and their restoration
  // plans are validated before the first DELETE.  The following mutations are
  // therefore one all-or-nothing commit scope.
  const ledgerPlans = await lockLedgerUnlinkPlans(tQ, sql, deletedKeys, selectedByEstimateKey);
  for (const row of rows) {
    const removed = await tQ(
      `DECLARE @Deleted TABLE (EstimateKey INT PRIMARY KEY);
       DELETE FROM Estimate
       OUTPUT DELETED.EstimateKey INTO @Deleted(EstimateKey)
       WHERE EstimateKey=@ek AND ShipmentKey=@sk AND ProdKey=@pk;
       SELECT EstimateKey FROM @Deleted;`,
      { ek: p(sql, Number(row.EstimateKey)), sk: p(sql, Number(row.ShipmentKey)), pk: p(sql, Number(row.ProdKey)) },
    );
    if (Number(removed.rowsAffected?.[0] || 0) !== 1 && Number(removed.recordset?.[0]?.EstimateKey || 0) !== Number(row.EstimateKey)) {
      throw failure(`견적 ${row.EstimateKey} 삭제를 확인하지 못해 전체 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_VERIFY', 409);
    }
    const absent = await tQ(`SELECT EstimateKey FROM Estimate WITH (UPDLOCK,HOLDLOCK) WHERE EstimateKey=@ek`, { ek: p(sql, Number(row.EstimateKey)) });
    if (absent.recordset?.[0]) throw failure(`견적 ${row.EstimateKey} 삭제 후 재조회에 남아 있어 전체 삭제를 취소했습니다.`, 'ESTIMATE_DEDUCTION_DELETE_VERIFY', 409);
  }
  const linkedAfter = await applyLockedLedgerUnlinkPlans(tQ, sql, ledgerPlans, user);
  await writeAudit(tQ, sql, { rows, scope, user, request, linkedAfter });
  const guard = await advanceEditGuard(tQ, scope, user, { editGuard: request.editGuard });
  return { success: true, deletedCount: rows.length, deletedEstimateKeys: [...deletedKeys], linkedRegistrationCount: linkedAfter.length, editDigestAfter: guard?.editDigestAfter, revision: guard?.revision };
}

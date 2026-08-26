import { query, sql, withTransaction } from './db.js';
import { isEarlierOrSameScope, normalizeDefectUnit, normalizeParentWeek, normalizeYear } from './salesDefectDeductionCore.js';

const ACTION = 'MANUAL_COST';
const text = (value, length = 100) => String(value ?? '').trim().slice(0, length);

export function validateManualCost(value) {
  if (value === null) return null;
  if (!['string', 'number'].includes(typeof value)) throw new Error('단가를 입력하세요.');
  const raw = String(value).trim();
  const cost = Number(raw);
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || !Number.isFinite(cost) || cost <= 0 || cost > 9999999999.9999) {
    throw new Error('단가는 0보다 크고 9,999,999,999.9999원 이하, 소수점 4자리까지 입력하세요.');
  }
  return cost;
}

export function canEditManualCost(row = {}) {
  return Number(row?.DeductionKey) > 0 && Number(row?.CustKey) > 0 && Number(row?.ProdKey) > 0
    && Number(row.IsDeleted || 0) !== 1 && Number(row.EstimateKey || 0) === 0
    && !['REGISTERED', 'COMPLETED', 'MANUAL_COMPLETED'].includes(String(row.Status || '').toUpperCase())
    && Number(row.Quantity) > 0 && Number(row.RemainingQuantity ?? row.Quantity) > 0;
}

export function selectManualCostOverride({ row, targetYear, targetWeek, estimateUnit, events = [] } = {}) {
  for (const event of events) {
    let payload;
    try { payload = JSON.parse(event.AfterJson || '{}'); } catch { continue; }
    if (payload?.kind !== ACTION || Number(payload.deductionKey) !== Number(row.DeductionKey)
      || Number(payload.targetYear) !== Number(targetYear)
      || normalizeParentWeek(payload.targetWeek) !== normalizeParentWeek(targetWeek)) continue;
    // Never resurrect an earlier value after clearing or rematching this scope.
    if (Number(payload.custKey) !== Number(row.CustKey)
      || Number(payload.prodKey) !== Number(row.ProdKey)
      || payload.sourceUnit !== normalizeDefectUnit(row.SourceUnit)
      || !estimateUnit || payload.estimateUnit !== text(estimateUnit, 30)) return null;
    if (payload.cleared === true || payload.cost === null) return { cost: null, historyKey: Number(event.HistoryKey) };
    try { return { cost: validateManualCost(payload.cost), historyKey: Number(event.HistoryKey) }; }
    catch { return null; }
  }
  return null;
}

export async function getManualCostOverride({ row, targetYear, targetWeek, estimateUnit, q = query } = {}) {
  if (!row?.DeductionKey || !targetYear || !targetWeek) return null;
  const result = await q(
    `SELECT HistoryKey, AfterJson FROM WebSalesDefectDeductionHistory
      WHERE DeductionKey=@key AND ActionType=@action ORDER BY HistoryKey DESC`,
    { key: { type: sql.Int, value: Number(row.DeductionKey) }, action: { type: sql.NVarChar, value: ACTION } },
  );
  return selectManualCostOverride({ row, targetYear, targetWeek, estimateUnit, events: result.recordset || [] });
}

export function applyManualCostContext(context, override = null) {
  if (!context || !override || !(Number(override.cost) > 0)) return context;
  return { ...context, cost: Number(override.cost), costSource: 'Manual', costOrderWeek: '직접입력',
    costSourceYear: null, costSourceWeek: '직접입력', costShipmentKey: null, manualCost: Number(override.cost) };
}

export async function resolveManualCostContext({ row, targetYear, targetWeek, resolveContext, q = query } = {}) {
  const context = await resolveContext();
  const override = await getManualCostOverride({ row, targetYear, targetWeek, estimateUnit: context?.unit, q });
  return applyManualCostContext(context, override);
}

// Test dependency is not accepted or forwarded by the HTTP API.
export async function saveManualCost({ year, week, deductionKey, cost, expectedRowVersionNo, custKey, prodKey, user } = {}, transaction = withTransaction) {
  const y = normalizeYear(year); const w = normalizeParentWeek(week);
  if (!y || !w || !Number.isInteger(Number(deductionKey)) || Number(deductionKey) <= 0) throw new Error('연도·차수·차감 행을 확인하세요.');
  const nextCost = validateManualCost(cost);
  if (!Number.isInteger(Number(expectedRowVersionNo)) || Number(expectedRowVersionNo) <= 0) throw new Error('원장 버전 정보가 필요합니다. 새로고침 후 다시 저장하세요.');
  return transaction(async (q) => {
    const key = { type: sql.Int, value: Number(deductionKey) };
    const result = await q('SELECT * FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key', { key });
    const row = result.recordset[0];
    if (!canEditManualCost(row)) throw new Error('미등록·잔여수량이 있는 매칭 완료 행만 단가를 입력할 수 있습니다.');
    if (!isEarlierOrSameScope(row.OrderYear, row.OrderWeek, y, w)) throw new Error('원차수보다 이전 차수에는 단가를 저장할 수 없습니다.');
    if (Number(row.CustKey) !== Number(custKey) || Number(row.ProdKey) !== Number(prodKey)
      || Number(row.RowVersionNo) !== Number(expectedRowVersionNo)) throw new Error('원장이나 매칭이 변경되었습니다. 조회 후 다시 저장하세요.');
    const product = await q('SELECT TOP 1 EstUnit, OutUnit FROM Product WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0', { pk: { type: sql.Int, value: Number(row.ProdKey) } });
    const estimateUnit = text(product.recordset[0]?.EstUnit || product.recordset[0]?.OutUnit, 30);
    if (!estimateUnit) throw new Error('선택 품목의 전산 견적 단위를 확인할 수 없습니다.');
    const previous = await getManualCostOverride({ row, targetYear: y, targetWeek: w, estimateUnit, q });
    const payload = { kind: ACTION, deductionKey: Number(deductionKey), targetYear: y, targetWeek: w,
      custKey: Number(row.CustKey), prodKey: Number(row.ProdKey), sourceUnit: normalizeDefectUnit(row.SourceUnit),
      estimateUnit, cost: nextCost, cleared: nextCost === null };
    const by = { type: sql.NVarChar, value: text(user?.userId) };
    const name = { type: sql.NVarChar, value: text(user?.userName) };
    await q('UPDATE WebSalesDefectDeduction SET UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1 WHERE DeductionKey=@key', { key });
    // Preserve original/fallback ownership and confirmation. Actor is in History.
    await q(`INSERT INTO WebSalesDefectDeductionHistory
      (DeductionKey,ActionType,ChangedBy,ChangedByName,ChangeSummary,BeforeJson,AfterJson)
      VALUES (@key,@action,@by,@name,@summary,@before,@after)`, {
      key, by, name, action: { type: sql.NVarChar, value: ACTION },
      summary: { type: sql.NVarChar, value: `${y}년 ${w}차 불량차감 단가: ${nextCost === null ? '직접입력 해제' : `${nextCost}원/${estimateUnit}`}` },
      before: { type: sql.NVarChar, value: JSON.stringify(previous) },
      after: { type: sql.NVarChar, value: JSON.stringify(payload) },
    });
    return { deductionKey: Number(deductionKey), manualCost: nextCost, rowVersionNo: Number(row.RowVersionNo) + 1, targetYear: y, targetWeek: w };
  });
}

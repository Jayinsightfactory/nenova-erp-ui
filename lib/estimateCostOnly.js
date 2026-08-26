import { amountVatFromCostEst } from './distributeUnits.js';
import { WEEK_PROD_COST_YEAR_PROBE_SQL } from './weekProdCostSchema.js';

// Price-only writes do not share quantity/fix-cycle helpers. Evidence:
// docs/work-reports/2026-08-26_estimate-cost-no-stock-design.md.
function fail(code, message, status = 409, details = {}) {
  throw Object.assign(new Error(message), { code, status, ...details });
}

function positiveKey(value, field) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && !/^\d+$/.test(value.trim()))
    || !Number.isSafeInteger(Number(value)) || Number(value) <= 0 || Number(value) > 2147483647) {
    fail('INVALID_COST_ITEM', `${field}: 정확한 양의 정수 키가 필요합니다.`, 400);
  }
  return Number(value);
}

function price(value, field) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && value.trim() === '')
    || !Number.isFinite(Number(value)) || Number(value) < 0) {
    fail('INVALID_COST_ITEM', `${field}: 유한한 0 이상 단가가 필요합니다.`, 400);
  }
  return Number(value);
}

export function normalizeEstimateCostRequest(body = {}) {
  const { items: rawItems, mode, orderYear, custKey } = body;
  const requestedYear = String(orderYear ?? '').trim();
  if (!/^\d{4}$/.test(requestedYear)) fail('ORDER_YEAR_REQUIRED', '단가 저장 요청에 화면의 선택 연도(4자리)가 필요합니다.', 400);
  if (!Array.isArray(rawItems) || !rawItems.length) fail('INVALID_COST_ITEM', 'items 배열 필요', 400);
  if (!['once', 'fixed', 'weekFav'].includes(mode)) fail('INVALID_COST_MODE', "mode 는 'once' | 'fixed' | 'weekFav'", 400);
  if (!custKey || !Number.isInteger(Number(custKey)) || Number(custKey) <= 0) {
    fail('CUST_KEY_REQUIRED', '단가 저장 요청에 화면의 선택 거래처가 필요합니다.', 400);
  }
  const ck = positiveKey(custKey, 'custKey');
  const topSk = body.shipmentKey == null ? null : positiveKey(body.shipmentKey, 'shipmentKey');
  let week = body.week == null || body.week === '' ? null : String(body.week).trim();
  if (week?.startsWith(`${requestedYear}-`)) week = week.slice(5);
  if ((week != null && !/^\d{2}-\d{2}$/.test(week)) || (mode === 'weekFav' && !week)) {
    fail('INVALID_COST_WEEK', '선택 연도의 차수(NN-NN)가 필요합니다.', 400);
  }
  const items = rawItems.map((it) => {
    if (!it || typeof it !== 'object' || Array.isArray(it)
      || (it.sdetailKey != null) === (it.estimateKey != null)) {
      fail('INVALID_COST_ITEM', 'sdetailKey 또는 estimateKey 중 정확히 하나가 필요합니다.', 400);
    }
    const sdetailKey = it.sdetailKey == null ? null : positiveKey(it.sdetailKey, 'sdetailKey');
    const estimateKey = it.estimateKey == null ? null : positiveKey(it.estimateKey, 'estimateKey');
    const shipmentKey = it.shipmentKey == null ? topSk : positiveKey(it.shipmentKey, 'shipmentKey');
    const sdateKey = it.sdateKey == null ? null : positiveKey(it.sdateKey, 'sdateKey');
    if ((!shipmentKey && !estimateKey) || (sdateKey != null && !sdetailKey)) {
      fail('INVALID_COST_ITEM', '출고 상세는 shipmentKey, 출고일은 sdetailKey 소속이 필요합니다.', 400);
    }
    if (sdateKey != null && it.expectedOldCost == null) fail('INVALID_COST_ITEM', '출고일 단가 저장에는 DateCost 기준값이 필요합니다.', 400);
    return {
      shipmentKey, sdetailKey, estimateKey, sdateKey,
      cost: price(it.cost, 'cost'),
      expectedOldCost: it.expectedOldCost == null ? null : price(it.expectedOldCost, 'expectedOldCost'),
    };
  });
  return { requestedYear, custKey: ck, mode, week, items };
}

// 2026-08-26 live sys.columns precheck: ShipmentDtm exists on Detail/Date,
// NOT ShipmentMaster (the older DB_STRUCTURE.md description is stale).
const MASTER_SELECT = `SELECT ShipmentKey, OrderYear, CustKey, OrderWeek, OrderYearWeek,
  isFix, isDeleted, EstimateName, LastUpdateID, LastUpdateDtm
  FROM ShipmentMaster WITH (UPDLOCK, HOLDLOCK) WHERE ShipmentKey=@sk AND ISNULL(isDeleted,0)=0`;
const DETAIL_SELECT = `SELECT SdetailKey, ShipmentKey, CustKey, ProdKey,
  OutQuantity, BoxQuantity, BunchQuantity, SteamQuantity, EstQuantity, EstQuantity2,
  ShipmentDtm, isFix, Descr, EstDescr, Cost, Amount, Vat
  FROM ShipmentDetail WITH (UPDLOCK, HOLDLOCK) WHERE SdetailKey=@sdk AND ShipmentKey=@sk`;
const DATE_SELECT = `SELECT SdateKey, SdetailKey, ShipmentDtm, ShipmentQuantity, EstQuantity, Descr, Cost, Amount, Vat
  FROM ShipmentDate WITH (UPDLOCK, HOLDLOCK) WHERE SdetailKey=@sdk ORDER BY SdateKey`;
// The existing Estimate trigger can sanitize legacy Descr. Do not verify that field.
const ESTIMATE_SELECT = `SELECT EstimateKey, ShipmentKey, ProdKey, Quantity, Unit, EstimateType, EstimateDtm, Cost, Amount, Vat
  FROM Estimate WITH (UPDLOCK, HOLDLOCK) WHERE EstimateKey=@ek AND ShipmentKey=@sk`;
const CUSTOMER_SELECT = `SELECT AutoKey, CustKey, ProdKey, Cost, Descr
  FROM CustomerProdCost WITH (UPDLOCK, HOLDLOCK) WHERE CustKey=@ck AND ProdKey=@pk`;
const WEEK_SELECT = `SELECT AutoKey, OrderYear, OrderWeek, CustKey, ProdKey, Cost
  FROM WeekProdCost WITH (UPDLOCK, HOLDLOCK)
  WHERE OrderYear=@yr AND OrderWeek=@wk AND CustKey=@ck AND ProdKey=@pk`;

function one(result, label) {
  if (result.recordset?.length !== 1) fail('ESTIMATE_SCOPE_MISMATCH', `${label}: 대상 행이 없거나 중복되었습니다.`);
  return result.recordset[0];
}

function money(cost, quantity) {
  if (!Number.isFinite(Number(quantity ?? 0))) fail('INVALID_STORED_QUANTITY', '저장된 견적 수량이 유효하지 않습니다.');
  const { amount, vat } = amountVatFromCostEst(cost, Number(quantity ?? 0));
  if (!Number.isFinite(amount) || !Number.isFinite(vat)) fail('INVALID_COST_AMOUNT', '계산 금액이 유효 범위를 벗어났습니다.', 400);
  return { Cost: cost, Amount: amount, Vat: vat };
}

function stale(item, rawCost) {
  const actual = Number(rawCost ?? 0);
  if (item.expectedOldCost != null && actual !== item.expectedOldCost) {
    fail('STALE_DATA', '단가가 조회 이후 변경되었습니다. 입력값을 보관하고 다시 조회해 주세요.', 409, {
      sdetailKey: item.sdetailKey, estimateKey: item.estimateKey, sdateKey: item.sdateKey,
      shipmentKey: item.shipmentKey, expected: item.expectedOldCost, actual,
    });
  }
}

function equalRaw(a, b) {
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  return a === b; // null, 0 and false are not interchangeable snapshots.
}

function verify(before, after, expectedMoney = {}, label = '') {
  if (!after || Object.keys(before).some((key) => !equalRaw(
    Object.prototype.hasOwnProperty.call(expectedMoney, key) ? expectedMoney[key] : before[key], after[key],
  ))) fail('COST_READBACK_MISMATCH', `${label}: 저장 후 금액 또는 보존값이 일치하지 않습니다.`);
}

/** Runs ONLY inside the caller's transaction. Hooks retain the broad parent-week edit lease. */
export async function executeEstimateCostOnly(tQ, body, { sql, user, assertEditGuard, advanceEditGuard }) {
  const { requestedYear, custKey, mode, week, items } = normalizeEstimateCostRequest(body);
  const int = (value) => ({ type: sql.Int, value });
  const float = (value) => ({ type: sql.Float, value });
  const string = (value) => ({ type: sql.NVarChar, value });
  // Resolve legacy missing ShipmentKey inside this transaction. The subsequent
  // locked Estimate read revalidates its parent before any write.
  for (const item of items) {
    if (item.shipmentKey == null) {
      const row = one(await tQ('SELECT ShipmentKey FROM Estimate WHERE EstimateKey=@ek', { ek: int(item.estimateKey) }), 'Estimate');
      item.shipmentKey = positiveKey(row.ShipmentKey, 'Estimate.ShipmentKey');
    }
  }
  const shipmentKeys = [...new Set(items.map((item) => item.shipmentKey))].sort((a, b) => a - b);
  const masters = new Map();
  for (const sk of shipmentKeys) {
    const row = one(await tQ(MASTER_SELECT, { sk: int(sk) }), `ShipmentKey=${sk}`);
    if (String(row.OrderYear || '') !== requestedYear) {
      fail('ESTIMATE_SCOPE_MISMATCH', '선택 연도와 실제 출고 연도가 다릅니다.', 409, { shipmentKey: sk });
    }
    if (Number(row.CustKey) !== Number(custKey)) {
      fail('ESTIMATE_SCOPE_MISMATCH', '선택 거래처와 실제 출고 거래처가 다릅니다.', 409, { shipmentKey: sk });
    }
    if (!/^\d{2}-\d{2}$/.test(String(row.OrderWeek ?? ''))) fail('ESTIMATE_SCOPE_MISMATCH', '출고 차수가 유효하지 않습니다.');
    masters.set(sk, row);
  }
  const parents = new Set([...masters.values()].map((row) => row.OrderWeek.split('-')[0]));
  if (parents.size !== 1 || (week && !parents.has(week.split('-')[0]))) {
    fail('ESTIMATE_SCOPE_MISMATCH', '한 번의 단가 저장은 선택한 하나의 부모차수만 수정할 수 있습니다.');
  }
  const scope = { orderYear: requestedYear, orderWeek: masters.get(shipmentKeys[0]).OrderWeek, custKey };
  await assertEditGuard(tQ, scope, user, body);
  if (mode === 'weekFav') {
    const probe = await tQ(WEEK_PROD_COST_YEAR_PROBE_SQL, {});
    if (Number(probe.recordset?.[0]?.ok) !== 1) fail('WEEK_PROD_COST_SCHEMA_REQUIRED', '차수별 단가 테이블의 연도 분리 마이그레이션이 필요합니다.', 503);
  }

  // Merge writes, NOT baselines: every submitted date/legacy snapshot is checked.
  const groups = new Map();
  for (const item of items) {
    const key = item.estimateKey ? `e:${item.estimateKey}` : `s:${item.sdetailKey}`;
    const existing = groups.get(key);
    if (existing && (existing.item.cost !== item.cost || existing.item.shipmentKey !== item.shipmentKey)) {
      fail('CONFLICTING_COST', '같은 상세에 서로 다른 단가 또는 출고 소속이 요청되었습니다.');
    }
    if (existing) existing.baselines.push(item);
    else groups.set(key, { item, baselines: [item] });
  }
  const plans = [...groups.values()].sort((a, b) => a.item.shipmentKey - b.item.shipmentKey
    || Number(!!a.item.estimateKey) - Number(!!b.item.estimateKey)
    || (a.item.estimateKey ?? a.item.sdetailKey) - (b.item.estimateKey ?? b.item.sdetailKey));
  for (const plan of plans) {
    const { item } = plan;
    plan.params = { sk: int(item.shipmentKey), ...(item.estimateKey ? { ek: int(item.estimateKey) } : { sdk: int(item.sdetailKey) }) };
    plan.select = item.estimateKey ? ESTIMATE_SELECT : DETAIL_SELECT;
    plan.before = one(await tQ(plan.select, plan.params), item.estimateKey ? 'Estimate' : 'ShipmentDetail');
    plan.dates = item.estimateKey ? [] : (await tQ(DATE_SELECT, { sdk: int(item.sdetailKey) })).recordset;
    const datesByKey = new Map(plan.dates.map((row) => [Number(row.SdateKey), row]));
    if (datesByKey.size !== plan.dates.length) fail('ESTIMATE_SCOPE_MISMATCH', '출고일 키가 중복되었습니다.');
    for (const baseline of plan.baselines) {
      if (baseline.sdateKey != null) {
        const date = datesByKey.get(baseline.sdateKey);
        if (!date) fail('STALE_DATA', '출고일이 삭제되었거나 해당 출고 상세에 속하지 않습니다.', 409, {
          sdetailKey: item.sdetailKey, sdateKey: baseline.sdateKey, shipmentKey: item.shipmentKey,
        });
        stale(baseline, date.Cost);
      } else stale(baseline, plan.before.Cost);
    }
    plan.money = money(item.cost, item.estimateKey ? plan.before.Quantity : plan.before.EstQuantity);
    plan.dateMoney = new Map(plan.dates.map((date) => [date.SdateKey, money(item.cost, date.EstQuantity)]));
  }

  const extras = new Map();
  if (mode !== 'once') {
    for (const plan of plans.filter((entry) => !entry.item.estimateKey)) {
      const pk = positiveKey(plan.before.ProdKey, 'ProdKey');
      if (extras.has(pk) && extras.get(pk).cost !== plan.item.cost) {
        fail('CONFLICTING_PRODUCT_COST', '같은 품목의 지정/차수 단가가 서로 다릅니다. 단가를 통일하거나 일회성으로 저장해 주세요.');
      }
      extras.set(pk, { cost: plan.item.cost });
    }
  }
  // No unique CustomerProdCost pair index: lock both existing rows and absent
  // key ranges until commit. Without an index this can take broader locks.
  for (const pk of [...extras.keys()].sort((a, b) => a - b)) {
    const extra = extras.get(pk);
    extra.params = { ck: int(custKey), pk: int(pk), ...(mode === 'weekFav' ? { yr: string(requestedYear), wk: string(week) } : {}) };
    extra.select = mode === 'fixed' ? CUSTOMER_SELECT : WEEK_SELECT;
    const rows = (await tQ(extra.select, extra.params)).recordset;
    if (rows.length > 1) fail(mode === 'fixed' ? 'CUSTOMER_COST_DUPLICATE' : 'WEEK_COST_DUPLICATE', '기존 품목 단가가 중복되어 전체 저장을 중단했습니다.');
    extra.before = rows[0] ?? null;
  }

  const moneyParams = (values) => ({ cost: float(values.Cost), amount: float(values.Amount), vat: float(values.Vat) });
  for (const plan of plans) {
    const { item } = plan;
    await tQ(item.estimateKey
      ? 'UPDATE Estimate SET Cost=@cost, Amount=@amount, Vat=@vat WHERE EstimateKey=@ek AND ShipmentKey=@sk'
      : 'UPDATE ShipmentDetail SET Cost=@cost, Amount=@amount, Vat=@vat WHERE SdetailKey=@sdk AND ShipmentKey=@sk',
    { ...plan.params, ...moneyParams(plan.money) });
    for (const date of plan.dates) {
      await tQ('UPDATE ShipmentDate SET Cost=@cost, Amount=@amount, Vat=@vat WHERE SdateKey=@dk AND SdetailKey=@sdk', {
        dk: int(date.SdateKey), sdk: int(item.sdetailKey), ...moneyParams(plan.dateMoney.get(date.SdateKey)),
      });
    }
  }
  for (const extra of extras.values()) {
    const params = { ...extra.params, cost: float(extra.cost) };
    if (mode === 'fixed') {
      await tQ(extra.before
        ? 'UPDATE CustomerProdCost SET Cost=@cost WHERE AutoKey=@ak AND CustKey=@ck AND ProdKey=@pk'
        : 'INSERT INTO CustomerProdCost (CustKey, ProdKey, Cost) VALUES (@ck, @pk, @cost)',
      { ...params, ...(extra.before ? { ak: int(extra.before.AutoKey) } : {}) });
    } else {
      await tQ(`MERGE INTO WeekProdCost WITH (HOLDLOCK) AS t
        USING (VALUES (@yr, @wk, @ck, @pk, @cost)) AS s(OrderYear, OrderWeek, CustKey, ProdKey, Cost)
        ON t.OrderYear=s.OrderYear AND t.OrderWeek=s.OrderWeek AND t.CustKey=s.CustKey AND t.ProdKey=s.ProdKey
        WHEN MATCHED THEN UPDATE SET Cost=s.Cost, UpdatedAt=GETDATE(), UpdatedBy=@uid
        WHEN NOT MATCHED THEN INSERT (OrderYear, OrderWeek, CustKey, ProdKey, Cost, UpdatedBy)
          VALUES (s.OrderYear, s.OrderWeek, s.CustKey, s.ProdKey, s.Cost, @uid);`,
      { ...params, uid: string(user?.userId || 'system') });
    }
  }

  // Verify raw nulls/flags/quantities/dates and expected money, not normalized
  // snapshots. Re-read complete date sets to detect missing/extra rows too.
  for (const [sk, before] of masters) verify(before, one(await tQ(MASTER_SELECT, { sk: int(sk) }), 'ShipmentMaster'), {}, 'ShipmentMaster');
  for (const plan of plans) {
    verify(plan.before, one(await tQ(plan.select, plan.params), '상세'), plan.money, '상세');
    if (!plan.item.estimateKey) {
      const rows = (await tQ(DATE_SELECT, { sdk: int(plan.item.sdetailKey) })).recordset;
      const after = new Map(rows.map((row) => [row.SdateKey, row]));
      if (rows.length !== plan.dates.length || after.size !== rows.length) fail('COST_READBACK_MISMATCH', '저장 후 출고일 행수가 다릅니다.');
      for (const date of plan.dates) verify(date, after.get(date.SdateKey), plan.dateMoney.get(date.SdateKey), 'ShipmentDate');
    }
  }
  for (const extra of extras.values()) {
    const after = one(await tQ(extra.select, extra.params), '품목 단가');
    if (extra.before) verify(extra.before, after, { Cost: extra.cost }, '품목 단가');
    else if (Number(after.CustKey) !== custKey || Number(after.ProdKey) !== extra.params.pk.value
      || after.Cost !== extra.cost || !Number.isInteger(after.AutoKey) || after.AutoKey <= 0
      || (mode === 'weekFav' && (after.OrderYear !== requestedYear || after.OrderWeek !== week))) {
      fail('COST_READBACK_MISMATCH', '신규 품목 단가 저장 결과가 일치하지 않습니다.');
    }
  }
  const changes = plans.map(({ item, before, money: expected }) => ({
    ...(item.estimateKey ? { source: 'Estimate', estimateKey: item.estimateKey, bunchQty: before.Quantity }
      : { sdetailKey: item.sdetailKey, estQty: before.EstQuantity }),
    shipmentKey: item.shipmentKey, orderWeek: masters.get(item.shipmentKey).OrderWeek, prodKey: before.ProdKey,
    oldCost: Number(before.Cost ?? 0), newCost: expected.Cost,
    oldAmount: Number(before.Amount ?? 0), newAmount: expected.Amount,
    oldVat: Number(before.Vat ?? 0), newVat: expected.Vat,
  }));
  const total = (key) => changes.reduce((sum, change) => sum + change[key], 0);
  const totalOldAmount = total('oldAmount');
  const totalNewAmount = total('newAmount');
  const totalOldVat = total('oldVat');
  const totalNewVat = total('newVat');
  const guardAfter = await advanceEditGuard(tQ, scope, user, body);
  return {
    shipmentKeys, fixedShipmentKeys: shipmentKeys.filter((sk) => [true, 1].includes(masters.get(sk).isFix)),
    changedCount: changes.length, changes,
    customerCostUpdated: mode === 'fixed' ? extras.size : 0,
    customerCostSkippedEstimate: mode === 'fixed' ? plans.filter((plan) => plan.item.estimateKey).length : 0,
    totalOldAmount, totalNewAmount, diffAmount: totalNewAmount - totalOldAmount,
    totalOldVat, totalNewVat, diffVat: totalNewVat - totalOldVat,
    editDigestAfter: guardAfter.editDigestAfter, revision: guardAfter.revision,
  };
}

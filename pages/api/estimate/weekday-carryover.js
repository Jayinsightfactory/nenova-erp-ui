import { query, sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import carryoverStore from '../../../lib/weekdayCarryoverStore.js';
import baselineStore from '../../../lib/weekdayInitialBaselineStore.js';
import { buildShippingCycles, dateKey, shiftDate } from '../../../lib/weekdayEstimateCycle.js';
import { normalizeWeekdayUnit } from '../../../lib/weekdayEstimateCompare.js';
import { WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL } from '../../../lib/weekdayCustomerLink.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
export const MAX_CONTEXT_WEEKS = 104;

const CUSTOMER_SQL = `SELECT CustKey FROM Customer WHERE CustKey=@custKey AND ISNULL(isDeleted,0)=0`;
const PRODUCT_SCOPE_SQL = `SELECT p.ProdKey,p.ProdName,p.FlowerName,p.OutUnit,
  CASE WHEN EXISTS (
    SELECT 1 FROM ShipmentMaster sm
    JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND ${WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL}
    WHERE sm.OrderYear=@year AND LEFT(sm.OrderWeek,2)=@majorWeek AND sm.CustKey=@custKey
      AND sd.ProdKey=@prodKey AND ISNULL(sm.isDeleted,0)=0
  ) OR EXISTS (
    SELECT 1 FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
    WHERE om.OrderYear=@year AND LEFT(om.OrderWeek,2)=@majorWeek AND om.CustKey=@custKey
      AND od.ProdKey=@prodKey AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
  ) THEN 1 ELSE 0 END AS InScope
  FROM Product p WHERE p.ProdKey=@prodKey AND ISNULL(p.isDeleted,0)=0`;
const PRODUCTS_SQL = `SELECT p.ProdKey,p.ProdName,p.FlowerName,p.OutUnit FROM Product p
  JOIN OPENJSON(@prodKeys) WITH (ProdKey int '$') k ON k.ProdKey=p.ProdKey
  WHERE ISNULL(p.isDeleted,0)=0 ORDER BY p.ProdKey`;
const VISIBLE_PERIOD_SQL = `WITH anchor AS (
  SELECT BaseYmd FROM PeriodDay WHERE OrderYearWeek=@yearWeek AND WeekDay=5
) SELECT pd.OrderYearWeek,pd.WeekDay,CONVERT(nvarchar(23),pd.BaseYmd,121) AS BaseYmd
  FROM PeriodDay pd WHERE EXISTS (
    SELECT 1 FROM anchor a WHERE pd.BaseYmd>=DATEADD(day,-7,a.BaseYmd)
      AND pd.BaseYmd<DATEADD(day,14,a.BaseYmd)
  ) ORDER BY pd.BaseYmd`;
const RANGE_PERIOD_SQL = `SELECT pd.OrderYearWeek,pd.WeekDay,
  CONVERT(nvarchar(23),pd.BaseYmd,121) AS BaseYmd FROM PeriodDay pd
  WHERE pd.BaseYmd>=CONVERT(date,@firstDate,23) AND pd.BaseYmd<CONVERT(date,@afterLastDate,23)
  ORDER BY pd.BaseYmd`;

// One SELECT statement for every requested real calendar scope, not one query per product/week.
// Orders supply eligibility only: joining them into shipment totals would multiply quantities.
const CONTEXT_SQL = `WITH cycles AS (
  SELECT [year],majorWeek FROM OPENJSON(@cycles)
    WITH ([year] int '$.year',majorWeek nvarchar(2) '$.majorWeek')
), inventory AS (
  SELECT c.[year],c.majorWeek,om.OrderWeek,od.ProdKey FROM cycles c
  JOIN OrderMaster om WITH (HOLDLOCK) ON om.OrderYear=c.[year] AND LEFT(om.OrderWeek,2)=c.majorWeek
  JOIN OrderDetail od WITH (HOLDLOCK) ON od.OrderMasterKey=om.OrderMasterKey
  JOIN Product p WITH (HOLDLOCK) ON p.ProdKey=od.ProdKey AND ISNULL(p.isDeleted,0)=0
  WHERE om.CustKey=@custKey AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
  UNION
  SELECT c.[year],c.majorWeek,sm.OrderWeek,sd.ProdKey FROM cycles c
  JOIN ShipmentMaster sm WITH (HOLDLOCK) ON sm.OrderYear=c.[year] AND LEFT(sm.OrderWeek,2)=c.majorWeek
  JOIN ShipmentDetail sd WITH (HOLDLOCK) ON sd.ShipmentKey=sm.ShipmentKey
  JOIN Product p WITH (HOLDLOCK) ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
  WHERE sm.CustKey=@custKey AND ISNULL(sm.isDeleted,0)=0
), shipment AS (
  SELECT c.[year],c.majorWeek,sm.OrderWeek,sd.ProdKey,SUM(sd.OutQuantity) AS Quantity,
    COUNT_BIG(*) AS DetailRows,
    SUM(CASE WHEN sd.OutQuantity IS NULL OR sd.OutQuantity<0 OR NOT ${WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL} THEN 1 ELSE 0 END) AS InvalidQuantityRows
  FROM cycles c
  JOIN ShipmentMaster sm WITH (HOLDLOCK) ON sm.OrderYear=c.[year] AND LEFT(sm.OrderWeek,2)=c.majorWeek
  JOIN ShipmentDetail sd WITH (HOLDLOCK) ON sd.ShipmentKey=sm.ShipmentKey
  JOIN Product p WITH (HOLDLOCK) ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
  WHERE sm.CustKey=@custKey AND ISNULL(sm.isDeleted,0)=0
  GROUP BY c.[year],c.majorWeek,sm.OrderWeek,sd.ProdKey
), allocations AS (
  SELECT c.[year],c.majorWeek,sm.OrderWeek,sd.ProdKey,
    CONVERT(nvarchar(10),sdd.ShipmentDtm,120) AS [date],SUM(sdd.ShipmentQuantity) AS quantity,
    SUM(CASE WHEN sdd.ShipmentDtm IS NULL OR sdd.ShipmentQuantity IS NULL
      OR sdd.ShipmentQuantity<0 OR NOT ${WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL} THEN 1 ELSE 0 END) AS invalidRows
  FROM cycles c
  JOIN ShipmentMaster sm WITH (HOLDLOCK) ON sm.OrderYear=c.[year] AND LEFT(sm.OrderWeek,2)=c.majorWeek
  JOIN ShipmentDetail sd WITH (HOLDLOCK) ON sd.ShipmentKey=sm.ShipmentKey
  JOIN Product p WITH (HOLDLOCK) ON p.ProdKey=sd.ProdKey AND ISNULL(p.isDeleted,0)=0
  JOIN ShipmentDate sdd WITH (HOLDLOCK) ON sdd.SdetailKey=sd.SdetailKey
  WHERE sm.CustKey=@custKey AND ISNULL(sm.isDeleted,0)=0
  GROUP BY c.[year],c.majorWeek,sm.OrderWeek,sd.ProdKey,CONVERT(nvarchar(10),sdd.ShipmentDtm,120)
)
SELECT c.[year] AS OrderYear,c.majorWeek,i.OrderWeek,cu.CustKey,
  p.ProdKey,p.ProdName,p.FlowerName,p.OutUnit,
  CASE WHEN s.ProdKey IS NULL THEN 0 ELSE s.Quantity END AS Quantity,
  CASE WHEN s.ProdKey IS NULL THEN 0 ELSE s.DetailRows END AS DetailRows,
  CASE WHEN s.ProdKey IS NULL THEN 0 ELSE s.InvalidQuantityRows END AS InvalidQuantityRows,
  CAST(ISNULL((SELECT a.[date],a.OrderWeek AS orderWeek,a.quantity,a.invalidRows
    FROM allocations a WHERE a.[year]=c.[year] AND a.majorWeek=c.majorWeek
      AND a.OrderWeek=i.OrderWeek AND a.ProdKey=p.ProdKey
    ORDER BY a.[date] FOR JSON PATH,INCLUDE_NULL_VALUES),N'[]') AS nvarchar(max)) AS ShipmentDates
FROM cycles c CROSS JOIN Customer cu WITH (HOLDLOCK)
LEFT JOIN inventory i ON i.[year]=c.[year] AND i.majorWeek=c.majorWeek
LEFT JOIN Product p WITH (HOLDLOCK) ON p.ProdKey=i.ProdKey AND ISNULL(p.isDeleted,0)=0
LEFT JOIN shipment s ON s.[year]=i.[year] AND s.OrderWeek=i.OrderWeek AND s.ProdKey=i.ProdKey
WHERE cu.CustKey=@custKey AND ISNULL(cu.isDeleted,0)=0
ORDER BY c.[year],c.majorWeek,i.OrderWeek,p.ProdKey`;

const scopeKey = cycle => `${cycle.year}|${cycle.majorWeek}`;
const finite = value => (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)))
  && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= Number.MAX_SAFE_INTEGER ? Number(value) : null;
const nonnegative = value => { const n = finite(value); return n !== null && n >= 0 ? n : null; };

export function createWeekdayCarryoverHandler({ queryFn = query, types = sql, store = carryoverStore,
  baselines = baselineStore, buildCycles = buildShippingCycles } = {}) {
  const { WeekdayCarryoverError, normalizeCarryoverScope, normalizeCarryoverInput,
    validateCarryoverRecord, validateUserId } = carryoverStore;
  const fail = (code, message, status = 409) => { throw new WeekdayCarryoverError(code, message, status); };
  const params = scope => ({ year: { type: types.Int, value: scope.year },
    majorWeek: { type: types.NVarChar(2), value: scope.majorWeek },
    custKey: { type: types.Int, value: scope.custKey },
    ...(scope.prodKey === undefined ? {} : { prodKey: { type: types.Int, value: scope.prodKey } }) });

  function validateCycle(cycle, rows) {
    if (!cycle || !Number.isInteger(cycle.year) || cycle.year < 2000 || cycle.year > 2200
      || !/^\d{2}$/.test(cycle.majorWeek) || cycle.calendarState !== 'FOUND' || cycle.days?.length !== 7
      || cycle.endDate !== shiftDate(cycle.startDate, 6)) fail('INVALID_CALENDAR', '실제 7일 업무 달력이 필요합니다.');
    carryoverStore.validateStartDate(cycle.startDate);
    cycle.days.forEach((day, index) => {
      const expected = shiftDate(cycle.startDate, index);
      const matches = rows.filter(row => dateKey(row.BaseYmd) === expected);
      if (day.date !== expected || day.calendarState !== 'FOUND' || matches.length !== 1
        || Number(matches[0].WeekDay) !== day.code
        || new Date(`${expected}T00:00:00Z`).getUTCDay() + 1 !== day.code
        || !/^\d{6}$/.test(String(matches[0].OrderYearWeek))
        || Number(String(matches[0].OrderYearWeek).slice(0, 4)) < 2000
        || Number(String(matches[0].OrderYearWeek).slice(0, 4)) > 2200
        || Number(String(matches[0].OrderYearWeek).slice(4)) < 1
        || Number(String(matches[0].OrderYearWeek).slice(4)) > 53) {
        fail('INVALID_CALENDAR', '달력 날짜·요일이 누락되거나 중복·불일치합니다.');
      }
    });
    return { year: cycle.year, majorWeek: cycle.majorWeek, startDate: cycle.startDate,
      endDate: cycle.endDate, calendarState: cycle.calendarState, days: cycle.days };
  }

  function calendarRows(result) {
    if (!Array.isArray(result?.recordset)) fail('INVALID_CALENDAR', '달력 조회 형식이 올바르지 않습니다.');
    for (const row of result.recordset) {
      if (typeof row.BaseYmd !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d{3})?)?$/.test(row.BaseYmd)
        || !Number.isFinite(Date.parse(row.BaseYmd.replace(' ', 'T') + (row.BaseYmd.length === 10 ? 'T00:00:00Z' : 'Z')))) {
        fail('INVALID_CALENDAR', '실제 달력 timestamp가 필요합니다.');
      }
      try { dateKey(row.BaseYmd); } catch { fail('INVALID_CALENDAR', '실제 달력 날짜가 필요합니다.'); }
    }
    return result.recordset;
  }

  async function visibleCycles(scope, selectedOnly = false) {
    const rows = calendarRows(await queryFn(VISIBLE_PERIOD_SQL, {
      yearWeek: { type: types.NVarChar(6), value: `${scope.year}${scope.majorWeek}` },
    }));
    let cycles;
    try { cycles = buildCycles(rows, { ...scope, orderYearWeek: `${scope.year}${scope.majorWeek}` }); }
    catch { fail('INVALID_CALENDAR', '선택 차수 목요일 anchor가 없거나 중복입니다.'); }
    const selected = cycles.find(cycle => cycle.offset === 0);
    if (selected?.year !== scope.year || selected?.majorWeek !== scope.majorWeek) fail('INVALID_CALENDAR', '선택 차수 달력 식별자가 다릅니다.');
    return (selectedOnly ? [selected] : cycles).map(cycle => validateCycle(cycle, rows));
  }

  async function productsFor(keys) {
    const unique = [...new Set(keys)].sort((a, b) => a - b);
    if (!unique.length) return new Map();
    const result = await queryFn(PRODUCTS_SQL, { prodKeys: { type: types.NVarChar(types.MAX), value: JSON.stringify(unique) } });
    if (!Array.isArray(result?.recordset)) fail('INVALID_PRODUCT_CONTEXT', '활성 품목 조회 형식이 올바르지 않습니다.');
    const found = new Map();
    for (const row of result.recordset) {
      const key = nonnegative(row.ProdKey);
      if (!Number.isInteger(key) || !unique.includes(key) || found.has(key)) fail('INVALID_PRODUCT_CONTEXT', '활성 품목 조회 범위가 다릅니다.');
      found.set(key, row);
    }
    return found;
  }

  async function baselineFor(cycle, custKey, suffix) {
    const scope = { year: cycle.year, orderWeek: `${cycle.majorWeek}-${suffix}`, custKey };
    const snapshot = await baselines.get(scope);
    if (snapshot === null) return null;
    if (!snapshot || snapshot.year !== scope.year || snapshot.orderWeek !== scope.orderWeek
      || snapshot.custKey !== custKey || !Array.isArray(snapshot.rows)) fail('BASELINE_SCOPE_MISMATCH', '최초 기준의 범위가 다릅니다.');
    // The injected adapter must honor the same validated immutable baseline contract.
    const rows = baselineStore.canonicalRows(snapshot.rows);
    return { ...snapshot, rows };
  }

  async function contextFor(scope) {
    const visible = await visibleCycles(scope);
    const firstVisible = visible[0].startDate;
    const lastVisible = visible[2].startDate;
    const saved = await store.listCustomer(scope.custKey);
    if (!Array.isArray(saved)) fail('CARRYOVER_STORAGE_CORRUPT', '마감 기록 조회 형식이 올바르지 않습니다.', 500);
    const customerRecords = saved.map(validateCarryoverRecord);
    if (customerRecords.some(record => record.custKey !== scope.custKey)) fail('CARRYOVER_SCOPE_MISMATCH', '다른 거래처의 마감 기록입니다.', 500);
    const candidates = customerRecords.filter(record => record.startDate <= lastVisible);
    const recordProducts = await productsFor(candidates.map(record => record.prodKey));
    const activeRecords = candidates.filter(record => recordProducts.has(record.prodKey));
    const latest = new Map();
    for (const record of activeRecords.filter(record => record.startDate <= firstVisible)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))) {
      const prior = latest.get(record.prodKey);
      if (prior?.startDate === record.startDate) fail('CARRYOVER_CALENDAR_MISMATCH', '동일 품목의 마감 anchor가 중복입니다.');
      latest.set(record.prodKey, record);
    }
    const firstDate = [...latest.values()].reduce((date, record) => record.startDate < date ? record.startDate : date, firstVisible);
    const span = (Date.parse(`${lastVisible}T00:00:00Z`) - Date.parse(`${firstDate}T00:00:00Z`)) / (7 * 86400000) + 1;
    if (!Number.isInteger(span)) fail('INVALID_CALENDAR', '마감 anchor와 보이는 달력이 7일 간격이 아닙니다.');
    if (span > MAX_CONTEXT_WEEKS) fail('CARRYOVER_CONTEXT_LIMIT', '이월 원천부터 조회 범위가 104주를 넘습니다. 일부 차수만 계산하지 않습니다.');
    let cycles = visible;
    if (firstDate < firstVisible) {
      const rows = calendarRows(await queryFn(RANGE_PERIOD_SQL, {
        firstDate: { type: types.NVarChar(10), value: firstDate },
        afterLastDate: { type: types.NVarChar(10), value: shiftDate(lastVisible, 7) },
      }));
      cycles = [];
      const identities = new Set();
      for (let index = 0; index < span; index++) {
        const startDate = shiftDate(firstDate, index * 7);
        const anchors = rows.filter(row => dateKey(row.BaseYmd) === startDate && Number(row.WeekDay) === 5);
        if (anchors.length !== 1 || !/^\d{6}$/.test(String(anchors[0].OrderYearWeek))) fail('INVALID_CALENDAR', '이월 경로의 목요일 anchor가 없거나 중복입니다.');
        const key = String(anchors[0].OrderYearWeek);
        const identity = { year: Number(key.slice(0, 4)), majorWeek: key.slice(4), orderYearWeek: key };
        let cycle;
        try { cycle = buildCycles(rows, identity).find(item => item.offset === 0); }
        catch { fail('INVALID_CALENDAR', '이월 경로의 달력 식별자가 중복입니다.'); }
        if (identities.has(key)) fail('INVALID_CALENDAR', '이월 경로의 차수 식별자가 중복입니다.');
        identities.add(key);
        cycles.push(validateCycle(cycle, rows));
      }
      if (visible.some(item => !cycles.some(cycle => scopeKey(cycle) === scopeKey(item) && cycle.startDate === item.startDate))) {
        fail('INVALID_CALENDAR', '이월 조회 도중 보이는 달력이 변경되었습니다.');
      }
    }
    const records = activeRecords.filter(record => record.startDate >= firstDate);
    if (records.some(record => !cycles.some(cycle => scopeKey(cycle) === scopeKey(record) && cycle.startDate === record.startDate))) {
      fail('CARRYOVER_CALENDAR_MISMATCH', '마감 기록과 서버 달력 anchor가 다릅니다.');
    }
    const source = await queryFn(CONTEXT_SQL, {
      cycles: { type: types.NVarChar(types.MAX), value: JSON.stringify(cycles.map(({ year, majorWeek }) => ({ year, majorWeek }))) },
      custKey: { type: types.Int, value: scope.custKey },
    });
    if (!Array.isArray(source?.recordset)) fail('INVALID_ERP_CONTEXT', '전산 조회 형식이 올바르지 않습니다.');
    const erp = new Map();
    const products = new Map(recordProducts);
    const seenCycles = new Set();
    const emptyCycles = new Set();
    const populatedCycles = new Set();
    const unsupportedSubweeks = new Set();
    for (const row of source.recordset) {
      const cycle = cycles.find(item => item.year === Number(row.OrderYear) && item.majorWeek === row.majorWeek);
      if (!cycle || Number(row.CustKey) !== scope.custKey) fail('ERP_SCOPE_MISMATCH', '전산 조회의 연도·차수·거래처가 다릅니다.');
      seenCycles.add(scopeKey(cycle));
      if (row.ProdKey === null) {
        if (emptyCycles.has(scopeKey(cycle)) || populatedCycles.has(scopeKey(cycle))) fail('INVALID_ERP_CONTEXT', '빈 전산 범위와 품목 행이 모순되거나 중복됩니다.');
        emptyCycles.add(scopeKey(cycle));
        if (row.OrderWeek !== null || nonnegative(row.Quantity) !== 0 || nonnegative(row.DetailRows) !== 0
          || nonnegative(row.InvalidQuantityRows) !== 0 || row.ShipmentDates !== '[]'
          || row.ProdName !== null || row.FlowerName !== null || row.OutUnit !== null) fail('INVALID_ERP_CONTEXT', '빈 전산 범위를 검증할 수 없습니다.');
        continue;
      }
      const key = nonnegative(row.ProdKey);
      if (emptyCycles.has(scopeKey(cycle))) fail('INVALID_ERP_CONTEXT', '빈 전산 범위와 품목 행이 모순됩니다.');
      populatedCycles.add(scopeKey(cycle));
      if (!Number.isInteger(key) || key < 1 || key > 2147483647 || typeof row.OrderWeek !== 'string'
        || row.OrderWeek.slice(0, 2) !== cycle.majorWeek) fail('INVALID_ERP_CONTEXT', '전산 품목·차수 식별자가 올바르지 않습니다.');
      const identity = `${scopeKey(cycle)}|${row.OrderWeek}|${key}`;
      if (erp.has(identity)) fail('INVALID_ERP_CONTEXT', '전산 세부차수·품목 집계가 중복입니다.');
      erp.set(identity, row);
      if (![`${cycle.majorWeek}-01`, `${cycle.majorWeek}-02`].includes(row.OrderWeek)) {
        unsupportedSubweeks.add(`${scopeKey(cycle)}|${key}`);
      }
      const prior = products.get(key);
      if (prior && (prior.OutUnit !== row.OutUnit || prior.ProdName !== row.ProdName || prior.FlowerName !== row.FlowerName)) {
        fail('PRODUCT_CONTEXT_CHANGED', '조회 도중 현재 품목 정보가 변경되었습니다.');
      }
      products.set(key, row);
    }
    if (seenCycles.size !== cycles.length) fail('INVALID_ERP_CONTEXT', '일부 차수의 전산 조회 결과가 누락되었습니다.');
    const snapshots = new Map();
    await Promise.all(cycles.map(async cycle => {
      for (const suffix of ['01', '02']) snapshots.set(`${scopeKey(cycle)}|${suffix}`, await baselineFor(cycle, scope.custKey, suffix));
    }));
    const baselineKeys = [...snapshots.values()].flatMap(snapshot => snapshot?.rows.map(row => row.prodKey) ?? []);
    for (const [key, product] of await productsFor(baselineKeys.filter(key => !products.has(key)))) products.set(key, product);
    const inputs = [];
    const sortedProducts = [...products].sort(([a], [b]) => a - b);
    for (const cycle of cycles) {
      for (const [prodKey, product] of sortedProducts) {
        const unit = normalizeWeekdayUnit(product.OutUnit);
        let basis = 0, allocated = 0, provisional = false;
        const errors = [];
        if (!unit) errors.push('UNKNOWN_UNIT');
        if (typeof product.ProdName !== 'string' || !product.ProdName.trim()) errors.push('INVALID_PRODUCT_METADATA');
        if (unsupportedSubweeks.has(`${scopeKey(cycle)}|${prodKey}`)) errors.push('UNSUPPORTED_SUBWEEK');
        for (const suffix of ['01', '02']) {
          const orderWeek = `${cycle.majorWeek}-${suffix}`;
          const row = erp.get(`${scopeKey(cycle)}|${orderWeek}|${prodKey}`);
          const snapshot = snapshots.get(`${scopeKey(cycle)}|${suffix}`);
          const original = snapshot?.rows.find(item => item.prodKey === prodKey);
          const total = row ? nonnegative(row.Quantity) : 0;
          if (snapshot) {
            if (original && original.unit !== unit) errors.push('BASELINE_UNIT_MISMATCH');
            basis += original?.quantity ?? 0;
          } else {
            provisional = true;
            if (total === null) errors.push('INVALID_ERP_QUANTITY'); else basis += total;
          }
          if (!row) continue; // A complete SELECT rowset explicitly proves absence, not a failed request.
          const count = nonnegative(row.DetailRows);
          if (total === null || !Number.isSafeInteger(count) || nonnegative(row.InvalidQuantityRows) !== 0
            || (count === 0 && total !== 0)) errors.push('INVALID_ERP_QUANTITY');
          let dates;
          try { dates = JSON.parse(row.ShipmentDates); } catch { errors.push('INVALID_ERP_DATES'); continue; }
          if (!Array.isArray(dates) || (count === 0 && dates.length)) { errors.push('INVALID_ERP_DATES'); continue; }
          const seenDates = new Set();
          let datedTotal = 0;
          for (const entry of dates) {
            let date;
            try { date = dateKey(entry?.date); } catch { errors.push('INVALID_ERP_DATES'); continue; }
            const amount = nonnegative(entry.quantity);
            if (typeof entry.date !== 'string' || entry.date !== date || entry.orderWeek !== orderWeek
              || nonnegative(entry.invalidRows) !== 0 || amount === null || seenDates.has(date)) {
              errors.push('INVALID_ERP_DATES'); continue;
            }
            seenDates.add(date);
            if (!cycle.days.some(day => day.date === date)) errors.push('DATE_OUTSIDE_CYCLE');
            datedTotal += amount;
          }
          if (total !== null && Math.abs(datedTotal - total) > 0.0000001) errors.push('ERP_DATE_TOTAL_MISMATCH');
          allocated += datedTotal;
        }
        if (!Number.isFinite(basis) || basis > Number.MAX_SAFE_INTEGER || !Number.isFinite(allocated) || allocated > Number.MAX_SAFE_INTEGER) errors.push('QUANTITY_OVERFLOW');
        const valid = errors.length === 0;
        inputs.push({ year: cycle.year, majorWeek: cycle.majorWeek, custKey: scope.custKey, startDate: cycle.startDate,
          prodKey, prodName: product.ProdName, flowerName: product.FlowerName, outUnit: product.OutUnit, unit,
          basis: valid ? basis : null, allocated: valid ? allocated : null, provisional, valid,
          error: valid ? null : [...new Set(errors)].join('|') });
      }
    }
    return { records, context: { custKey: scope.custKey, cycles, inputs } };
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'GET 또는 POST만 지원합니다.' });
    }
    try {
      const userId = validateUserId(req.user?.userId);
      if (req.user?.accountActive === false) fail('UNAUTHENTICATED', '활성 로그인이 필요합니다.', 401);
      const scope = req.method === 'GET' ? normalizeCarryoverScope(req.query, { query: true }) : normalizeCarryoverInput(req.body);
      const bindings = params(scope);
      const customer = await queryFn(CUSTOMER_SQL, { custKey: bindings.custKey });
      if (customer?.recordset?.length !== 1 || Number(customer.recordset[0].CustKey) !== scope.custKey) fail('INACTIVE_CUSTOMER', '실제 활성 거래처가 필요합니다.', 404);
      if (req.method === 'GET') return res.status(200).json({ success: true, readOnly: true, ...await contextFor(scope) });
      const product = await queryFn(PRODUCT_SCOPE_SQL, bindings);
      if (product?.recordset?.length !== 1 || Number(product.recordset[0].ProdKey) !== scope.prodKey) fail('INACTIVE_PRODUCT', '실제 활성 품목이 필요합니다.', 404);
      const currentUnit = normalizeWeekdayUnit(product.recordset[0].OutUnit);
      if (!currentUnit || currentUnit !== scope.unit) fail('UNIT_MISMATCH', '입력 단위는 현재 품목의 실제 출고 단위와 일치해야 합니다.', 400);
      const [cycle] = await visibleCycles(scope, true);
      if (Number(product.recordset[0].InScope) !== 1) {
        const snapshots = await Promise.all(['01', '02'].map(suffix => baselineFor(cycle, scope.custKey, suffix)));
        if (!snapshots.some(snapshot => snapshot?.rows.some(row => row.prodKey === scope.prodKey))) {
          fail('PRODUCT_OUT_OF_SCOPE', '선택 연도·차수·업체에 ERP 또는 최초 기준이 없습니다. 마감 기록만으로 새 범위를 만들지 않습니다.', 404);
        }
      }
      const record = await store.save(scope, userId, { startDate: cycle.startDate });
      return res.status(200).json({ success: true, record, erpChanged: false });
    } catch (error) {
      if (error instanceof WeekdayCarryoverError || error.name === 'WeekdayBaselineError') {
        return res.status(error.statusCode ?? 500).json({ success: false, code: error.code, error: error.message,
          ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }) });
      }
      return res.status(500).json({ success: false, code: 'CARRYOVER_REQUEST_FAILED', error: '잔량 처리에 실패했습니다. 저장 상태를 다시 조회하세요.' });
    }
  };
}

export default withAuth(createWeekdayCarryoverHandler());

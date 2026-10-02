import { query, sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import pageNoteStore from '../../../lib/weekdayPageNoteStore.js';
import baselineStore from '../../../lib/weekdayInitialBaselineStore.js';
import { buildShippingCycles } from '../../../lib/weekdayEstimateCycle.js';
import { normalizeWeekdayUnit } from '../../../lib/weekdayEstimateCompare.js';
import { WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL } from '../../../lib/weekdayCustomerLink.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

// SELECT-only eligibility; zero quantity and cancelled shipment are not fake ERP rows.
const CUSTOMER_SQL = `SELECT CustKey FROM Customer WHERE CustKey=@custKey AND ISNULL(isDeleted,0)=0`;
const PRODUCT_SCOPE_SQL = `SELECT p.ProdKey,p.OutUnit,
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
const PERIOD_SQL = `WITH anchor AS (
  SELECT BaseYmd FROM PeriodDay WHERE OrderYearWeek=@yearWeek AND WeekDay=5
) SELECT pd.OrderYearWeek,pd.WeekDay,CONVERT(nvarchar(23),pd.BaseYmd,121) AS BaseYmd
  FROM PeriodDay pd WHERE EXISTS (
    SELECT 1 FROM anchor a WHERE pd.BaseYmd>=DATEADD(day,-7,a.BaseYmd)
      AND pd.BaseYmd<DATEADD(day,14,a.BaseYmd)
  ) ORDER BY pd.BaseYmd`;
const DATE_QUANTITY_SQL = `SELECT COUNT_BIG(*) AS DateRows,
    SUM(sdd.ShipmentQuantity) AS ShipmentQuantity,
    SUM(CASE WHEN sdd.ShipmentQuantity IS NULL OR sdd.ShipmentQuantity<0 OR NOT ${WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL} THEN 1 ELSE 0 END) AS InvalidQuantityRows
  FROM ShipmentMaster sm
  JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
  JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey
  WHERE sm.OrderYear=@year AND LEFT(sm.OrderWeek,2)=@majorWeek AND sm.CustKey=@custKey
    AND sd.ProdKey=@prodKey AND ISNULL(sm.isDeleted,0)=0
    AND CONVERT(date,sdd.ShipmentDtm)=CONVERT(date,@destinationDate,23)`;

export function createWeekdayNoteHandler({ queryFn = query, types = sql, store = pageNoteStore,
  baselines = baselineStore, buildCycles = buildShippingCycles } = {}) {
  const { WeekdayPageNoteError, normalizeNoteScope, normalizeNoteInput, validateUserId } = pageNoteStore;
  const parameters = scope => ({ year: { type: types.Int, value: scope.year },
    majorWeek: { type: types.NVarChar(2), value: scope.majorWeek },
    custKey: { type: types.Int, value: scope.custKey },
    ...(scope.prodKey !== undefined ? { prodKey: { type: types.Int, value: scope.prodKey } } : {}) });

  async function cyclesFor(year, majorWeek) {
    const orderYearWeek = `${year}${majorWeek}`;
    const result = await queryFn(PERIOD_SQL, { yearWeek: { type: types.NVarChar(6), value: orderYearWeek } });
    try {
      const cycles = buildCycles(result.recordset, { year, majorWeek, orderYearWeek });
      const selected = cycles.find(cycle => cycle.offset === 0);
      if (!selected || selected.year !== year || selected.majorWeek !== majorWeek
        || selected.calendarState !== 'FOUND' || selected.days.some(day => day.calendarState !== 'FOUND')) {
        throw new Error('Incomplete calendar');
      }
      return selected;
    } catch {
      throw new WeekdayPageNoteError('NEEDS_REDESIGN', '실제 전산 출고 주기를 안전하게 확인할 수 없습니다.', 409);
    }
  }

  async function validateEarly(scope, product) {
    const early = scope.earlyShipment;
    if (early === null) return;
    const unit = normalizeWeekdayUnit(product.OutUnit);
    if (unit === null || unit !== early.unit) {
      throw new WeekdayPageNoteError('EARLY_UNIT_MISMATCH', '선출고 단위는 품목의 실제 출고 단위와 일치해야 합니다.');
    }
    const cycle = await cyclesFor(scope.year, scope.majorWeek);
    const day = cycle.days.find(item => item.date === early.date);
    if (!day) throw new WeekdayPageNoteError('INVALID_EARLY_DATE', '선출고일은 선택 차수의 실제 목~수 주기 안이어야 합니다.');
    const sequence = (year, week) => year * 10000 + Number(week.slice(0, 2)) * 100 + Number(week.slice(3));
    if (sequence(early.sourceYear, early.sourceOrderWeek) <= sequence(scope.year, day.orderWeek)) {
      throw new WeekdayPageNoteError('NOT_FUTURE_SOURCE', '선출고 원천은 목적 세부차수보다 뒤의 연도·차수여야 합니다.');
    }
    const sourceMajor = early.sourceOrderWeek.slice(0, 2);
    const sourceCycle = early.sourceYear === scope.year && sourceMajor === scope.majorWeek
      ? cycle : await cyclesFor(early.sourceYear, sourceMajor);
    if (!sourceCycle.days.some(item => item.orderWeek === early.sourceOrderWeek)) {
      throw new WeekdayPageNoteError('INVALID_EARLY_SOURCE_WEEK',
        '선출고 원천 세부차수가 실제 전산 출고 주기에 존재하지 않습니다.');
    }
    const saved = await queryFn(DATE_QUANTITY_SQL, { ...parameters(scope),
      destinationDate: { type: types.NVarChar(10), value: early.date } });
    const row = saved.recordset?.length === 1 ? saved.recordset[0] : null;
    const quantity = row?.ShipmentQuantity;
    const numeric = value => (typeof value === 'number' && Number.isFinite(value))
      || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)));
    if (!row || !numeric(row.DateRows) || Number(row.DateRows) <= 0
      || !numeric(row.InvalidQuantityRows) || Number(row.InvalidQuantityRows) !== 0
      || !numeric(quantity) || Number(quantity) <= 0) {
      throw new WeekdayPageNoteError('EARLY_DATE_QUANTITY_UNVERIFIED',
        '해당 날짜의 실제 저장 출고수량이 양수로 확인되지 않아 선출고를 기록할 수 없습니다.', 409);
    }
    if (early.quantity > Number(quantity)) {
      throw new WeekdayPageNoteError('EARLY_QUANTITY_EXCEEDS_SAVED', '선출고 수량은 해당 날짜의 실제 저장 출고수량을 넘을 수 없습니다.');
    }
    // Calendar validity is not an allocation/warehouse/stock provenance claim.
    // sourceYear/sourceOrderWeek and quantity remain explicit manual user metadata.
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'GET 또는 POST만 지원합니다.' });
    }
    try {
      const userId = validateUserId(req.user?.userId);
      if (req.user?.accountActive === false) throw new WeekdayPageNoteError('UNAUTHENTICATED', '활성 로그인이 필요합니다.', 401);
      const scope = req.method === 'GET' ? normalizeNoteScope(req.query, { query: true }) : normalizeNoteInput(req.body);
      const params = parameters(scope);
      const customer = await queryFn(CUSTOMER_SQL, { custKey: params.custKey });
      if (customer.recordset.length !== 1 || Number(customer.recordset[0].CustKey) !== scope.custKey) {
        throw new WeekdayPageNoteError('INACTIVE_CUSTOMER', '실제 활성 거래처가 필요합니다.', 404);
      }
      if (req.method === 'GET') {
        const notes = await store.list({ year: scope.year, majorWeek: scope.majorWeek, custKey: scope.custKey });
        return res.status(200).json({ success: true, notes, readOnly: true });
      }
      const product = await queryFn(PRODUCT_SCOPE_SQL, params);
      if (product.recordset.length !== 1 || Number(product.recordset[0].ProdKey) !== scope.prodKey) {
        throw new WeekdayPageNoteError('INACTIVE_PRODUCT', '실제 활성 품목이 필요합니다.', 404);
      }
      if (Number(product.recordset[0].InScope) !== 1) {
        // Explicit validated baseline reads, never existing notes as proof of eligibility.
        const snapshots = await Promise.all(['01', '02'].map(suffix => baselines.get({
          year: scope.year, orderWeek: `${scope.majorWeek}-${suffix}`, custKey: scope.custKey,
        })));
        const found = snapshots.some(snapshot => snapshot && snapshot.year === scope.year
          && snapshot.custKey === scope.custKey && snapshot.orderWeek.slice(0, 2) === scope.majorWeek
          && snapshot.rows.some(row => row.prodKey === scope.prodKey));
        if (!found) throw new WeekdayPageNoteError('PRODUCT_OUT_OF_SCOPE', '선택 연도·차수·업체에 주문/출고 또는 최초 기준이 없습니다.', 404);
      }
      await validateEarly(scope, product.recordset[0]);
      const note = await store.save(scope, userId);
      return res.status(200).json({ success: true, note, erpChanged: false });
    } catch (error) {
      if (error instanceof WeekdayPageNoteError || error.name === 'WeekdayBaselineError') {
        return res.status(error.statusCode ?? 500).json({ success: false, code: error.code, error: error.message,
          ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}) });
      }
      return res.status(500).json({ success: false, code: 'NOTE_REQUEST_FAILED', error: '비고 처리에 실패했습니다. 저장 상태를 다시 조회하세요.' });
    }
  };
}

export default withAuth(createWeekdayNoteHandler());

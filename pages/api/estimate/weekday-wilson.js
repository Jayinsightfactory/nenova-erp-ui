import { query, sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import wilsonStore from '../../../lib/weekdayWilsonStore.js';
import { verifyWeekdayWilsonRecord } from '../../../lib/weekdayWilson.js';
import { normalizeWeekdayUnit } from '../../../lib/weekdayEstimateCompare.js';
import { WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL } from '../../../lib/weekdayCustomerLink.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

const CUSTOMER_SQL = 'SELECT CustKey FROM Customer WHERE CustKey=@custKey AND ISNULL(isDeleted,0)=0';
// Read only. Native detail CustKey NULL remains valid; explicit wrong keys are rejected.
const QUANTITIES_SQL = `SELECT sm.OrderYear,sm.OrderWeek,sm.CustKey,sd.ProdKey,
  CONVERT(nvarchar(10),sdd.ShipmentDtm,23) AS Date,sdd.ShipmentQuantity AS Quantity,p.OutUnit,
  CASE WHEN ISNULL(p.isDeleted,0)=0 AND p.ProdKey IS NOT NULL THEN 1 ELSE 0 END AS ProductActive,
  CASE WHEN ${WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL} THEN 1 ELSE 0 END AS CustomerMatch
  FROM ShipmentMaster sm JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
  JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey LEFT JOIN Product p ON p.ProdKey=sd.ProdKey
  WHERE sm.OrderYear=@year AND LEFT(sm.OrderWeek,2)=@majorWeek AND sm.CustKey=@custKey
    AND ISNULL(sm.isDeleted,0)=0`;

export function createWeekdayWilsonHandler({ queryFn = query, types = sql, store = wilsonStore } = {}) {
  const { WeekdayWilsonError, normalizeWilsonScope, normalizeWilsonInput, validateUserId } = wilsonStore;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', error: 'GET 또는 POST만 지원합니다.' });
    }
    try {
      const userId = validateUserId(req.user?.userId);
      if (req.user?.accountActive === false) throw new WeekdayWilsonError('UNAUTHENTICATED', '활성 로그인이 필요합니다.', 401);
      const input = req.method === 'GET' ? normalizeWilsonScope(req.query, { query: true }) : normalizeWilsonInput(req.body);
      const scope = { year: input.year, majorWeek: input.majorWeek, custKey: input.custKey };
      const params = { year: { type: types.Int, value: scope.year },
        majorWeek: { type: types.NVarChar(2), value: scope.majorWeek }, custKey: { type: types.Int, value: scope.custKey } };
      const customer = await queryFn(CUSTOMER_SQL, { custKey: params.custKey });
      if (customer.recordset?.length !== 1 || Number(customer.recordset[0].CustKey) !== scope.custKey) {
        throw new WeekdayWilsonError('INACTIVE_CUSTOMER', '실제 활성 거래처가 필요합니다.', 404);
      }
      const result = await queryFn(QUANTITIES_SQL, params);
      const rows = (result.recordset ?? []).map(row => ({ ...row, Unit: normalizeWeekdayUnit(row.OutUnit) }));
      if (req.method === 'GET') {
        const saved = await store.list(scope);
        return res.status(200).json({ success: true, records: saved.map(record => verifyWeekdayWilsonRecord(record, rows)), readOnly: true });
      }
      const checked = verifyWeekdayWilsonRecord(input, rows, { forSave: true });
      if (checked.status !== 'CURRENT' && !(checked.status === 'CLEARED' && input.expectedTotal === 0 && input.wilsonQuantity === 0)) throw new WeekdayWilsonError('STALE_ERP_TOTAL',
        '현재 ERP 합계·단위·세부차수를 확인한 뒤 윌슨 구분을 다시 저장하세요.', 409);
      const record = await store.save(input, userId);
      return res.status(200).json({ success: true, record: { ...record, status: checked.status,
        ...(checked.status === 'CURRENT' ? { currentTotal: input.expectedTotal } : {}) }, erpChanged: false });
    } catch (error) {
      if (error instanceof WeekdayWilsonError) return res.status(error.statusCode ?? 500).json({
        success: false, code: error.code, error: error.message,
        ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}) });
      return res.status(500).json({ success: false, code: 'WILSON_REQUEST_FAILED', error: '윌슨 구분 처리에 실패했습니다. 저장 상태를 다시 조회하세요.' });
    }
  };
}

export default withAuth(createWeekdayWilsonHandler());

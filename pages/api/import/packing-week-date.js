import { query, sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { packingWeekScope, packingCalendarDate } from '../../../lib/packingWeekDate.js';

export function createPackingWeekDateHandler({ queryFn = query, types = sql } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
    let scope;
    try { scope = packingWeekScope(req.query.orderYear, req.query.orderWeek); }
    catch (error) { return res.status(400).json({ success: false, error: error.message }); }
    try {
      const result = await queryFn(`SELECT OrderYearWeek, WeekDay, BaseYmd FROM PeriodDay
        WHERE OrderYearWeek=@yearWeek AND WeekDay=@weekDay`, {
        yearWeek: { type: types.NVarChar(6), value: scope.yearWeek }, weekDay: { type: types.Int, value: scope.weekDay },
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ success: true, readOnly: true, calendar: packingCalendarDate(result.recordset, scope) });
    } catch (error) { return res.status(409).json({ success: false, error: '차수 기준일을 확인하지 못했습니다. 전산 달력과 연결 상태를 확인하세요.' }); }
  };
}
export default withAuth(createPackingWeekDateHandler());

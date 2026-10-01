import { query, sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { normalizeCycleRequest, buildShippingCycles } from '../../../lib/weekdayEstimateCycle.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).end(); }
  let scope;
  try { scope = normalizeCycleRequest(req.query); }
  catch (error) { return res.status(400).json({ success: false, error: error.message }); }
  try {
    const result = await query(`
      WITH anchor AS (SELECT BaseYmd FROM PeriodDay WHERE OrderYearWeek=@yearWeek AND WeekDay=5)
      SELECT pd.OrderYearWeek, pd.WeekDay, CONVERT(nvarchar(23),pd.BaseYmd,121) AS BaseYmd
      FROM PeriodDay pd
      WHERE EXISTS (SELECT 1 FROM anchor a WHERE pd.BaseYmd >= DATEADD(day,-7,a.BaseYmd)
        AND pd.BaseYmd < DATEADD(day,14,a.BaseYmd))
      ORDER BY pd.BaseYmd`, { yearWeek: { type: sql.NVarChar(6), value: scope.orderYearWeek } });
    const cycles = buildShippingCycles(result.recordset, scope);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ success: true, readOnly: true, scope, cycles });
  } catch (error) { return res.status(409).json({ success: false, error: error.message }); }
});

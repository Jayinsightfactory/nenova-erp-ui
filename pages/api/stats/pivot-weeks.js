import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { buildPivotAvailableWeeksSql, normalizePivotAvailableWeeks } from '../../../lib/pivotAvailableWeeks';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const orderYear = Number(req.query.orderYear);
  if (!Number.isInteger(orderYear) || orderYear < 2020 || orderYear > 2099) {
    return res.status(400).json({ success: false, error: '조회 연도를 확인하세요.' });
  }

  try {
    const result = await query(
      buildPivotAvailableWeeksSql(),
      { year: { type: sql.Int, value: orderYear } },
    );
    return res.status(200).json({
      success: true,
      orderYear,
      weeks: normalizePivotAvailableWeeks(result.recordset),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

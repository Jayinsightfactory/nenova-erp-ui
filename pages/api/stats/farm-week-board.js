import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { buildFarmWeekBoard } from '../../../lib/farmWeekBoard';
import { FARM_WEEK_BOARD_ACTIVE_WEEKS_SQL, FARM_WEEK_BOARD_SQL } from '../../../lib/farmWeekBoardSql';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end();
  }
  const year = String(req.query.orderYear || '');
  const week = String(req.query.orderWeek || '');
  if (!/^20\d{2}$/.test(year) || +year < 2020 || !/^(0[1-9]|[1-4]\d|5[0-2])-0[1-4]$/.test(week)) {
    return res.status(400).json({ success: false, error: '연도와 세부차수를 확인하세요.' });
  }
  try {
    const yearParam = { year: { type: sql.NVarChar, value: year } };
    const [data, varieties, activeWeeksResult] = await Promise.all([
      query(FARM_WEEK_BOARD_SQL, {
        year: { type: sql.NVarChar, value: year },
        week: { type: sql.NVarChar, value: week },
      }),
      query(`SELECT DISTINCT CounName country, FlowerName flower FROM Product WHERE ISNULL(isDeleted,0)=0 ORDER BY CounName, FlowerName`),
      query(FARM_WEEK_BOARD_ACTIVE_WEEKS_SQL, yearParam),
    ]);
    const activeWeeks = (activeWeeksResult.recordset || []).map(row => ({
      week: `${year}-${row.week}`,
      orderWeek: row.week,
      hasIncoming: Boolean(row.hasIncoming),
      hasOrder: Boolean(row.hasOrder),
      hasDistribution: Boolean(row.hasDistribution),
    }));
    return res.json({
      success: true,
      orderYear: year,
      orderWeek: week,
      rows: buildFarmWeekBoard(data.recordset, { orderYear: year, orderWeek: week }),
      varieties: varieties.recordset,
      activeWeeks,
      loadedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('farm-week-board read failed', error.code || error.name);
    return res.status(500).json({ success: false, error: '농장표 조회에 실패했습니다. 새로고침 후 다시 확인하세요.' });
  }
});

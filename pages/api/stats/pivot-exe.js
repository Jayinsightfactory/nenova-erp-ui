import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { sqlQuantityPivotGetData } from '../../../lib/exeQuantityPivotSql';
import { normalizePivotExeRange } from '../../../lib/pivotExeRange';

// Read only. Do not substitute the legacy web aggregation or execute any stock SP.
export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: '조회만 가능한 피벗입니다.' });
  }
  if (req.query.mode === 'weeks') {
    try {
      const result = await query(`SELECT DISTINCT OrderYear, OrderWeek, OrderYearWeek
        FROM StockMaster
        WHERE OrderYear IS NOT NULL AND OrderWeek IS NOT NULL
        ORDER BY OrderYearWeek DESC`);
      return res.status(200).json({ success: true, weeks: result.recordset, source: 'StockMaster' });
    } catch (err) {
      console.error('[pivot-exe weeks]', err.message);
      return res.status(500).json({ success: false, error: '전산 차수 목록을 불러오지 못했습니다. 잠시 후 다시 조회하세요.' });
    }
  }
  let range;
  try { range = normalizePivotExeRange(req.query); }
  catch (err) { return res.status(400).json({ success: false, error: err.message }); }
  try {
    const result = await query(sqlQuantityPivotGetData(), {
      weekFrom: { type: sql.NVarChar, value: range.weekFrom },
      weekTo: { type: sql.NVarChar, value: range.weekTo },
    });
    // Never silently truncate a report or export partial source rows.
    if (result.recordset.length > 200000) return res.status(422).json({ success: false, error: '조회 원본이 20만 행을 넘었습니다. 차수 범위를 나누어 조회하세요.' });
    return res.status(200).json({ success: true, rows: result.recordset, range, source: 'nenova.exe FormQuantityPivot' });
  } catch (err) {
    console.error('[pivot-exe]', err.message);
    return res.status(500).json({ success: false, error: '전산 피벗 원본을 조회하지 못했습니다. 차수 범위를 확인하고 다시 조회하세요. 반복되면 관리자에게 발생 시각과 조회 범위를 알려주세요.' });
  }
});

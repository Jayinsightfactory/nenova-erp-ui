import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { sqlQuantityPivotGetData } from '../../../lib/exeQuantityPivotSql';
import { normalizePivotExeRange } from '../../../lib/pivotExeRange';
import { getArrivalCostsForWeekRange } from '../../../lib/pivotFreightArrival';
import { enrichPivotExeRows, sqlPivotExeDistributionCosts } from '../../../lib/pivotExeSupplement';

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
    const params = {
      weekFrom: { type: sql.NVarChar, value: range.weekFrom },
      weekTo: { type: sql.NVarChar, value: range.weekTo },
    };
    const result = await query(sqlQuantityPivotGetData(), params);
    // Never silently truncate a report or start expensive supplement reads for a rejected range.
    if (result.recordset.length > 200000) return res.status(422).json({ success: false, error: '조회 원본이 20만 행을 넘었습니다. 차수 범위를 나누어 조회하세요.' });
    const [distributionResult, arrivalResult] = await Promise.allSettled([
      query(sqlPivotExeDistributionCosts(), params),
      getArrivalCostsForWeekRange({
        weekStart: `${range.fromYear}-${range.fromWeek}`,
        weekEnd: `${range.toYear}-${range.toWeek}`,
      }),
    ]);
    const warnings = [];
    if (distributionResult.status === 'rejected') warnings.push('분배단가를 불러오지 못했습니다.');
    if (arrivalResult.status === 'rejected') warnings.push('도착원가를 불러오지 못했습니다.');
    const rows = enrichPivotExeRows(
      result.recordset,
      distributionResult.status === 'fulfilled' ? distributionResult.value.recordset : [],
      arrivalResult.status === 'fulfilled' ? arrivalResult.value : {},
    );
    return res.status(200).json({ success: true, rows, range, warnings, source: 'nenova.exe FormQuantityPivot + 웹 분배단가/도착원가' });
  } catch (err) {
    console.error('[pivot-exe]', err.message);
    return res.status(500).json({ success: false, error: '전산 피벗 원본을 조회하지 못했습니다. 차수 범위를 확인하고 다시 조회하세요. 반복되면 관리자에게 발생 시각과 조회 범위를 알려주세요.' });
  }
});

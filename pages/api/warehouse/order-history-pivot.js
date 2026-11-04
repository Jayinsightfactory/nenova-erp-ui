// GET /api/warehouse/order-history-pivot
// nenova.exe FormOrderHistory(발주 관리 · ≡ 발주 목록)와 동일한 원본 행을 그대로 돌려준다.
//   ?mode=lookups            → 차수 목록(StockMaster) + 품목(CountryFlower) 목록
//   ?week=44-01&countryFlower= → 피벗 원본 행 (브라우저에서 집계)
// 읽기 전용. UPDATE/INSERT/DELETE/SP 없음.

import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { normalizeOrderWeek } from '../../../lib/orderUtils';
import { sqlOrderHistoryPivotGetData, SQL_ORDER_HISTORY_WEEKS, SQL_ORDER_HISTORY_COUNTRY_FLOWERS } from '../../../lib/orderHistoryPivotSql';

const MAX_ROWS = 200000;

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: '조회만 가능한 발주 목록입니다.' });
  }
  if (req.query.mode === 'lookups') {
    try {
      const [weeks, countries] = await Promise.all([query(SQL_ORDER_HISTORY_WEEKS), query(SQL_ORDER_HISTORY_COUNTRY_FLOWERS)]);
      return res.status(200).json({ success: true, weeks: weeks.recordset, countryFlowers: countries.recordset, source: 'nenova.exe FormOrderHistory.SetComobo' });
    } catch (err) {
      console.error('[order-history-pivot lookups]', err.message);
      return res.status(500).json({ success: false, error: '차수·품목 목록을 불러오지 못했습니다.' });
    }
  }
  const week = req.query.week ? normalizeOrderWeek(String(req.query.week)) : '';
  if (req.query.week && !week) return res.status(400).json({ success: false, error: '차수 형식이 올바르지 않습니다. 예: 44-01' });
  const countryFlower = String(req.query.countryFlower || '').trim().slice(0, 100);
  try {
    const params = {};
    if (week) params.week = { type: sql.NVarChar, value: week };
    if (countryFlower) params.countryFlower = { type: sql.NVarChar, value: countryFlower };
    const result = await query(sqlOrderHistoryPivotGetData({ week, countryFlower }), params);
    if (result.recordset.length > MAX_ROWS) return res.status(422).json({ success: false, error: '조회 원본이 20만 행을 넘었습니다. 차수나 품목을 지정하세요.' });
    return res.status(200).json({ success: true, rows: result.recordset, scope: { week, countryFlower }, source: 'nenova.exe FormOrderHistory.GetData' });
  } catch (err) {
    console.error('[order-history-pivot]', err.message);
    return res.status(500).json({ success: false, error: '발주 목록 조회 중 오류가 발생했습니다.' });
  }
});

// The note ledger is independent of the report/snapshot calculation path.
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { STOCK_ADJUSTMENT_NOTES_SQL, parseStockAdjustmentScope, buildStockAdjustmentNotes } from '../../../lib/stockAdjustmentReportNotes';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, message: 'GET만 허용합니다.' });
  const scope = parseStockAdjustmentScope(req.query?.year, req.query?.week);
  if (!scope) return res.status(400).json({ ok: false, message: '유효한 4자리 연도와 1~53차 차수가 필요합니다.' });
  try {
    if (req.query.detail === '1') {
      const { loadProfitImpactNotes } = await import('../../../lib/profitImpactNotesData');
      const { loadWeeklyReportPayload } = await import('./profit-report');
      const payload = await loadWeeklyReportPayload(scope.major, scope.orderYear);
      const result = await loadProfitImpactNotes(payload, s => loadWeeklyReportPayload(s.major, s.year, { currentPeriod: { orderYear: '9999', major: '53' } }));
      return res.status(200).json({ ok: true, ...result, queriedAt: new Date().toISOString() });
    }
    const result = await query(STOCK_ADJUSTMENT_NOTES_SQL, {
      year: { type: sql.NVarChar, value: scope.orderYear },
      major: { type: sql.NVarChar, value: scope.major },
      prefix: { type: sql.NVarChar, value: scope.prefix },
    });
    return res.status(200).json({ ok: true, ...buildStockAdjustmentNotes(result.recordset, scope), queriedAt: new Date().toISOString() });
  } catch (error) {
    console.error('[profit-stock-adjustment-notes] read failed:', error);
    if(error?.statusCode===409&&error?.code==='PROFIT_SOURCES_CHANGED')return res.status(409).json({ok:false,code:'PROFIT_SOURCES_CHANGED',message:'재고조정 이력을 조회하지 못했습니다. 다시 시도해 주세요.'});
    return res.status(500).json({ ok: false, message: '재고조정 이력을 조회하지 못했습니다. 다시 시도해 주세요.' });
  }
});

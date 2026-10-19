import { withAuth } from '../../../lib/auth';
import { loadWeeklyReportPayload } from './profit-report';
import { buildProfitReportXlsx } from '../../../lib/profitReportExcel';
import { outputScope } from '../../../lib/profitRangeOutput.mjs';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  let scope;
  try { scope = outputScope(req.query.year, req.query.week); }
  catch (e) { return res.status(400).json({ success: false, error: e.message }); }
  const visibleCols = String(req.query.cols ?? 'C,E,F,G,H,I,J,K').split(',').filter(Boolean);
  const displayCategory = req.query.category !== '0';
  const allowedCols = new Set(['C','AC','D','E','F','G','H','I','J','AJ','K','L','M','N','O','P','Q','R','S','T','U']);
  if (Array.isArray(req.query.cols) || (!visibleCols.length && !displayCategory) || visibleCols.some(col => !allowedCols.has(col)) || (req.query.category != null && !['0','1'].includes(req.query.category))) {
    return res.status(400).json({ success: false, error: '출력할 표시열을 확인하세요.' });
  }
  try {
    const data = await loadWeeklyReportPayload(scope.major, scope.year, { preferLive: true });
    const workbook = buildProfitReportXlsx({ major: scope.major, rows: data.rows, note: data.note,
      audit: data.audit, visibleCols, confirmedTotals: data.confirmed ? data.confirmedTotals : null,
      displaySheetFirst: true, displayCategory, returnWorkbook: true });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json({ success: true, ...scope, workbook });
  } catch (e) { return res.status(500).json({ success: false, error: e.message || '출력 자료 조회 실패' }); }
});

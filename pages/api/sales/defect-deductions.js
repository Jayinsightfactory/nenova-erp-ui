// 영업수입불량차감 원장 API
// GET       목록/이력/검색
// POST      draft 저장, Estimate 일괄 등록, 등록 전 검증
// DELETE    soft-delete + 연결된 Estimate 삭제(원본 exe ClassEstimate.Delete와 동일)

import { withAuth } from '../../../lib/auth';
import { withActionLog } from '../../../lib/withActionLog';
import {
  deleteDeductions,
  ensureSalesDefectTables,
  listDeductions,
  loadLookupData,
  loadMatchContext,
  matchSalesDefectRows,
  preflightRegistration,
  registerDeductions,
  saveDraftRows,
} from '../../../lib/salesDefectDeductions.js';
import { normalizeParentWeek, normalizeYear } from '../../../lib/salesDefectDeductionCore.js';

function defaultYear() { return new Date().getFullYear(); }

async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      if (req.query.view === 'lookups') {
        const data = await loadLookupData({ q: req.query.q || '', kind: req.query.kind || 'farm' });
        return res.status(200).json({ success: true, ...data });
      }
      const year = normalizeYear(req.query.year || defaultYear());
      const week = normalizeParentWeek(req.query.week || 1);
      if (!year || !week) return res.status(400).json({ success: false, error: '연도와 차수를 확인하세요.' });
      const data = await listDeductions({
        year,
        week,
        manager: req.query.manager || '',
        includeDeleted: req.query.includeDeleted === '1',
        history: req.query.history === '1',
      });
      return res.status(200).json({ success: true, year, week, ...data });
    }

    await ensureSalesDefectTables();

    if (req.method === 'POST') {
      const action = String(req.body?.action || 'save');
      const year = normalizeYear(req.body?.year);
      const week = normalizeParentWeek(req.body?.week);
      if (!year || !week) return res.status(400).json({ success: false, error: '연도와 차수를 확인하세요.' });

      if (action === 'save') {
        const rows = await saveDraftRows({
          year, week, rows: req.body?.rows || [], user: req.user,
          sourceFileName: req.body?.sourceFileName || '',
        });
        return res.status(200).json({ success: true, saved: rows.length, rows });
      }
      if (action === 'rematch') {
        const context = await loadMatchContext();
        const rows = matchSalesDefectRows(req.body?.rows || [], context);
        return res.status(200).json({ success: true, rows, persisted: false });
      }
      if (action === 'preflight') {
        const rows = await preflightRegistration({ year, week, rows: req.body?.rows || [] });
        return res.status(200).json({ success: true, rows, invalidCount: rows.filter((x) => x.error).length });
      }
      if (action === 'register') {
        const registered = await registerDeductions({
          year, week, ids: req.body?.ids || [], deductionType: req.body?.deductionType || '불량차감', user: req.user,
        });
        return res.status(200).json({ success: true, registered: registered.length, rows: registered });
      }
      return res.status(400).json({ success: false, error: `지원하지 않는 작업입니다: ${action}` });
    }

    if (req.method === 'DELETE') {
      await deleteDeductions({
        year: req.body?.year || req.query.year,
        week: req.body?.week || req.query.week,
        ids: req.body?.ids || req.query.ids?.split(',') || [],
        user: req.user,
      });
      return res.status(200).json({ success: true, message: '선택 행과 연결된 견적서 차감행을 삭제하고 이력을 남겼습니다.' });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ success: false, error: 'GET/POST/DELETE만 지원합니다.' });
  } catch (error) {
    console.error('[sales-defect-deductions]', error);
    return res.status(400).json({ success: false, error: error.message || '영업수입불량차감 처리에 실패했습니다.' });
  }
}

export default withAuth(withActionLog(handler, {
  actionType: 'SALES_DEFECT_DEDUCTION',
  affectedTable: 'WebSalesDefectDeduction+WebSalesDefectDeductionHistory+Estimate',
  riskLevel: 'HIGH',
}));

// 주차별 매출이익 보고서 — 보고서 기준 확정/취소/이력 API.
// GET: 조회 전용(활성 확정본 + 이력) — 스키마를 만들지 않는다. 스키마가 없으면 initialized:false만 반환한다.
// POST: confirm/force/cancel — Web 전용 확정 테이블(WebProfitReportConfirm(Detail))만 쓴다.
//   ERP 공유 원장(Order/Shipment/Estimate/ProductStock/StockHistory)은 절대 INSERT/UPDATE/DELETE하지 않는다.
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import { parseMajor, loadReportData } from './profit-report';
import { computeProfitRow, computeProfitTotals, calcRevenueRatio, calcPurchaseRatio } from '../../../lib/profitReportCalc';
import {
  confirmSchemaStatus, confirmSnapshot, cancelConfirm, getActiveConfirm, listConfirmHistory,
} from '../../../lib/profitReportConfirm';

// 관리자 판정 — pages/api/m/order-request-approve.js와 동일 패턴(이 저장소의 기존 관리자 판정 규칙 재사용)
const isAdminUser = (user) => /admin|관리자|대표/i.test(user?.authority || '') || user?.deptName === '대표';

async function buildLiveConfirmPayload(major, orderYear) {
  const data = await loadReportData(major, orderYear);
  const rows = (data.rows || []).map((r) => ({ ...r, calc: computeProfitRow(r) }));
  const totals = computeProfitTotals(rows);
  const rowsWithRatios = rows.map((r) => ({
    ...r,
    calc: { ...r.calc, D: calcRevenueRatio(r.calc, totals), U: calcPurchaseRatio(r.calc, totals) },
  }));
  return { rows: rowsWithRatios, totals, stockWeeks: data.stockWeeks, audit: data.audit };
}

export default withAuth(async function handler(req, res) {
  try {
    const major = parseMajor(req.method === 'GET' ? req.query.week : req.body?.week);
    if (!major) return res.status(400).json({ success: false, error: 'week 필요 (예: 27)' });
    const orderYear = resolveActiveOrderYear(
      `${major}-01`,
      req.method === 'GET' ? req.query.year : req.body?.year,
    );

    if (req.method === 'GET') {
      const status = await confirmSchemaStatus();
      if (!status.initialized) {
        return res.status(200).json({
          success: true, initialized: false, major, orderYear,
          message: '보고서 기준 확정 기능이 아직 초기 설정되지 않았습니다. 첫 확정 시 자동으로 준비되거나, 배포 담당자가 명시적 적용 스크립트를 먼저 실행해야 합니다.',
          activeConfirm: null, history: [],
        });
      }
      const [active, history] = await Promise.all([
        getActiveConfirm(orderYear, major),
        listConfirmHistory(orderYear, major),
      ]);
      return res.status(200).json({
        success: true, initialized: true, major, orderYear,
        activeConfirm: active.confirm || null,
        history: history.revisions,
      });
    }

    if (req.method === 'POST') {
      const actor = req.user?.userId || 'user';
      const actorName = req.user?.userName || null;
      const action = String(req.body?.action || 'confirm');

      if (action === 'cancel') {
        const result = await cancelConfirm({ orderYear, major, actor, actorName });
        return res.status(200).json({ success: true, ...result });
      }

      if (action === 'confirm' || action === 'force') {
        const force = action === 'force';
        if (force && !isAdminUser(req.user)) {
          return res.status(403).json({ success: false, error: '강제 확정은 관리자만 할 수 있습니다.', code: 'FORCE_REQUIRES_ADMIN' });
        }
        const payload = await buildLiveConfirmPayload(major, orderYear);
        const result = await confirmSnapshot({
          orderYear, major,
          rows: payload.rows, totals: payload.totals, stockWeeks: payload.stockWeeks, audit: payload.audit,
          actor, actorName,
          isAdmin: isAdminUser(req.user),
          force,
          forceReason: req.body?.reason,
          notes: req.body?.notes,
        });
        return res.status(200).json({ success: true, ...result });
      }

      return res.status(400).json({ success: false, error: `알 수 없는 action: ${action}` });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message, code: e.code });
  }
});

/**
 * POST /api/shipment/fix-reconcile
 * { week, forceFullWeekRecalc?: boolean }
 *
 * 카테고리 부분 확정/취소 후 꼬인 차수를 수동 복구 — usp_StockCalculation 차수 전체 재실행 + 정합 진단
 */
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { reconcileWeekAfterScopedOperation } from '../../../lib/shipmentFixReconcile';

function parseWeek(input) {
  const raw = String(input || '').trim();
  const full = raw.match(/^(\d{4})-(\d{2}-\d{2})$/);
  if (full) return { year: full[1], week: full[2] };
  const short = raw.match(/^(\d{2}-\d{2})$/);
  if (short) return { year: String(new Date().getFullYear()), week: short[1] };
  return null;
}

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST only' });

  const parsed = parseWeek(req.body?.week);
  if (!parsed) return res.status(400).json({ success: false, error: 'week 필요 (예: 25-01)' });

  const uid = req.user?.userId || 'admin';
  const forceFullWeekRecalc = req.body?.forceFullWeekRecalc !== false;

  try {
    const reconcile = await reconcileWeekAfterScopedOperation({
      q: query,
      sqlTypes: sql,
      orderYear: parsed.year,
      orderWeek: parsed.week,
      uid,
      scopeLabel: 'manual-reconcile',
      forceFullWeekRecalc,
    });

    return res.status(200).json({
      success: reconcile.stockErrors.length === 0,
      week: `${parsed.year}-${parsed.week}`,
      reconcile,
      parity: reconcile.parity,
      message: reconcile.parity.exeAligned
        ? `[${parsed.year}-${parsed.week}] exe 정합 완료`
        : `[${parsed.year}-${parsed.week}] 재계산 완료 — ${reconcile.parity.warnings.join(' / ') || '정합 미완'}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

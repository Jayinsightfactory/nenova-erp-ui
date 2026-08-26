import { withTransaction, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { assertErpEditGuard, advanceErpEditGuard } from '../../../lib/erpEditPresence.js';
import { normalizeEstimateCostRequest, executeEstimateCostOnly } from '../../../lib/estimateCostOnly.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const body = req.body || {};
    const { mode, requestedYear } = normalizeEstimateCostRequest(body);
    const result = await withTransaction((tQ) => executeEstimateCostOnly(tQ, body, {
      sql, user: req.user,
      assertEditGuard: assertErpEditGuard,
      advanceEditGuard: advanceErpEditGuard,
    }));
    return res.status(200).json({
      success: true, mode, orderYear: requestedYear,
      message: `단가 수정 완료 (${result.changedCount}건, ${result.shipmentKeys.length}개 차수, 공급가 ${result.diffAmount >= 0 ? '+' : ''}${result.diffAmount.toLocaleString()}원)`,
      ...result,
    });
  } catch (err) {
    const guardError = ['ERP_EDIT_LOCKED', 'ERP_EDIT_STALE', 'ERP_EDIT_GUARD_INVALID'].includes(err.code);
    const status = guardError ? 409 : (err.status || 500);
    // Keep failure diagnostics without a separate DB write/DDL or request payload.
    console.error('[estimate/update-cost]', {
      code: err.code || 'COST_SAVE_FAILED', status, sqlNumber: err.number,
      shipmentKey: err.shipmentKey, sdetailKey: err.sdetailKey,
      estimateKey: err.estimateKey, sdateKey: err.sdateKey,
    });
    return res.status(status).json({
      success: false, code: err.code, error: err.message,
      sdetailKey: err.sdetailKey, estimateKey: err.estimateKey, sdateKey: err.sdateKey,
      shipmentKey: err.shipmentKey, expected: err.expected, actual: err.actual,
      ...(guardError ? { lease: err.lease || null } : {}),
    });
  }
});

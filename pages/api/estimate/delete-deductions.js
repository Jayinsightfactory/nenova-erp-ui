import { withTransaction, sql } from '../../../lib/db.js';
import { withAuth } from '../../../lib/auth.js';
import { requireErpWriteScope } from '../../../lib/erpWriteScope.js';
import { assertErpEditGuard, advanceErpEditGuard } from '../../../lib/erpEditPresence.js';
import { normalizeEstimateDeductionDeleteRequest, executeEstimateDeductionDelete } from '../../../lib/estimateDeductionDelete.js';

export default withAuth(async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end();
  }
  try {
    // Keep the shared ERP scope guard as the API boundary; the core then checks
    // the parent-week and exact locked ShipmentMaster row again in one transaction.
    try {
      requireErpWriteScope(req.body || {}, '견적 차감 삭제');
    } catch (error) {
      return res.status(400).json({ success: false, code: error.code, error: error.message });
    }
    const request = normalizeEstimateDeductionDeleteRequest(req.body || {});
    const user = {
      ...req.user,
      sessionId: req.headers?.['x-claude-session'] || req.user?.userId || '',
      ipAddress: String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim(),
      userAgent: req.headers?.['user-agent'] || '',
    };
    const result = await withTransaction((tQ) => executeEstimateDeductionDelete(tQ, request, {
      sql, user, assertEditGuard: assertErpEditGuard, advanceEditGuard: advanceErpEditGuard,
    }));
    return res.status(200).json(result);
  } catch (error) {
    const conflict = ['ERP_EDIT_LOCKED', 'ERP_EDIT_STALE', 'ERP_EDIT_GUARD_INVALID', 'ESTIMATE_DEDUCTION_DELETE_STALE', 'ESTIMATE_DEDUCTION_DELETE_SCOPE', 'ESTIMATE_DEDUCTION_DELETE_INELIGIBLE', 'ESTIMATE_DEDUCTION_DELETE_VERIFY', 'ESTIMATE_DEDUCTION_DELETE_LEDGER_AMBIGUOUS'].includes(error.code);
    return res.status(conflict ? 409 : Number(error.statusCode || 500)).json({
      success: false, code: error.code, error: error.message || '견적 차감 삭제 중 오류가 발생했습니다.', lease: error.lease || null,
    });
  }
});

import { withAuth } from '../../../lib/auth.js';
import { query, withTransaction, sql } from '../../../lib/db.js';
import { approvalPermissions, approvalError } from '../../../lib/incomingApprovalPolicy.js';
import { listIncomingApprovals, readApproval, assertApprovalAccess, assertApprovalRevision, mutateIncomingApproval } from '../../../lib/incomingApprovalStore.js';
import { readIncomingApprovalFacts, incomingApprovalBaseline, prepareIncomingApproval, commitIncomingApproval } from '../../../lib/incomingApproval.js';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };
const publicPreview = f => ({ digest: f.digest, canCommit: f.canCommit, issues: f.issues,
  changes: f.receiptPlan.changes, before: f.receiptPlan.before, after: f.receiptPlan.after,
  farmBefore: f.receipt.header.FarmName, farmAfter: f.correction.farmName,
  groups: f.groups.map(g => ({ key: g.key, customer: g.master.CustName, year: g.master.OrderYear, week: g.master.OrderWeek,
    prodKey: g.product.ProdKey, product: g.product.ProdName, unit: g.product.OutUnit, estUnit: g.product.EstUnit,
    before: g.detail?.OutQuantity ?? 0, after: g.outQuantity, beforeAmount: g.detail?.Amount ?? 0, afterAmount: g.amount,
    beforeVat: g.detail?.Vat ?? 0, afterVat: g.vat, stockDelta: g.stockDelta, fixed: g.fixed, orderRequired: g.orderRequired, dates: g.after })),
  stockPreview: f.stockPreview, reports: f.reportConfirmations, externalDocuments: '이미 발송한 견적서는 정정 후 재발행이 필요합니다. 외부 회계 전표는 자동 변경하지 않습니다.' });

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const permissions = approvalPermissions(req.user);
  if (!permissions.request && !permissions.review) return res.status(403).json({ success: false, error: '수입부 또는 영업지원 권한이 필요합니다.' });
  try {
    if (req.method === 'GET') {
      if (!req.query.requestId) return res.json({ success: true, permissions, requests: await listIncomingApprovals(query, sql, req.user) });
      const row = await readApproval(query, sql, req.query.requestId);
      assertApprovalAccess(row, req.user);
      const terminal = ['applied','rejected','cancelled'].includes(row.Status);
      const facts = terminal ? { receipt:row.payload.baseline.receipt, receiptPlan:row.payload.baseline.receiptPlan,
        products:row.payload.baseline.products, masters:[],details:[],dates:[],farmAssignments:[],farms:[] }
        : await readIncomingApprovalFacts(query, sql, row.payload.correction);
      return res.json({ success: true, permissions, request: { requestId: row.RequestId, status: row.Status, requestedBy: row.RequestedBy, ...row.payload },
        facts: { receipt:facts.receipt,receiptPlan:facts.receiptPlan,products:facts.products,masters:facts.masters,
          details:facts.details,dates:facts.dates,farmAssignments:facts.farmAssignments,farms:facts.farms,farmCandidates:facts.farmCandidates??{} } });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).end(); }
    const input = req.body ?? {};
    if (input.action === 'draftPreview') {
      if (!permissions.request) throw approvalError('APPROVAL_FORBIDDEN', '수입부 요청 권한이 필요합니다.', 403);
      const f = await readIncomingApprovalFacts(query, sql, input.correction);
      return res.json({ success: true, canCommit: f.receiptPlan.changed, issues: [], changes: f.receiptPlan.changes,
        before: f.receiptPlan.before, after: f.receiptPlan.after, farmBefore: f.receipt.header.FarmName, farmAfter: f.correction.farmName });
    }
    if (input.action === 'preview') {
      if (!permissions.review) throw approvalError('APPROVAL_FORBIDDEN', '영업지원 검토 권한이 필요합니다.', 403);
      const row = await readApproval(query, sql, input.requestId);
      assertApprovalRevision(row, input.revision);
      if (row.Status !== 'requested') throw approvalError('APPROVAL_STATE_INVALID', '검토 대기 요청을 선택하세요.');
      return res.json({ success: true, ...publicPreview(await prepareIncomingApproval(query, sql, row)) });
    }
    if (input.action === 'approve') return res.json({ success: true, ...await commitIncomingApproval({ withTransactionFn: withTransaction, types: sql, user: req.user, input }) });
    const result = await mutateIncomingApproval({ withTransactionFn: withTransaction, types: sql, user: req.user, input,
      readBaseline: (q, correction) => incomingApprovalBaseline(q, sql, correction) });
    return res.json({ success: true, ...result });
  } catch (error) {
    const safe = error.code?.startsWith('APPROVAL_') || error.code?.startsWith('CORRECTION_');
    return res.status(error.statusCode ?? 409).json({ success: false, code: safe ? error.code : 'APPROVAL_FAILED',
      error: safe ? error.message : '요청 처리에 실패했습니다. 처리 이력을 다시 조회해 결과를 확인하세요.' });
  }
});

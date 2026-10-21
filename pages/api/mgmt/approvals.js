// 경영관리 승인요청(결재선) API. web_mgmt 전용. ERP·ecount_work·은행 쓰기 없음.
// GET  ?targetKind=&status=        목록
// POST {action:'create', targetKind, targetRef, payload}
// POST {action:'transition', requestId, to, note}
import { withAuth } from '../../../lib/auth.js';
import { createApprovalRequest, transitionApproval, listApprovals, APPROVAL_STATUS } from '../../../lib/mgmt/approval.js';

export default withAuth(async function handler(req, res) {
  const actorId = req.user?.userId || '';
  if (req.method === 'GET') {
    const rows = await listApprovals({ targetKind: req.query.targetKind, status: req.query.status, limit: req.query.limit });
    return res.status(200).json({ success: true, rows });
  }
  if (req.method === 'POST') {
    const body = req.body || {};
    if (body.action === 'create') {
      if (!body.targetKind || !body.targetRef) return res.status(400).json({ success: false, error: 'targetKind, targetRef 필수' });
      const requestId = await createApprovalRequest({ targetKind: body.targetKind, targetRef: body.targetRef, payload: body.payload, actorId });
      return res.status(200).json({ success: true, requestId });
    }
    if (body.action === 'transition') {
      if (!APPROVAL_STATUS.includes(body.to)) return res.status(400).json({ success: false, error: `to 값 오류: ${body.to}` });
      try {
        const out = await transitionApproval({ requestId: Number(body.requestId), to: body.to, actorId, note: body.note });
        return res.status(200).json({ success: true, ...out });
      } catch (err) {
        return res.status(409).json({ success: false, error: err.message });
      }
    }
    return res.status(400).json({ success: false, error: 'action 은 create | transition' });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method Not Allowed' });
});

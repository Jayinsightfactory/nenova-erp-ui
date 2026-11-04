// pages/api/pm/staff-requests/[id].js
// 직원 요청 글 수정(PATCH {title?, body?, category?, comment?, status?(관리자)}) — 작성자 본인과 관리자만. 파일 전용.
import { verifyReqUser } from '../../../../lib/auth';
import { isOrbitReportViewer } from '../../../../lib/orbitReportAccess';
import { editStaffRequest } from '../../../../lib/pmStaffRequests';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'PATCH') { res.setHeader('Allow', 'PATCH'); return res.status(405).json({ success: false, error: 'PATCH only' }); }
  const isAdmin = isOrbitReportViewer(user);
  const r = editStaffRequest(String(req.query.id || ''), req.body || {}, user, isAdmin);
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  return res.status(200).json({ success: true, request: { ...r.request, shot: !!r.request.shot, canEdit: true } });
}

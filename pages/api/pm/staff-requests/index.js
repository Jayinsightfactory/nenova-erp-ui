// pages/api/pm/staff-requests/index.js
// /pm "직원 요청" 게시판 — 로그인 직원 누구나 GET(목록)·POST(작성). 수정은 [id].js(작성자·관리자만).
//   파일 전용(data/runtime/pm-staff-requests.json, 스크린샷 data/runtime/pm-staff-shots). MSSQL·ERP 테이블 무관.
import { verifyReqUser } from '../../../../lib/auth';
import { isOrbitReportViewer } from '../../../../lib/orbitReportAccess';
import { addStaffRequest, canEditStaffRequest, listStaffRequests } from '../../../../lib/pmStaffRequests';

export const config = { api: { bodyParser: { sizeLimit: '1mb' } } };

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  res.setHeader('Cache-Control', 'private, no-store');
  const isAdmin = isOrbitReportViewer(user);
  if (req.method === 'GET') {
    const requests = listStaffRequests().slice(0, 200).map((r) => ({ ...r, shot: !!r.shot, canEdit: canEditStaffRequest(r, user, isAdmin) }));
    return res.status(200).json({ success: true, isAdmin, requests });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  const r = addStaffRequest(req.body || {}, user);
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  return res.status(201).json({ success: true, request: { ...r.request, shot: !!r.request.shot, canEdit: true } });
}

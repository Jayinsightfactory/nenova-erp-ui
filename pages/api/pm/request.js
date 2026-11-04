// pages/api/pm/request.js
// /pm "시험 실행 만들기" 요청 — 관리자(UI) 전용. 게이트는 /api/pm/office 와 동일(아니면 404).
//   POST {type:'dry-run', person, dataName, workflow} → data/runtime/pm-requests.json 에 queued 로 추가(같은 사람+업무 진행중이면 기존 건 반환)
//   GET  ?person=  → 그 사람 요청 목록(버튼 상태 표시용)
// 파일 전용(MSSQL 무관). ERP 테이블을 읽거나 쓰지 않는다.
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { addRequest, listRequests } from '../../../lib/pmRequests';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  // 보기(GET)=로그인 직원 전체, 쓰기(POST 등)=관리자만 유지
  if (req.method !== 'GET' && !isOrbitReportViewer(user)) return res.status(403).json({ success: false, error: '관리자 전용' });
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'GET') {
    const person = String(req.query.person || '').trim().slice(0, 40);
    return res.status(200).json({ success: true, requests: listRequests({ person: person || undefined }) });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  const r = addRequest(req.body || {}, user.userId || user.UserID || '');
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  return res.status(r.duplicate ? 200 : 201).json({ success: true, duplicate: r.duplicate, request: r.request });
}

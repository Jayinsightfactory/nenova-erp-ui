// pages/api/pm/requests/index.js
// 사장님 PC PM 루프용 요청 큐 조회 — GET ?status=queued. 인증: ORBIT_DRIVE_INGEST_TOKEN(bearer, feature-data-ingest 와 동일). 파일 전용·읽기 전용.
import { ingestTokenOk, listRequests } from '../../../../lib/pmRequests';
import { listStaffRequests } from '../../../../lib/pmStaffRequests';
// ?kind=staff → /pm 직원 요청 게시판 글(PM 루프 nenova-pm/pm-staff.js 가 분류·처리). 파일 전용·읽기 전용.

export default function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  const t = ingestTokenOk(req);
  if (!t.ok) return res.status(t.status).json({ success: false, error: t.error });
  res.setHeader('Cache-Control', 'no-store');
  const status = String(req.query.status || '').trim().slice(0, 20);
  if (req.query.kind === 'staff') return res.status(200).json({ success: true, requests: listStaffRequests({ status: status || undefined }) });
  return res.status(200).json({ success: true, requests: listRequests({ status: status || undefined }) });
}

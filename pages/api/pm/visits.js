// pages/api/pm/visits.js
// /pm 접속 기록 조회 — 사장님 PC PM 루프(nenova-pm/pm-vision.js)가 P0 관문(직원 70% 주2회 접속 4주)을 계산할 때 읽는다.
// 인증: ORBIT_DRIVE_INGEST_TOKEN(bearer) — /api/pm/requests 와 동일. 파일 전용·읽기 전용, MSSQL 무관.
import { ingestTokenOk } from '../../../lib/pmRequests';
import { readVisits } from '../../../lib/pmVisits';

export default function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  const t = ingestTokenOk(req);
  if (!t.ok) return res.status(t.status).json({ success: false, error: t.error });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ success: true, visits: readVisits() });
}

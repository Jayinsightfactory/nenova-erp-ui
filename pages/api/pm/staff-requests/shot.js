// pages/api/pm/staff-requests/shot.js
// 직원 요청 스크린샷 보기 — GET ?id=. 로그인 직원 또는 PM 토큰(ORBIT_DRIVE_INGEST_TOKEN). 파일 전용·읽기 전용.
import fs from 'fs';
import { verifyReqUser } from '../../../../lib/auth';
import { ingestTokenOk } from '../../../../lib/pmRequests';
import { staffShotFile } from '../../../../lib/pmStaffRequests';

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  const tokenOk = String(req.headers.authorization || '').startsWith('Bearer ') && ingestTokenOk(req).ok;
  if (!tokenOk && !(await verifyReqUser(req, res))) return res.status(401).json({ success: false, error: '로그인 필요' });
  const f = staffShotFile(String(req.query.id || ''));
  if (!f) return res.status(404).json({ success: false, error: '스크린샷 없음' });
  res.setHeader('Content-Type', f.type);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.status(200).send(fs.readFileSync(f.path));
}

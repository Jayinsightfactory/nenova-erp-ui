// pages/api/pm/avatars.js
// /pm 직원 캐릭터 꾸미기 저장 — 게이트는 /api/pm/office 와 동일(아니면 404).
//   GET            → { avatars } 전 직원 꾸미기
//   POST {name, char, items} → data/runtime/pm-avatars.json 에 저장(빈 값이면 삭제)
// 파일 전용(MSSQL 무관). ERP 테이블을 읽거나 쓰지 않는다.
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { readAvatars, saveAvatar } from '../../../lib/pmAvatars';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!isOrbitReportViewer(user)) return res.status(404).json({ success: false, error: 'Not found' });
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method === 'GET') return res.status(200).json({ success: true, avatars: readAvatars() });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  const b = req.body || {};
  const r = saveAvatar(b.name, b, user.userId || user.UserID || '');
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  return res.status(200).json({ success: true, avatar: r.avatar });
}

// pages/api/pm/freepass.js — /pm 꾸미기 1주일 자유이용권. 파일 전용(data/runtime/pm-freepass.json, MSSQL 무관).
//   GET                         → { default, people: {직원: pass} } (로그인 직원)
//   POST {name|'*', start, days} → 관리자만 재지급·기간 조정. 토큰 잔액·구매 기록은 건드리지 않음.
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { grantPass, passOf, readPasses, writePasses } from '../../../lib/pmFreePass';
import { readGrowState } from '../../../lib/pmGrowStore';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  res.setHeader('Cache-Control', 'private, no-store');
  const passes = readPasses();
  const now = Date.now();
  if (req.method === 'GET') {
    const people = {};
    for (const n of new Set([...Object.keys(readGrowState()?.people || {}), ...Object.keys(passes.people)])) people[n] = passOf(n, passes, now);
    return res.status(200).json({ success: true, default: passes.default, people });
  }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ success: false, error: 'Method not allowed' }); }
  if (!isOrbitReportViewer(user)) return res.status(403).json({ success: false, error: '관리자 전용' });
  const b = req.body || {};
  const r = grantPass(passes, b.name === '*' ? '*' : String(b.name || ''), { start: b.start, days: b.days, by: user.userId || user.UserID || '' });
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  writePasses(r.passes);
  return res.status(200).json({ success: true, default: r.passes.default, people: r.passes.people });
}

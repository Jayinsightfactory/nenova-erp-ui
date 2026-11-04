// pages/api/pm/timesave.js
// /pm 업무 시간 계기판·네노바웹 기능 후보 — runtime work-feature-timesave.json 요약(+나이). 게이트는 /api/pm/office 와 동일. 파일 전용·읽기 전용.
import fs from 'fs';
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { featureFilePath } from '../../../lib/workFeatureData';
import { timesaveSummary } from '../../../lib/pmTimesave';
import { buildCorridor } from '../../../lib/pmStages';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  // 보기(GET)=로그인 직원 전체, 쓰기(POST 등)=관리자만 유지
  if (req.method !== 'GET' && !isOrbitReportViewer(user)) return res.status(403).json({ success: false, error: '관리자 전용' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  res.setHeader('Cache-Control', 'private, no-store');
  let ts = null;
  try { ts = JSON.parse(fs.readFileSync(featureFilePath('timesave'), 'utf8')); } catch { ts = null; }
  const s = timesaveSummary(ts);
  if (s) s.corridor = buildCorridor(ts.people); // 복도 9단계: 업무 이름 키워드 규칙 매핑(미확인 별도)
  const gen = s?.generatedAt ? Date.parse(s.generatedAt) : NaN;
  return res.status(200).json({ success: true, ageSec: Number.isFinite(gen) ? Math.max(0, Math.round((Date.now() - gen) / 1000)) : null, data: s });
}

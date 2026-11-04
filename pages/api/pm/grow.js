// pages/api/pm/grow.js — /pm 키우기 미니게임 상태(직원 단계·진행률·오늘 원인·부서 정원). 게이트는 /api/pm/office 와 동일. 읽기 전용.
// 계산은 피드 수신 시 서버(lib/pmGrowStore)에서만 한다. 급여·평가 무관.
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { readGrowState } from '../../../lib/pmGrowStore';
import { growView } from '../../../lib/pmGrow';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  // 보기(GET)=로그인 직원 전체, 쓰기(POST 등)=관리자만 유지
  if (req.method !== 'GET' && !isOrbitReportViewer(user)) return res.status(403).json({ success: false, error: '관리자 전용' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ success: true, data: growView(readGrowState(), Date.now()) });
}

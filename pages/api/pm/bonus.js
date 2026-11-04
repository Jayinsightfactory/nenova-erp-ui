// pages/api/pm/bonus.js — /pm 효율 보상 '기록만' 보기(기준선·판정·팀 퀘스트). 게이트는 /api/pm/office 와 동일(사장님만). 읽기 전용.
// 보상 지급은 PM_BONUS_ENABLED=1 일 때만(기본 OFF). 품질 신호(재수정·무결성·반려)가 아직 연결 안 돼 판정은 '판정 불가'가 기본.
import fs from 'fs';
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { featureFilePath } from '../../../lib/workFeatureData';
import { bonusView } from '../../../lib/pmBonus';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  // 보기(GET)=로그인 직원 전체, 쓰기(POST 등)=관리자만 유지
  if (req.method !== 'GET' && !isOrbitReportViewer(user)) return res.status(403).json({ success: false, error: '관리자 전용' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  res.setHeader('Cache-Control', 'private, no-store');
  let office = null;
  try { office = JSON.parse(fs.readFileSync(featureFilePath('pm-office'), 'utf8')); } catch { office = null; }
  const d = office?.data || office || {};
  return res.status(200).json({ success: true, data: bonusView(d.workLog || [], Date.now()) });
}

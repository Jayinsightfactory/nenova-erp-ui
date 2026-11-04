// pages/api/pm/radar.js
// /pm/radar 기술 레이더 데이터 — 사장님 PC(nenova-pm/github-radar/radar.js)가 월·목 07:30 POST /api/work/feature-data-ingest (name=tech-radar) 로
// 올린 data/runtime/work-feature-tech-radar.json 을 그대로 돌려준다. 파일 전용·읽기 전용, MSSQL 무관. 보기=로그인 직원 전체.
import fs from 'fs';
import { verifyReqUser } from '../../../lib/auth';
import { featureFilePath } from '../../../lib/workFeatureData';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  res.setHeader('Cache-Control', 'private, no-store');
  let data = null;
  try { data = JSON.parse(fs.readFileSync(featureFilePath('tech-radar'), 'utf8')); } catch { data = null; }
  return res.status(200).json({ success: true, data });
}

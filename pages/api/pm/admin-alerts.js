// pages/api/pm/admin-alerts.js
// 데스크톱앱 "관리자 알림" 새 창 데이터 — PM이 스스로 해결 못 해 사장님 승인·확인이 필요한 일.
// pm-office 피드(파일 전용·읽기 전용, MSSQL 무관)에서 파생한다. 관리자 계정(isOrbitReportViewer)만, 그 외는 404 은닉.
import fs from 'fs';
import { verifyReqUser } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { featureFilePath } from '../../../lib/workFeatureData';
import { pmAlertCards } from '../../../lib/pmUnresolved';

export default async function handler(req, res) {
  const user = await verifyReqUser(req, res);
  if (!user) return res.status(401).json({ success: false, error: '로그인 필요' });
  if (!isOrbitReportViewer(user)) return res.status(404).json({ success: false, error: 'Not found' });
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: 'GET only' }); }
  res.setHeader('Cache-Control', 'private, no-store');
  const f = featureFilePath('pm-office');
  let data = null; let mtime = null;
  try { mtime = fs.statSync(f).mtimeMs; data = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { data = null; }
  const gen = data?.generatedAt ? Date.parse(data.generatedAt) : NaN;
  const base = Number.isFinite(gen) ? gen : mtime;
  let alerts = [];
  try { alerts = pmAlertCards(data?.tasks); } catch { alerts = []; }
  return res.status(200).json({ success: true, ageSec: base ? Math.max(0, Math.round((Date.now() - base) / 1000)) : null, alerts });
}

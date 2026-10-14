// pages/api/work/drive-pairs.js
// 업무 드라이브 인보이스 PDF ↔ 결과 엑셀 짝 목록 — 관리자 전용(사장·WORK_DRIVE_ADMIN_USER_IDS). 파일만 읽음(MSSQL 무관).
// GET                → { generatedAt, summary, pairs[] }  (data/drive/pairs.json, 없으면 즉시 계산)
// GET ?status=confirmed|candidate  → 해당 상태만
// POST { action:'recompute' } → 색인 기준 전체 재계산(내용 캐시 pair-features.json 사용)
import { withAuth } from '../../../lib/auth';
import { isOrbitReportViewer } from '../../../lib/orbitReportAccess';
import { WORK_DRIVE_ADMIN_USER_IDS } from '../../../lib/workDrive';
import { readPairs, recomputePairs } from '../../../lib/workDrivePairs';

const isAdmin = (u) => isOrbitReportViewer(u) || WORK_DRIVE_ADMIN_USER_IDS.includes(String(u?.userId || '').trim());

export default withAuth(async function handler(req, res) {
  if (!isAdmin(req.user)) return res.status(403).json({ success: false, error: '관리자 전용' });
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const data = readPairs() || recomputePairs();
    const st = String(req.query.status || '');
    const pairs = st ? data.pairs.filter((p) => p.status === st) : data.pairs;
    return res.status(200).json({ success: true, generatedAt: data.generatedAt, summary: data.summary, pairs });
  }
  if (req.method === 'POST' && (req.body || {}).action === 'recompute') {
    const data = recomputePairs();
    return res.status(200).json({ success: true, generatedAt: data.generatedAt, summary: data.summary });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
});

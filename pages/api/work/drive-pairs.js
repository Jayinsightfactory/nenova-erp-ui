// pages/api/work/drive-pairs.js
// 업무 드라이브 인보이스 PDF ↔ 결과 엑셀 짝 목록 — 관리자(사장·드라이브 관리자) 전용. 골든테스트(nenova-work-features)가 내려받는다.
// GET                    → { generatedAt, counts{confirmed,candidate}, invoices, workbooks, pairs[] }  (?status=confirmed|candidate 필터)
// POST { action:'recompute' } → data/drive/index.jsonl 기준 일괄 재계산 후 같은 형식 반환
// 파일 본체는 기존 GET /api/work/drive?download=<id> 로 받는다(내려받기 기록 유지). MSSQL 무관.
import * as XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { isDriveAdmin } from '../../../lib/workDrive';
import { readPairs, recomputePairs } from '../../../lib/workDrivePairs';

export default withAuth(async function handler(req, res) {
  if (!isDriveAdmin(req.user)) return res.status(403).json({ success: false, error: '관리자 전용' });
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') {
    const doc = readPairs() || recomputePairs({ xlsxLib: XLSX });
    const st = String(req.query.status || '');
    const pairs = st ? doc.pairs.filter((p) => p.status === st) : doc.pairs;
    return res.status(200).json({ success: true, ...doc, pairs });
  }
  if (req.method === 'POST') {
    if ((req.body || {}).action !== 'recompute') return res.status(400).json({ success: false, error: 'action=recompute 만 지원' });
    return res.status(200).json({ success: true, ...recomputePairs({ xlsxLib: XLSX }) });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
});

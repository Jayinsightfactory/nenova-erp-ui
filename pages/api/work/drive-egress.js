// pages/api/work/drive-egress.js — 업무 파일 유출 이력(복사·인쇄·이메일·웹업로드·카톡) 수신/조회. 차단 없음, 기록만.
//   POST (데몬, ORBIT_DRIVE_INGEST_TOKEN 토큰) { events:[{kind, filename, sha?, size?, dest?, destKind?, app?, detail?, at?, dedupKey?, orbitUserId, userName, hostname}] } → { ok, accepted, dup }
//   GET  (로그인, 관리자만) ?days=30&kind=&who=&fileId=&q=      → { rows }     ?timeline=<fileId> → { timeline }
//        ?preview=<egressId> → 나간 파일 내용(시트 첫 행들)   ?open=<egressId> → 나간 파일 자체 내려받기(기록 남김)   (2026-09-27 사장 지시: 무엇이 나갔는지 보이고 파일을 열 수 있어야)
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { recordEgress, listEgress, fileTimeline, egressPreview, egressOpen, EGRESS_KINDS } from '../../../lib/workDrive';

function tokenOk(req) {
  const want = process.env.ORBIT_DRIVE_INGEST_TOKEN || '';
  if (!want) return false;
  const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || String(req.headers['x-orbit-ingest-token'] || '').trim();
  if (!got) return false;
  const a = Buffer.from(got), b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const authed = withAuth(async function get(req, res) {
  const user = req.user || {};
  if (req.query.timeline) return res.status(200).json({ success: true, timeline: fileTimeline(user, String(req.query.timeline)) });
  if (req.query.preview) { const p = egressPreview(user, String(req.query.preview), { xlsxLib: XLSX }); return res.status(p.ok ? 200 : p.status || 400).json({ success: p.ok, ...p }); }
  if (req.query.open) {
    const g = egressOpen(user, String(req.query.open));
    if (!g) return res.status(404).json({ success: false, error: '원본 파일 없음(데몬이 못 찾았거나 권한 없음)' });
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(g.row.filename))}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(g.row.size || fs.statSync(g.abs).size));
    return fs.createReadStream(g.abs).pipe(res);
  }
  const rows = listEgress(user, { days: req.query.days, kind: String(req.query.kind || ''), who: String(req.query.who || ''), fileId: String(req.query.fileId || ''), q: String(req.query.q || '') });
  return res.status(200).json({ success: true, kinds: EGRESS_KINDS, rows });
});

export default async function handler(req, res) {
  if (req.method === 'POST') {
    if (!tokenOk(req)) return res.status(401).json({ success: false, error: '토큰' });
    const b = req.body || {}; const events = Array.isArray(b.events) ? b.events : (b.kind ? [b] : []);
    if (!events.length) return res.status(400).json({ success: false, error: 'events 필요' });
    let accepted = 0, dup = 0; const errors = [];
    for (const e of events.slice(0, 200)) { const r = recordEgress(e); if (r.ok) { if (r.dup) dup++; else accepted++; } else errors.push(r.error); }
    return res.status(200).json({ success: true, accepted, dup, errors });
  }
  if (req.method === 'GET') return authed(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

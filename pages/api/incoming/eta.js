// pages/api/incoming/eta.js
// 입고 예정(ETA) 보드 — 웹 전용 파일 저장(data/incoming-eta.json). 전산 DB는 읽기만(원장 존재 여부로 '입고등록' 자동 판정).
//   GET  ?year=&week=            → 해당 차수(없으면 진행 중 전체) 예정 목록 + 원장 매칭
//   POST { id?, year, week, farm, country?, awb?, eta?, stage?, note? } → 추가/수정 (stage: 발주|선적|통관중|도착|입고등록)
//   POST { id, deleted:true }    → 삭제(숨김)
import fs from 'fs';
import path from 'path';
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderWeek } from '../../../lib/orderUtils';

import { listVisible } from '../../../lib/workDrive';

const FILE = path.join(process.cwd(), 'data', 'incoming-eta.json');
// 드라이브 자동 인식: 수입부(가브리엘)가 매 선적마다 만드는 운임 시트 파일명 규칙 `33-02_Apollo_AWB_006-45462001.xlsx`
//   → 차수·포워더·AWB. 연도는 파일명에 없어 업로드 시각(mtime)의 연도로 본다. 이미 등록된 AWB(또는 원장 AWB)면 제안하지 않는다.
const AWB_FILE_RE = /^(\d{2})-(\d{2})_(.+?)_AWB_?\.?\s?([\d.\- ]{8,})/i;
// IATA 항공사 접두 3자리 → 항공사(실제 AWB에서 확인된 것만; 모르면 빈 값)
const AWB_PREFIX = { '006': 'Delta', '160': 'Cathay Pacific', '157': 'Qatar Airways', '180': 'Korean Air', '217': 'Thai Airways', '235': 'Turkish Airlines' };
export function parseAwbFilename(name) {
  const m = AWB_FILE_RE.exec(String(name || '').trim()); if (!m) return null;
  const awb = m[4].replace(/[^\d]/g, ''); if (awb.length < 11) return null;
  if (Number(m[1]) < 1 || Number(m[1]) > 53 || Number(m[2]) < 1 || Number(m[2]) > 9) return null; // 차수 오타(06-45 등)는 제안하지 않음
  const pretty = `${awb.slice(0, 3)}-${awb.slice(3, 11)}`;
  return { week: `${m[1]}-${m[2]}`, forwarder: m[3].replace(/_/g, ' ').trim(), awb: pretty, airline: AWB_PREFIX[awb.slice(0, 3)] || '' };
}
function driveSuggestions(user, known) {
  const out = new Map();
  let files = []; try { files = listVisible(user); } catch { return []; }
  for (const f of files) {
    const p = parseAwbFilename(f.filename); if (!p || known.has(p.awb.replace(/\D/g, ''))) continue;
    const year = Number(String(f.mtime || f.uploadedAt || '').slice(0, 4)) || new Date().getFullYear();
    const k = `${year}|${p.week}|${p.awb}`;
    if (!out.has(k)) out.set(k, { id: 'drive-' + f.id, source: 'drive', year, week: p.week, farm: p.forwarder, country: '', awb: p.awb, airline: p.airline, eta: '', stage: '선적', note: `드라이브 자동 인식 · ${f.uploaderName || ''} · ${f.filename}`, fileId: f.id, fileAt: String(f.mtime || f.uploadedAt || '').slice(0, 10) });
  }
  return [...out.values()];
}
const STAGES = ['발주', '선적', '통관중', '도착', '입고등록'];
const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const write = (rows) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(rows, null, 2), 'utf8'); };
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export default withAuth(async function handler(req, res) {
  const user = req.user || {};
  if (req.method === 'GET') {
    const week = req.query.week ? normalizeOrderWeek(req.query.week) : '';
    const year = String(req.query.year || '');
    let rows = read().filter((r) => !r.deleted);
    if (year && week) rows = rows.filter((r) => String(r.year) === year && r.week === week);
    else rows = rows.filter((r) => r.stage !== '입고등록');
    // 원장 매칭: 같은 연도·차수·농장(대소문자/공백 무시)의 WarehouseMaster가 있으면 입고등록으로 본다
    const keys = [...new Set(rows.map((r) => `${r.year}|${r.week}`))];
    const found = new Map();
    for (const k of keys) {
      const [y, w] = k.split('|');
      try {
        const r = await query(`SELECT FarmName, COUNT(*) AS n, MAX(CONVERT(NVARCHAR(10), InputDate, 120)) AS lastInput FROM WarehouseMaster WHERE OrderYear=@yr AND OrderWeek=@wk AND ISNULL(isDeleted,0)=0 GROUP BY FarmName`,
          { yr: { type: sql.Int, value: parseInt(y, 10) }, wk: { type: sql.NVarChar, value: w } });
        for (const x of r.recordset) found.set(`${k}|${norm(x.FarmName)}`, { n: x.n, lastInput: x.lastInput });
      } catch {}
    }
    const today = new Date().toISOString().slice(0, 10);
    const out = rows.map((r) => {
      const m = found.get(`${r.year}|${r.week}|${norm(r.farm)}`) || null;
      const stage = m ? '입고등록' : r.stage || '발주';
      const late = !m && r.eta && r.eta < today && stage !== '도착';
      return { ...r, stage, matched: m, late };
    }).sort((a, b) => (a.eta || '9999').localeCompare(b.eta || '9999'));
    // 드라이브 AWB 시트 제안: 등록된 AWB·삭제(거절)된 AWB·원장에 이미 있는 AWB는 제외
    const known = new Set(read().map((r) => String(r.awb || '').replace(/\D/g, '')).filter(Boolean));
    let suggested = driveSuggestions(user, known).filter((s) => !(year && week) || (String(s.year) === year && s.week === week));
    if (suggested.length) {
      const wk = [...new Set(suggested.map((s) => `${s.year}|${s.week}`))];
      const inLedger = new Set();
      for (const k of wk) {
        const [y, w] = k.split('|');
        try {
          const r = await query(`SELECT OrderNo AS AWB FROM WarehouseMaster WHERE OrderYear=@yr AND OrderWeek=@wk AND ISNULL(isDeleted,0)=0 AND OrderNo IS NOT NULL`, { yr: { type: sql.Int, value: parseInt(y, 10) }, wk: { type: sql.NVarChar, value: w } });
          for (const x of r.recordset) inLedger.add(String(x.AWB || '').replace(/\D/g, ''));
        } catch {}
      }
      suggested = suggested.filter((s) => !inLedger.has(s.awb.replace(/\D/g, ''))).sort((a, b) => (b.fileAt || '').localeCompare(a.fileAt || ''));
    }
    return res.status(200).json({ success: true, stages: STAGES, rows: out, suggested });
  }
  if (req.method === 'POST') {
    const b = req.body || {};
    const rows = read();
    if (b.id && b.deleted) { const i = rows.findIndex((r) => r.id === b.id); if (i < 0) return res.status(404).json({ success: false, error: '없음' }); rows[i] = { ...rows[i], deleted: true, updatedAt: new Date().toISOString(), updatedBy: user.userId || '' }; write(rows); return res.status(200).json({ success: true }); }
    if (b.dismiss && b.awb) { // 드라이브 제안 거절: AWB만 숨김 행으로 남겨 다시 제안되지 않게
      rows.push({ id: `eta-${Date.now().toString(36)}`, awb: String(b.awb).trim(), deleted: true, dismissed: true, updatedAt: new Date().toISOString(), updatedBy: user.userId || '' }); write(rows); return res.status(200).json({ success: true });
    }
    const week = normalizeOrderWeek(b.week || '');
    if (!/^\d{4}$/.test(String(b.year || '')) || !week || !String(b.farm || '').trim()) return res.status(400).json({ success: false, error: 'year·week·farm 필요' });
    if (b.stage && !STAGES.includes(b.stage)) return res.status(400).json({ success: false, error: 'stage 값 오류' });
    if (b.eta && !/^\d{4}-\d{2}-\d{2}$/.test(b.eta)) return res.status(400).json({ success: false, error: 'eta는 YYYY-MM-DD' });
    const now = new Date().toISOString();
    const row = { id: b.id || `eta-${Date.now().toString(36)}`, year: Number(b.year), week, farm: String(b.farm).trim(), country: String(b.country || '').trim(), awb: String(b.awb || '').trim(), airline: String(b.airline || '').trim(), flight: String(b.flight || '').trim().slice(0, 40), eta: b.eta || '', stage: b.stage || '발주', note: String(b.note || '').slice(0, 300), updatedAt: now, updatedBy: user.userId || '' };
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = { ...rows[i], ...row, createdAt: rows[i].createdAt }; else rows.push({ ...row, createdAt: now, createdBy: user.userId || '' });
    write(rows);
    return res.status(200).json({ success: true, row });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
});

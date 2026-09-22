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

const FILE = path.join(process.cwd(), 'data', 'incoming-eta.json');
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
    return res.status(200).json({ success: true, stages: STAGES, rows: out });
  }
  if (req.method === 'POST') {
    const b = req.body || {};
    const rows = read();
    if (b.id && b.deleted) { const i = rows.findIndex((r) => r.id === b.id); if (i < 0) return res.status(404).json({ success: false, error: '없음' }); rows[i] = { ...rows[i], deleted: true, updatedAt: new Date().toISOString(), updatedBy: user.userId || '' }; write(rows); return res.status(200).json({ success: true }); }
    const week = normalizeOrderWeek(b.week || '');
    if (!/^\d{4}$/.test(String(b.year || '')) || !week || !String(b.farm || '').trim()) return res.status(400).json({ success: false, error: 'year·week·farm 필요' });
    if (b.stage && !STAGES.includes(b.stage)) return res.status(400).json({ success: false, error: 'stage 값 오류' });
    if (b.eta && !/^\d{4}-\d{2}-\d{2}$/.test(b.eta)) return res.status(400).json({ success: false, error: 'eta는 YYYY-MM-DD' });
    const now = new Date().toISOString();
    const row = { id: b.id || `eta-${Date.now().toString(36)}`, year: Number(b.year), week, farm: String(b.farm).trim(), country: String(b.country || '').trim(), awb: String(b.awb || '').trim(), eta: b.eta || '', stage: b.stage || '발주', note: String(b.note || '').slice(0, 300), updatedAt: now, updatedBy: user.userId || '' };
    const i = rows.findIndex((r) => r.id === row.id);
    if (i >= 0) rows[i] = { ...rows[i], ...row, createdAt: rows[i].createdAt }; else rows.push({ ...row, createdAt: now, createdBy: user.userId || '' });
    write(rows);
    return res.status(200).json({ success: true, row });
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ success: false, error: 'Method not allowed' });
});

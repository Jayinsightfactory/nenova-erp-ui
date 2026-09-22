// lib/awbFreightCalc.js — AWB 운임 계산기 결과 저장(웹 전용 파일 data/awb-freight-calc.json). 전산·도착원가 테이블에는 쓰지 않는다.
//   키 = year|week|awb(숫자만). 저장 단위 = 계산 1회(입력값 + 품목군/농장 분배 + 오류 확인). 같은 키 재저장은 덮어쓰고 이전 것은 history에 남긴다.
//   정산(ledger)에서는 농장별 백상+선율(KRW)을 '국내비용(계산기)'로 합산해 보여준다 — 통관비 정본 규칙 확정 전 참고값.
import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'data', 'awb-freight-calc.json');
export const calcKey = (year, week, awb) => `${year}|${week}|${String(awb || '').replace(/\D/g, '')}`;
export function readCalcs() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { current: {}, history: [] }; } }
export function writeCalcs(db) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 2), 'utf8'); }

export function saveCalc(db, rec, by = '') {
  const key = calcKey(rec.year, rec.week, rec.awb);
  const prev = db.current[key]; if (prev) db.history.unshift({ ...prev, replacedAt: new Date().toISOString(), replacedBy: by });
  if (db.history.length > 500) db.history.length = 500;
  db.current[key] = { key, year: Number(rec.year), week: String(rec.week), awb: String(rec.awb || ''), inputs: rec.inputs || {}, groups: rec.groups || [], farms: (rec.farms || []).map((f) => ({ farm: f.farm, box: f.box, kg: f.kg, freightUSD: f.freightUSD, storage: f.storage, pct: f.pct, sunyul: f.sunyul, total: f.total, totalUSD: f.totalUSD })), checks: rec.checks || [], allOk: (rec.checks || []).every((c) => c.ok), savedAt: new Date().toISOString(), savedBy: by };
  return db.current[key];
}
export function removeCalc(db, year, week, awb) { const k = calcKey(year, week, awb); const prev = db.current[k]; if (prev) { db.history.unshift({ ...prev, removedAt: new Date().toISOString() }); delete db.current[k]; } return !!prev; }
export function listCalcs(db, { year, week } = {}) {
  return Object.values(db.current).filter((r) => (!year || String(r.year) === String(year)) && (!week || r.week === week)).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
// 정산용: 농장(대표명) → { krw, usd, awbs:Set, byWeek:{week:krw} }  (canon = 별칭 사전 함수)
export function domesticByFarm(db, canon = (s) => s, sinceISO = '') {
  const out = {};
  for (const r of Object.values(db.current)) {
    if (sinceISO && r.savedAt < sinceISO) continue;
    for (const f of r.farms) { const n = canon(f.farm); const o = out[n] || (out[n] = { krw: 0, usd: 0, awbs: new Set(), byWeek: {} }); o.krw += f.total || 0; o.usd += f.totalUSD || 0; o.awbs.add(r.awb); const wk = `${r.year}-${r.week}`; o.byWeek[wk] = (o.byWeek[wk] || 0) + (f.total || 0); }
  }
  for (const o of Object.values(out)) { o.krw = Math.round(o.krw); o.usd = Math.round(o.usd * 100) / 100; o.awbs = o.awbs.size; }
  return out;
}

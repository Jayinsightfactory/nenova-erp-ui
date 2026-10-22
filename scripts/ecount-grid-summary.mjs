// survey-run.mjs GRID=1 캡처(로컬 폴더, 원값 포함·git 밖)를 저장소용 안전 요약으로 바꾼다: 화면별 머리글, 행수, 숫자 열 합계의 sha256(원값 미저장).
// 4개 수집 데이터셋(ar/ap/cash/sales)은 같은 시각의 ECOUNT 스냅샷과 행수·숫자합을 대조해 원본 화면 ⟷ 스냅샷 일치 여부를 함께 남긴다.
// Usage: node scripts/ecount-grid-summary.mjs <grid-dir> [--out data/ecount-workbench/evidence/<date>-source-grid.json]
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const dir = process.argv[2];
const args = process.argv.slice(3);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : `data/ecount-workbench/evidence/${new Date().toISOString().slice(0, 10)}-source-grid.json`;
const num = v => { const t = String(v ?? '').replace(/,/g, '').trim(); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null; };
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

const results = {};
for (const f of fs.readdirSync(dir).filter(f => /^E\d{6}\.json$/.test(f))) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const g = j.result?.grids?.[0];
  if (!g) { results[j.program] = { observedAt: j.observedAt, clicked: j.result?.clicked ?? null, grid: null }; continue; }
  const width = Math.max(g.heads.length, ...g.rows.map(r => r.length));
  const sums = Array.from({ length: width }, (_, i) => { const vals = g.rows.map(r => num(r[i])).filter(v => v !== null); return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null; });
  results[j.program] = {
    observedAt: j.observedAt, clicked: j.result.clicked, title: j.result.t,
    heads: g.heads, rowCount: g.rows.length, numericColumns: sums.filter(v => v !== null).length,
    numericSumsHash: hash(sums), footRows: g.foot.length,
  };
}
fs.writeFileSync(out, JSON.stringify({ kind: 'ecount-source-grid', observedOn: new Date().toISOString().slice(0, 10), privacy: 'headers, row counts and hashes only; raw cell values stay in the local capture folder', results }, null, 1) + '\n');
for (const [p, r] of Object.entries(results)) console.log(p, r.rowCount ?? 'no-grid', (r.heads || []).join('|').slice(0, 160));

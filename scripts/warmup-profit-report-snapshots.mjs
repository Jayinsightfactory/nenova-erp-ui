// 매출이익 보고서 계산 결과 스냅샷 워밍업 — 과거 차수를 1차부터 순차 계산해 WebProfitReportSnapshot 에 저장한다.
// 지문이 같은 차수는 건너뛴다. 차수 사이에 쉬어 DB 부하를 낮춘다. ERP 테이블은 SELECT 만.
// 계산식 지문은 배포 빌드와 같은 규칙(lib/profitReportCalcHash.cjs)으로 계산하므로 운영과 같은 코드(master)에서 실행할 것.
//   node scripts/warmup-profit-report-snapshots.mjs --year 2026 --from 1 --to 40 [--pause 1500] --apply
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

// Next(webpack) 전용 import 문법(확장자 생략·JSON import)을 node 에서 해석하기 위한 최소 훅
register('data:text/javascript,' + encodeURIComponent(`
import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if (spec.startsWith('.')) { for (const ext of ['.js', '/index.js']) { try { return await next(spec + ext, ctx); } catch {} } }
    throw e;
  }
}
export async function load(url, ctx, next) {
  if (url.endsWith('.json')) return { format: 'json', source: fs.readFileSync(fileURLToPath(url)), shortCircuit: true };
  return next(url, ctx);
}`));

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const year = String(arg('year', new Date().getFullYear()));
const from = Number(arg('from', 1));
const to = Number(arg('to', 52));
const pauseMs = Number(arg('pause', 1500));
const apply = process.argv.includes('--apply');

const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}
const calc = (await import('../lib/profitReportCalcHash.cjs')).default;
process.env.PROFIT_REPORT_CALC_HASH = calc.computeProfitReportCalcHash(root);
console.log(`calcVersion ${process.env.PROFIT_REPORT_CALC_HASH} · ${year} ${from}~${to}차 · ${apply ? 'APPLY' : 'DRY RUN(--apply 없으면 저장 안 함)'}`);
if (!apply) process.exit(0);

const api = await import('../pages/api/sales/profit-report.js');
const S = await import('../lib/profitReportSnapshot.js');
const majors = [];
for (let m = from; m <= to; m += 1) majors.push(String(m).padStart(2, '0'));
const results = await S.warmupProfitReportSnapshots(year, majors, api.loadReportData, {
  pauseMs, actor: 'warmup-script', log: (r) => console.log(JSON.stringify(r)),
});
const saved = results.filter((r) => r.action === 'saved').length;
const errors = results.filter((r) => r.action === 'error');
console.log(`done: saved ${saved}, skip ${results.filter((r) => r.action === 'skip').length}, error ${errors.length}`);
process.exit(errors.length ? 1 : 0);

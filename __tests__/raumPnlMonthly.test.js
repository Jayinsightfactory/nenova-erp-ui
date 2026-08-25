import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRaumPnlMonthlySummary, normalizeRaumAssignedMonth, resolveRaumNenovaPct } from '../lib/raumPnlMonthly.js';

assert.equal(resolveRaumNenovaPct(undefined), 80);
assert.equal(resolveRaumNenovaPct(''), 80);
assert.equal(resolveRaumNenovaPct(0), 0);
assert.equal(resolveRaumNenovaPct('0'), 0);
assert.equal(normalizeRaumAssignedMonth('', '2026'), null);
assert.equal(normalizeRaumAssignedMonth('2026-08', '2026'), '2026-08');
assert.throws(() => normalizeRaumAssignedMonth('2025-08', '2026'), /해당 차수 연도/);
assert.throws(() => normalizeRaumAssignedMonth('2026-13', '2026'), /YYYY-MM/);

const summary = buildRaumPnlMonthlySummary([
  { OrderYear: '2026', MajorWeek: '30', QuoteDate: '2026-07-28', SaleTotal: 1000, PnlSaleTotal: 900, CostTotal: 600, ProfitTotal: 300, ConsignedSale: 100, NenovaPct: 80, MissingCost: 1 },
  { OrderYear: '2026', MajorWeek: '31', QuoteDate: '2026-07-31T00:00:00.000Z', SaleTotal: 2000, PnlSaleTotal: 2000, CostTotal: 1200, ProfitTotal: 800, NenovaPct: 75, MissingCost: 0 },
  { OrderYear: '2025', MajorWeek: '31', QuoteDate: '2025-07-31', SaleTotal: 500, PnlSaleTotal: 500, CostTotal: 250, ProfitTotal: 250, NenovaPct: 80 },
  { OrderYear: '2026', MajorWeek: '32', QuoteDate: null, SaleTotal: 300, PnlSaleTotal: 300, CostTotal: 100, ProfitTotal: 200, NenovaPct: 0 },
  { OrderYear: '2026', MajorWeek: '33', QuoteDate: '2026-08-01', AssignedMonth: '2026-07', SaleTotal: 400, PnlSaleTotal: 400, CostTotal: 200, ProfitTotal: 200, NenovaPct: 80 },
]);

const july2026 = summary.find(row => row.month === '2026-07');
assert.equal(july2026.count, 3);
assert.equal(july2026.sale, 3400);
assert.equal(july2026.pnlSale, 3300);
assert.equal(july2026.cost, 2000);
assert.equal(july2026.profit, 1300);
assert.equal(july2026.nenova, 1000);
assert.equal(july2026.miu, 300);
assert.equal(july2026.rate, 1300 / 3300);
assert.deepEqual(july2026.weeks, ['2026-30', '2026-31', '2026-33']);

assert.equal(summary.find(row => row.month === '2025-07').sale, 500, '전년도 같은 월을 섞지 않는다');
const undated = summary.find(row => row.month === '2026-날짜미지정');
assert.equal(undated.nenova, 0, '명시된 0%를 기본 80%로 덮지 않는다');
assert.equal(undated.miu, 200);

const fallback = buildRaumPnlMonthlySummary([{ OrderYear: '2026', MajorWeek: 1, QuoteDate: '2026-01-02', SaleTotal: 10, CostTotal: 3, NenovaPct: null }]);
assert.equal(fallback[0].profit, 7, '저장 ProfitTotal이 없으면 손익대상매출-매입으로 계산한다');

const apiSource = fs.readFileSync(new URL('../pages/api/raum/pnl.js', import.meta.url), 'utf8');
const libSource = fs.readFileSync(new URL('../lib/raumPnl.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../docs/migrations/2026-08-24_web_raum_pnl_assigned_month.sql', import.meta.url), 'utf8');
const pageSource = fs.readFileSync(new URL('../pages/raum/pnl.js', import.meta.url), 'utf8');
assert.match(apiSource, /action === 'assign-month'/);
assert.match(libSource, /UPDATE WebRaumPnl SET AssignedMonth=@month[\s\S]*WHERE PnlKey=@key AND isDeleted=0/);
assert.doesNotMatch(libSource.match(/export async function assignRaumPnlMonth[\s\S]*?\n}/)?.[0] || '', /OrderMaster|ShipmentMaster|StockMaster|Estimate/);
assert.match(migration, /COL_LENGTH\('dbo\.WebRaumPnl', 'AssignedMonth'\) IS NULL/);
assert.match(pageSource, /grid-template-columns: minmax\(900px, 1fr\) minmax\(420px, 560px\)/, '넓은 화면에서 차수표와 월별 합계가 독립 열이어야 한다');
assert.match(pageSource, /\.raum-pnl-week-list[\s\S]*overflow-x: auto/, '차수표가 월별 합계 영역을 침범하지 않아야 한다');
assert.match(pageSource, /@media \(max-width: 1420px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/, '좁은 화면에서는 한 열로 쌓여야 한다');
assert.match(pageSource, /colSpan=\{12\}/, '저장 자료가 없어도 차수표 헤더(월 배정·견적일·품목수·총매입·총매출)가 보여야 한다');
assert.match(pageSource, /월별 합계/);

console.log('raumPnlMonthly.test.js passed');

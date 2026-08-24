import assert from 'node:assert/strict';
import { buildRaumPnlMonthlySummary, resolveRaumNenovaPct } from '../lib/raumPnlMonthly.js';

assert.equal(resolveRaumNenovaPct(undefined), 80);
assert.equal(resolveRaumNenovaPct(''), 80);
assert.equal(resolveRaumNenovaPct(0), 0);
assert.equal(resolveRaumNenovaPct('0'), 0);

const summary = buildRaumPnlMonthlySummary([
  { OrderYear: '2026', MajorWeek: '30', QuoteDate: '2026-07-28', SaleTotal: 1000, PnlSaleTotal: 900, CostTotal: 600, ProfitTotal: 300, ConsignedSale: 100, NenovaPct: 80, MissingCost: 1 },
  { OrderYear: '2026', MajorWeek: '31', QuoteDate: '2026-07-31T00:00:00.000Z', SaleTotal: 2000, PnlSaleTotal: 2000, CostTotal: 1200, ProfitTotal: 800, NenovaPct: 75, MissingCost: 0 },
  { OrderYear: '2025', MajorWeek: '31', QuoteDate: '2025-07-31', SaleTotal: 500, PnlSaleTotal: 500, CostTotal: 250, ProfitTotal: 250, NenovaPct: 80 },
  { OrderYear: '2026', MajorWeek: '32', QuoteDate: null, SaleTotal: 300, PnlSaleTotal: 300, CostTotal: 100, ProfitTotal: 200, NenovaPct: 0 },
]);

const july2026 = summary.find(row => row.month === '2026-07');
assert.equal(july2026.count, 2);
assert.equal(july2026.sale, 3000);
assert.equal(july2026.pnlSale, 2900);
assert.equal(july2026.cost, 1800);
assert.equal(july2026.profit, 1100);
assert.equal(july2026.nenova, 840);
assert.equal(july2026.miu, 260);
assert.equal(july2026.rate, 1100 / 2900);
assert.deepEqual(july2026.weeks, ['2026-30', '2026-31']);

assert.equal(summary.find(row => row.month === '2025-07').sale, 500, '전년도 같은 월을 섞지 않는다');
const undated = summary.find(row => row.month === '2026-날짜미지정');
assert.equal(undated.nenova, 0, '명시된 0%를 기본 80%로 덮지 않는다');
assert.equal(undated.miu, 200);

const fallback = buildRaumPnlMonthlySummary([{ OrderYear: '2026', MajorWeek: 1, QuoteDate: '2026-01-02', SaleTotal: 10, CostTotal: 3, NenovaPct: null }]);
assert.equal(fallback[0].profit, 7, '저장 ProfitTotal이 없으면 손익대상매출-매입으로 계산한다');

console.log('raumPnlMonthly.test.js passed');

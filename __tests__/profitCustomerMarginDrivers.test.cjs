const test = require('node:test');
const assert = require('node:assert/strict');
const mod = import('../lib/profitCustomerMarginDrivers.mjs');
const row = (p, c, quantity, price, unitCost = 5, unit = '단') => ({ prodKey: p, custKey: c, quantity, netSales: quantity * price, unitCost, unit });
const near = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-7, `${message}: ${a} != ${b}`);
const profit = rows => rows.reduce((s, r) => s + r.netSales - r.quantity * r.unitCost, 0);
const run = async (previous, current) => (await mod).decomposeCustomerMargin({ previous, current, previousMargin: profit(previous), currentMargin: profit(current) });
test('customer share alone changes margin at fixed product prices/cost/total quantity', async () => {
  const r = await run([row(1, 10, 20, 10), row(1, 11, 80, 20)], [row(1, 10, 80, 10), row(1, 11, 20, 20)]);
  near(r.profitDelta, -600);
  for (const x of r.contributions) near(x.amount, x.key === 'customerMix' ? -600 : 0, x.key);
  near(r.contributions.reduce((s, x) => s + x.percentagePoints, 0), r.marginDeltaPp);
});
test('same product/customer price and cost changes are separated', async () => {
  const r = await run([row(1, 10, 20, 10, 5)], [row(1, 10, 20, 12, 6)]);
  near(r.contributions.find(x => x.key === 'price').amount, 40);
  near(r.contributions.find(x => x.key === 'unitCost').amount, -20);
  near(r.profitDelta, 20);
});
test('volume has profit effect but not percentage-point margin effect', async () => {
  const r = await run([row(1, 10, 20, 10)], [row(1, 10, 40, 10)]);
  near(r.contributions.find(x => x.key === 'volume').amount, 100);
  near(r.contributions.find(x => x.key === 'volume').percentagePoints, 0);
});
test('product mix is distinct from customer mix', async () => {
  const r = await run([row(1, 10, 20, 10), row(2, 10, 80, 20)], [row(1, 10, 80, 10), row(2, 10, 20, 20)]);
  near(r.contributions.find(x => x.key === 'productMix').amount, -600);
  near(r.contributions.find(x => x.key === 'customerMix').amount, 0);
});
test('mixed units do not create a meaningless shared quantity/price', async () => {
  const r = await run([row(1, 10, 1, 10)], [row(1, 10, 1, 10, 5, '박스')]);
  assert.deepEqual(r.warnings, ['MIXED_UNITS']);
  assert.equal(r.contributions.length, 0);
});
test('new/exited customer pairs have no invented past price and are explicit remainder', async () => {
  const previous = [row(1, 10, 20, 10), row(1, 11, 10, 12)];
  const current = [row(1, 10, 20, 10), row(1, 12, 10, 15)];
  const r = await run(previous, current);
  near(r.commonCohort.profitDelta, 0);
  near(r.remainder.newPairsProfit, 100);
  near(r.remainder.exitedPairsProfit, -70);
  near(r.residual, 30);
  assert.equal(r.marginDeltaPp, null);
});
test('missing cost retains price/mix revenue analysis, never treats null as zero', async () => {
  const r = (await mod).decomposeCustomerMargin({ previous: [row(1, 10, 10, 10, null)], current: [row(1, 10, 10, 12, null)] });
  assert.equal(r.profitDelta, null); assert.equal(r.residual, null); assert.equal(r.contributions.length, 0);
  near(r.revenueDrivers.find(x => x.key === 'price').amount, 20);
  assert.equal(r.coverage.pricedCommonPairs, 0);
});
test('actual zero cost is valid; inconsistent customer-specific product costs are rejected', async () => {
  const zero = await run([row(1, 10, 1, 10, 0)], [row(1, 10, 1, 12, 0)]);
  near(zero.profitDelta, 2); assert.equal(zero.coverage.pricedCommonPairs, 1);
  const r = (await mod).decomposeCustomerMargin({ previous: [row(1, 10, 1, 10, 5), row(1, 11, 1, 10, 7)], current: [row(1, 10, 1, 10, 5), row(1, 11, 1, 10, 5)] });
  assert.equal(r.coverage.pricedCommonPairs, 0);
});
test('credits/returns are separate from positive-sale price arithmetic', async () => {
  const r = (await mod).decomposeCustomerMargin({ previous: [row(1, 10, 10, 10), row(1, 11, 0, 0)], current: [row(1, 10, 10, 10), row(1, 11, -1, 10)], previousMargin: 50, currentMargin: 20 });
  near(r.remainder.deductionsReturnsAndOther, -30);
  near(r.residual, -30); assert.equal(r.marginDeltaPp, null);
});
test('five-factor randomized cases reconcile and reversing periods reverses each contribution', async () => {
  for (let seed = 1; seed <= 30; seed++) {
    const before = [], after = [];
    for (let p = 1; p <= 4; p++) for (let c = 1; c <= 3; c++) {
      before.push(row(p, c, 1 + (seed * p + c) % 30, 6 + p + c, p));
      after.push(row(p, c, 1 + (seed * c + p) % 25, 7 + p + c * 1.1, p * 1.13));
    }
    const r = await run(before, after), reverse = await run(after, before);
    near(r.contributions.reduce((s, x) => s + x.amount, 0), r.profitDelta);
    near(r.contributions.reduce((s, x) => s + x.percentagePoints, 0), r.marginDeltaPp);
    for (let i = 0; i < r.contributions.length; i++) near(r.contributions[i].amount, -reverse.contributions[i].amount);
  }
});
test('existing report amount bridge and rate denominator effects both reconcile', async () => {
  const previous = { C: 100, E: 20, F: 10, G: 50, H: 5, AJ: 0, J: 35, K: .35 };
  const current = { C: 120, E: 10, F: 20, G: 40, H: 10, AJ: 0, J: 80, K: 80 / 120 };
  const r = (await mod).buildReportedProfitBridge({ previous, current });
  near(r.profitDelta, 45); near(r.residual, 0); near(r.rateResidual, 0);
  near(r.contributions.find(x => x.key === 'E').amount, 10);
  near(r.contributions.find(x => x.key === 'F').amount, 10);
  near(r.contributions.reduce((s, x) => s + x.percentagePoints, 0), r.marginDeltaPp);
  assert.equal(r.warnings.length, 0);
});
test('legacy total/noEnding rate uses C+F while normal category uses C', async () => {
  const previous = { C: 100, E: 20, F: 10, G: 50, H: 5, AJ: 0, J: 35, K: 35 / 110 };
  const current = { C: 120, E: 10, F: 20, G: 40, H: 10, AJ: 0, J: 80, K: 80 / 140 };
  const r = (await mod).buildReportedProfitBridge({ previous, current, isTotal: true });
  near(r.rateResidual, 0); assert.deepEqual(r.denominator, { previous: 110, current: 140 });
  const noEnding = (await mod).buildReportedProfitBridge({ previous: { ...previous, variant: 'noEnding' }, current: { ...current, variant: 'noEnding' } });
  near(noEnding.rateResidual, 0);
});
test('missing report cost does not become zero or a verified bridge', async () => {
  const r = (await mod).buildReportedProfitBridge({ previous: { C: 100, J: null, K: null }, current: { C: 100, J: 20, K: .2 } });
  assert.equal(r.profitDelta, null); assert.equal(r.residual, null);
  assert.ok(r.warnings.includes('REPORTED_INPUT_INCOMPLETE'));
});

const assert = require('assert');

(async () => {
  const { decomposeProfitMarginChange } = await import('../lib/profitMarginDecomposition.js');
  const row = (category, values, variant = 'normal') => ({ category, variant, calc: values });
  const baseline = {
    orderYear: '2025', major: '28',
    rows: [
      row('콜롬비아 장미', { C: 1000, Q: 0.3, R: 1000, S: 0.05, H: 50, E: 100, F: 80 }),
      row('일본', { C: 500, Q: 0.1, R: 900, S: 0.01, H: 10, E: 20, F: 30 }, 'noEnding'),
    ],
  };
  const comparison = {
    orderYear: '2026', major: '28',
    rows: [
      row('콜롬비아 장미', { C: 1300, Q: 0.35, R: 1100, S: 0.06, H: 55, E: 120, F: 90 }),
      row('일본', { C: 400, Q: 0.12, R: 950, S: 0.02, H: 12, E: 25, F: 35 }, 'noEnding'),
      row('태국', { C: 200, Q: 0.04, R: 1100, S: 0.01, H: 8, E: 0, F: 5 }),
    ],
  };

  const result = decomposeProfitMarginChange(baseline, comparison);
  assert.strictEqual(result.baseline.key, '2025-28');
  assert.strictEqual(result.comparison.key, '2026-28');
  assert.strictEqual(result.contributions.length, 6);
  assert.ok(Math.abs(result.contributionSum - result.difference) < 1e-10, '여섯 기여도는 실제 이익률 차이와 조정');
  assert.ok(Math.abs(result.residual) < 1e-10, '잔차 없음');
  assert.ok(result.issues.some(issue => issue.code === 'ALLOCATION_UNIT_PRICE_UNVERIFIED'), '판매수량 없는 분배단가는 미검증 표시');

  const zero = decomposeProfitMarginChange(
    { orderYear: '2026', major: '27', rows: [] },
    { orderYear: '2026', major: '28', rows: [] },
  );
  assert.ok(zero.issues.some(issue => issue.code === 'MARGIN_DENOMINATOR_ZERO'));

  assert.throws(() => decomposeProfitMarginChange({ major: '28', rows: [] }, comparison), /orderYear/);
  console.log('profitMarginDecomposition.test.js: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

const assert = require('assert');

(async () => {
  const { classifyProfitWeek, buildMonthlyProfitSummary } = await import('../lib/profitReportMonthly.js');

  assert.deepStrictEqual(classifyProfitWeek({ startDate: '2026-07-02', endDate: '2026-07-08' }).kind, 'included');
  assert.deepStrictEqual(classifyProfitWeek({ startDate: '2026-06-25', endDate: '2026-07-01' }).kind, 'boundary');
  assert.deepStrictEqual(classifyProfitWeek({ startDate: '2026-07-30', endDate: '2026-08-05' }).kind, 'boundary');
  assert.deepStrictEqual(classifyProfitWeek({ startDate: '2026-07-02', endDate: 'not-a-date' }).kind, 'missing_period');

  const summary = buildMonthlyProfitSummary([
    { major: '01', period: { startDate: '2026-06-25', endDate: '2026-07-01' }, totals: { C: 100, I: 70, J: 30 } },
    { major: '02', period: { startDate: '2026-07-02', endDate: '2026-07-08' }, totals: { C: 200, F: 20, I: 120, J: 80 } },
    { major: '03', period: { startDate: '2026-07-30', endDate: '2026-08-05' }, totals: { C: 300, I: 210, J: 90 } },
  ], '2026');

  assert.strictEqual(summary.months[6].includedWeeks.length, 1, '7월에는 완전 포함 차수만 들어간다');
  assert.strictEqual(summary.months[6].totals.C, 200, '월경계 차수 매출은 월합계에서 제외한다');
  assert.strictEqual(summary.months[6].totals.J, 80, '월별 이익은 기존 주차 이익의 합계다');
  assert.strictEqual(summary.months[6].totals.K, 80 / 220, '이익률은 기존 주차 합계행의 분모를 유지한다');
  assert.strictEqual(summary.months[6].totals.E, undefined, '기초재고는 월별로 합산하지 않는다');
  assert.strictEqual(summary.months[6].totals.F, undefined, '기말재고는 월별로 합산하지 않는다');
  assert.strictEqual(summary.months[6].boundaryWeeks.length, 2, '7월과 연결된 경계 차수는 참고목록에 보인다');
  assert.strictEqual(summary.months[7].totals.C, 0, '8월 경계만 있는 달은 월합계가 0이 아니라 별도 상태다');
  assert.strictEqual(summary.months[7].status, 'boundary_only');
  assert.strictEqual(summary.boundaryWeeks.length, 2, '경계 차수 금액은 전역 목록에 한 번만 남는다');

  console.log('profitReportMonthly.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

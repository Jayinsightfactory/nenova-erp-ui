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

  assert.strictEqual(summary.months[6].includedWeeks.length, 2, '7월에는 7월 종료 차수까지 들어간다');
  assert.strictEqual(summary.months[6].totals.C, 300, '6월 시작 경계 차수는 7월이 아니라 6월에 귀속된다');
  assert.strictEqual(summary.months[6].totals.J, 110, '7월에 귀속된 주차의 이익을 합산한다');
  assert.strictEqual(summary.months[6].totals.K, 110 / 320, '이익률은 7월 귀속 주차 합계행의 분모를 유지한다');
  assert.strictEqual(summary.months[6].totals.E, undefined, '기초재고는 월별로 합산하지 않는다');
  assert.strictEqual(summary.months[6].totals.F, undefined, '기말재고는 월별로 합산하지 않는다');
  assert.strictEqual(summary.months[6].boundaryWeeks.length, 1, '7월 경계 차수는 종료일 기준 7월에 귀속된다');
  assert.strictEqual(summary.months[7].totals.C, 300, '8월 경계 차수는 다음 달 월합계에 포함된다');
  assert.strictEqual(summary.months[7].totals.J, 90, '8월 월경계 차수의 이익도 월합계에 포함된다');
  assert.strictEqual(summary.months[7].status, 'included_with_boundary');
  assert.strictEqual(summary.months[7].boundaryWeeks.length, 1, '8월에는 종료일 기준 귀속된 경계 차수가 표시된다');
  assert.strictEqual(summary.boundaryWeeks.length, 2, '경계 차수는 전역 목록에 한 번만 남는다');

  console.log('profitReportMonthly.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

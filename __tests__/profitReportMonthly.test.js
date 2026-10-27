const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  assert.strictEqual(summary.months[6].totals.C, 300, '6월 시작 경계 차수도 종료일이 속한 7월에 귀속된다');
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
  const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'sales', 'profit-report.js'), 'utf8');
  assert.ok(page.includes('월경계 차수도 전체 금액을 종료일이 속한 달의 합계에 한 번만 포함하며'), '화면 안내도 월경계 차수 전액의 종료월 귀속을 설명해야 한다');
  assert.ok(!page.includes('한 달 안에 완전히 들어오는 차수만 월별 합계에 포함'), '월경계 차수를 합계에서 제외한다는 잘못된 안내 금지');

  console.log('profitReportMonthly.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

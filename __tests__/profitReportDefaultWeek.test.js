// 주차별 매출이익보고서 기본 차수는 현재 진행 차수의 직전 대차수여야 한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

async function main() {
  const helperPath = path.join(__dirname, '..', 'lib', 'profitReportDefaultPeriod.mjs');
  const { getPreviousProfitReportPeriod } = await import(pathToFileURL(helperPath).href);

  assert.deepStrictEqual(
    getPreviousProfitReportPeriod('2026-34-01'),
    { year: '2026', major: '33' },
    '현재 34차이면 기본 보고서는 33차여야 함'
  );
  assert.deepStrictEqual(
    getPreviousProfitReportPeriod('2026-01-01'),
    { year: '2025', major: '52' },
    '현재 01차이면 전년도 52차로 넘어가야 함'
  );
  assert.deepStrictEqual(
    getPreviousProfitReportPeriod('2026-52-04'),
    { year: '2026', major: '51' },
    '세부차수 값과 무관하게 대차수 기준으로 한 차수 전을 선택해야 함'
  );
  assert.deepStrictEqual(
    getPreviousProfitReportPeriod('잘못된-차수'),
    { year: '', major: '' },
    '잘못된 현재 차수를 0차나 음수 차수로 바꾸면 안 됨'
  );

  const pageSource = fs.readFileSync(
    path.join(__dirname, '..', 'pages', 'sales', 'profit-report.js'),
    'utf8'
  );
  assert.match(pageSource, /getPreviousProfitReportPeriod\(getCurrentWeek\(\)\)/,
    '보고서 화면이 직전 차수 계산 함수를 실제 기본값에 연결해야 함');
  assert.match(pageSource, /useWeekInput\(defaultWeeklyPeriod\.major\)/,
    '차수 입력칸은 계산된 직전 차수를 기본값으로 사용해야 함');
  assert.match(pageSource, /useState\(defaultWeeklyPeriod\.year\)/,
    '연초 경계에서 보고서 연도도 직전 차수 연도와 함께 바뀌어야 함');
  assert.match(pageSource, /const \[monthlyYear, setMonthlyYear\] = useState\(getDefaultYear\(\)\)/,
    '월별 보고서의 기본 연도는 이번 변경으로 바뀌면 안 됨');

  console.log('✅ 주차별 매출이익보고서 직전 차수 기본값 검사 통과');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

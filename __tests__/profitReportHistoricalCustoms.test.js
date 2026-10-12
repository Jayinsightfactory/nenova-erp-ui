// lib/profitReportHistoricalCustoms.js — 2026년 22~27차 그외통관비 원천 구성요소 historical snapshot.
// 실행: node __tests__/profitReportHistoricalCustoms.test.js
//
// 이전 lib/profitReportAuditedBaseline.js 는 "최종 H 합계"를 런타임 폴백으로 갖고 있어서, 화면 값이
// 맞아도 그 값을 만드는 운영 원천이 없다는 사실이 숨겨졌고 감사 테스트도 자기증명이 됐다.
// 이 테스트는 다음을 고정한다.
//   1) 모듈이 최종 합계가 아니라 **구성요소**만 보관한다.
//   2) 그 구성요소를 원본 공식에 넣으면 원본 워크북 H 셀값이 정확히 나온다.
//   3) 저장행 우선 / 교차연도 비오염 / 요율 스냅샷 / 실제 배차 보존이 지켜진다.
//   4) 마이그레이션 seed SQL이 모듈과 동일한 값을 담고 있다.
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};
const near = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) <= tol;

async function main() {
  const {
    HISTORICAL_SNAPSHOT_YEAR, HISTORICAL_SOURCE_TAG,
    getHistoricalCountryCustoms, getHistoricalColombiaWeekly,
    historicalCountryMajors, historicalColombiaWeeks, historicalCountryCategories,
  } = await import('../lib/profitReportHistoricalCustoms.js');
  const {
    RATE_DEFAULTS, computeCountryCustomsTotal, computeColombiaCustomsTotal,
    resolveCountryCustomsTotal, resolveColombiaCustomsAllocation, ratesForRow,
  } = await import('../lib/customsForwarding.js');
  const workbook = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-report-22-27-full.json'), 'utf8'),
  );

  console.log('=== 구성요소 → 원본 공식 → 원본 H 셀값 (66개 국가행) ===');
  let countryChecked = 0;
  let countryBad = [];
  for (const major of historicalCountryMajors()) {
    for (const category of historicalCountryCategories(major)) {
      const row = getHistoricalCountryCustoms(HISTORICAL_SNAPSHOT_YEAR, major, category);
      const expected = workbook.weeks[major].countryCustoms[category].excelTotal;
      const actual = computeCountryCustomsTotal(row, ratesForRow(row, RATE_DEFAULTS), category);
      countryChecked += 1;
      if (!near(actual, expected)) countryBad.push(`${major}차 ${category}: ${actual} != ${expected}`);
    }
  }
  check(`22~27차 국가행 ${countryChecked}건이 원본 H와 정확히 일치`, countryBad.length === 0,
    countryBad.slice(0, 5).join(' / '));
  check('국가행 개수 = 6차수 × 11국가', countryChecked === 66, String(countryChecked));

  console.log('\n=== 콜롬비아 반차수 TOTAL (12건) ===');
  let colBad = [];
  for (const orderWeek of historicalColombiaWeeks()) {
    const { row } = getHistoricalColombiaWeekly(HISTORICAL_SNAPSHOT_YEAR, orderWeek);
    const major = orderWeek.split('-')[0];
    const expected = workbook.weeks[major].colombia[orderWeek].excelTotal;
    const actual = computeColombiaCustomsTotal(row, ratesForRow(row, RATE_DEFAULTS));
    if (!near(actual, expected)) colBad.push(`${orderWeek}: ${actual} != ${expected}`);
  }
  check(`콜롬비아 반차수 ${historicalColombiaWeeks().length}건이 원본 TOTAL과 정확히 일치`,
    colBad.length === 0, colBad.join(' / '));

  console.log('\n=== 백상 창고료 요율은 시트 단위로 다르다 (22차 콜롬비아 370 vs 국가 460) ===');
  check('22차 콜롬비아 시트 요율 = 370',
    getHistoricalColombiaWeekly('2026', '22-01').row.BakSangRateApplied === 370);
  check('22차 그외통관비(국가) 시트 요율 = 460',
    getHistoricalCountryCustoms('2026', '22', '콜롬비아 수국').BakSangRateApplied === 460);
  check('23~27차 콜롬비아 시트 요율 = 460',
    ['23-01', '24-01', '25-01', '26-01', '27-01']
      .every((wk) => getHistoricalColombiaWeekly('2026', wk).row.BakSangRateApplied === 460));
  check('원본 fixture의 요율과 모듈 값이 일치',
    historicalColombiaWeeks().every((wk) => {
      const major = wk.split('-')[0];
      return getHistoricalColombiaWeekly('2026', wk).row.BakSangRateApplied
        === workbook.weeks[major].colombia[wk].BakSangRate;
    }));
  console.log('\n=== 요율 스냅샷: 전역 단가표가 바뀌어도 과거 계산이 흔들리지 않는다 ===');
  const laterGlobal = { ...RATE_DEFAULTS, BakSangRate: 999, Truck5t: 9999999, QuarantinePerItemRate: 77777 };
  const snapRow = getHistoricalColombiaWeekly('2026', '22-01').row;
  check('백상 요율 스냅샷이 전역값을 이김', ratesForRow(snapRow, laterGlobal).BakSangRate === 370);
  check('트럭 단가 스냅샷이 전역값을 이김', ratesForRow(snapRow, laterGlobal).Truck5t === 275000);
  check('검역대행 단가 스냅샷이 전역값을 이김', ratesForRow(snapRow, laterGlobal).QuarantinePerItemRate === 10000);
  check('22-01 TOTAL이 전역 단가 변경 후에도 3,134,100원 유지',
    near(computeColombiaCustomsTotal(snapRow, ratesForRow(snapRow, laterGlobal)), 3134100));
  check('스냅샷이 없는 행은 전역 단가를 그대로 사용', ratesForRow({ GW: 100 }, laterGlobal).BakSangRate === 999);

  console.log('\n=== 교차연도 비오염 ===');
  check('2025년 27차에는 적용되지 않음', getHistoricalCountryCustoms('2025', '27', '콜롬비아 수국') === null);
  check('2025년 27-01 콜롬비아에도 적용되지 않음', getHistoricalColombiaWeekly('2025', '27-01') === null);
  check('2026년 28차(범위 밖)에는 적용되지 않음', getHistoricalCountryCustoms('2026', '28', '태국') === null);
  check('2026년 21차(범위 밖)에는 적용되지 않음', getHistoricalCountryCustoms('2026', '21', '태국') === null);

  console.log('\n=== 우선순위: 저장행 > historical snapshot > 입고 GW 자동 ===');
  const savedRow = { GW1: 1, GW2: 0, Customs1: 5000, BakSangRateApplied: 460 };
  const saved = resolveCountryCustomsTotal({
    row: savedRow, gwDef: { GW1: 2847, GW2: 1661 }, rates: RATE_DEFAULTS,
    category: '콜롬비아 수국', orderYear: '2026', major: '27',
  });
  check('저장행이 있으면 historical snapshot을 전혀 쓰지 않음', saved.source === 'saved');
  check('저장행 총액은 저장값 기준(원본 H가 아님)', !near(saved.total, 2369680) && saved.total > 0,
    String(saved.total));
  const historical = resolveCountryCustomsTotal({
    row: null, gwDef: null, rates: RATE_DEFAULTS,
    category: '콜롬비아 수국', orderYear: '2026', major: '27',
  });
  check('저장행이 없으면 historical snapshot 사용', historical.source === HISTORICAL_SOURCE_TAG);
  check('historical 경로 총액 = 원본 H 2,369,680', near(historical.total, 2369680), String(historical.total));
  const gwAuto = resolveCountryCustomsTotal({
    row: null, gwDef: { GW1: 1000, GW2: 0 }, rates: RATE_DEFAULTS,
    category: '태국', orderYear: '2025', major: '27',   // 대상 연도 밖 → 자동 경로
  });
  check('대상 밖 연도는 입고 GW 자동 경로', gwAuto.source === 'gw_auto');

  console.log('\n=== 실제 청구 운송료/배차는 자동추천으로 대체되지 않는다 ===');
  const nl27 = getHistoricalCountryCustoms('2026', '27', '네덜란드');
  check('월드운송료는 Manual 플래그로 보존', nl27.WorldFreight1Manual === 1 && nl27.WorldFreight2Manual === 1);
  const col2702 = resolveColombiaCustomsAllocation({
    orderWeek: '27-02', orderYear: '2026', major: '27', colRow: null,
    boxQty: {}, gwDef: { GW: 1371, CW: 1371 }, airTotal: 0, rates: RATE_DEFAULTS,
  });
  check('27-02 실제 배차는 2.5t 1대(원본)', col2702.truckActual.Truck2_5t === 1 && col2702.truckActual.Truck1t === 0);
  check('27-02 추천은 1t 2대(용량분해) — 실제와 다르게 별도 노출',
    col2702.truckAuto.Truck1t === 2 && col2702.truckAuto.Truck2_5t === 0);
  check('27-02 TOTAL은 실제 배차 기준 890,660원', near(col2702.total, 890660), String(col2702.total));

  console.log('\n=== 모듈에 최종 H 합계 하드코딩이 없다 ===');
  const moduleSource = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'profitReportHistoricalCustoms.js'), 'utf8');
  check('COUNTRY_H_BY_MAJOR(최종합계 테이블)가 없음', !/COUNTRY_H_BY_MAJOR/.test(moduleSource));
  check('AUDITED_GRAND_TOTAL(그랜드토탈 상수)이 없음', !/AUDITED_GRAND_TOTAL/.test(moduleSource));
  check('삭제된 lib/profitReportAuditedBaseline.js를 아무도 참조하지 않음',
    !fs.existsSync(path.join(__dirname, '..', 'lib', 'profitReportAuditedBaseline.js')));

  console.log('\n=== 마이그레이션 seed SQL이 모듈과 같은 값을 담는다 ===');
  const seedPath = path.join(__dirname, '..', 'docs', 'migrations',
    '2026-08-12_profit_report_historical_customs_seed.sql');
  check('seed 마이그레이션 파일 존재', fs.existsSync(seedPath));
  const seedSql = fs.readFileSync(seedPath, 'utf8');
  check('웹 전용 테이블에만 INSERT (ERP 원장 없음)',
    /INSERT INTO WebCustomsWeekly/.test(seedSql) && /INSERT INTO WebColombiaWeekly/.test(seedSql)
    && !/INSERT INTO (OrderMaster|OrderDetail|ShipmentMaster|ShipmentDetail|ProductStock|Estimate|StockHistory)\b/.test(seedSql));
  check('기존 저장행을 덮어쓰지 않음(NOT EXISTS 가드)',
    (seedSql.match(/WHERE NOT EXISTS/g) || []).length >= 2);
  const seedCountryRows = (seedSql.match(/\(N'2026', N'\d\d', N'[^']+', /g) || []).length;
  check(`국가 seed 행 수(${seedCountryRows}) = 모듈 국가행 수(66)`, seedCountryRows === 66, String(seedCountryRows));
  check('22차 콜롬비아 seed 요율이 370', /N'22-01'.*?, 370\)/.test(seedSql));
  check('실제 청구 운송료 보존 플래그(Manual=1)를 함께 seed', /, 1, 1, /.test(seedSql));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

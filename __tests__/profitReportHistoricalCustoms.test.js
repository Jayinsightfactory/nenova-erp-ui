// 2026년 22~27차 그외통관비(H) 원본 엑셀 historical snapshot 회귀 검증.
//
// lib/profitReportHistoricalCustoms.js(프로덕션 단일 진실 소스, 구성요소 단위)가
// __tests__/fixtures/profit-report-22-27.json(본표 H 정답)·profit-report-22-27-customs.json
// (구성요소 원본, 같은 추출 스크립트 결과)와 정확히 일치하는지, 그리고
// lib/customsForwarding.js의 우선순위(explicit saved > excel historical snapshot > gw auto >
// missing)가 국가/콜롬비아 양쪽에서 올바르게 동작하는지 대조한다. 이전 구현(감사 기준값=최종 H
// 합계)과 달리 이 모듈은 구성요소를 갖고 있으므로, "감사값을 그대로 읽어서 통과"가 아니라 매번
// computeCountryCustomsTotal/computeColombiaCustomsTotal로 총액을 재계산해 검증한다.
//
// 실행: node __tests__/profitReportHistoricalCustoms.test.js
const fs = require('fs');
const path = require('path');

const near = (actual, expected, tolerance = 0.02) => Math.abs(Number(actual) - Number(expected)) <= tolerance;
let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const {
    RATE_DEFAULTS, COUNTRY_CATEGORIES, COLOMBIA_ALLOC_CATEGORIES,
    resolveCountryCustomsTotal, resolveColombiaCustomsAllocation,
    computeCountryCustomsTotal, computeColombiaCustomsTotal, computeColombiaAllocationFromTotal,
    effectiveRatesForWeek, HISTORICAL_CUSTOMS_SOURCE,
  } = await import('../lib/customsForwarding.js');
  const {
    HISTORICAL_CUSTOMS_YEAR, getHistoricalCountryCustomsRow, getHistoricalColombiaWeekly,
    getHistoricalTaxableRate, historicalCustomsMajors, historicalColombiaWeeks,
  } = await import('../lib/profitReportHistoricalCustoms.js');
  const { deriveTruckPlan } = await import('../lib/colombiaTruck.js');

  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-report-22-27.json'), 'utf8'));
  const customsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-report-22-27-customs.json'), 'utf8'));
  const MAJORS = ['22', '23', '24', '25', '26', '27'];

  console.log('=== HISTORICAL_CUSTOMS_YEAR / 대상 범위 ===');
  check('HISTORICAL_CUSTOMS_YEAR = 2026', HISTORICAL_CUSTOMS_YEAR === '2026');
  check('국가 구성요소 22~27차 6개', historicalCustomsMajors().length === 6);
  check('콜롬비아 반차수 12개(6차수 × 2)', historicalColombiaWeeks().length === 12);

  console.log('\n=== 백상 창고료 요율(scope 분리) — 국가는 22~27차 전부 460, 콜롬비아는 22차만 370 ===');
  for (const m of MAJORS) {
    check(`국가 2026-${m} BakSangRate = 460`,
      effectiveRatesForWeek(RATE_DEFAULTS, '2026', m, 'country').BakSangRate === 460);
  }
  check('콜롬비아 2026-22 BakSangRate = 370', effectiveRatesForWeek(RATE_DEFAULTS, '2026', '22', 'colombia').BakSangRate === 370);
  for (const m of ['23', '24', '25', '26', '27']) {
    check(`콜롬비아 2026-${m} BakSangRate = 460`,
      effectiveRatesForWeek(RATE_DEFAULTS, '2026', m, 'colombia').BakSangRate === 460);
  }
  check('2025-22는 적용 안 됨(전역값 유지) — 교차연도 오염 없음',
    effectiveRatesForWeek({ ...RATE_DEFAULTS, BakSangRate: 999 }, '2025', '22', 'country').BakSangRate === 999);
  check('2026-28은 대상 밖(전역값 유지)',
    effectiveRatesForWeek({ ...RATE_DEFAULTS, BakSangRate: 999 }, '2026', '28', 'country').BakSangRate === 999);

  console.log('\n=== 국가별(콜롬비아 수국 포함) 구성요소 → computeCountryCustomsTotal 재계산 = fixture 원본 H ===');
  for (const major of MAJORS) {
    const fixtureCats = Object.fromEntries(fixture.weeks[major].categories.map((c) => [c.category, c.cells.H.value]));
    for (const cat of COUNTRY_CATEGORIES) {
      const row = getHistoricalCountryCustomsRow('2026', major, cat);
      check(`${major}차 ${cat} historical row 존재`, Boolean(row));
      const rates = effectiveRatesForWeek(RATE_DEFAULTS, '2026', major, 'country');
      const total = computeCountryCustomsTotal(row, rates, cat);
      check(`${major}차 ${cat} H 재계산 = ${fixtureCats[cat]}`, near(total, fixtureCats[cat], 0.5), `actual=${total}`);
    }
  }

  console.log('\n=== 콜롬비아 4품목 반차수 구성요소 → computeColombiaCustomsTotal 재계산 = fixture 원본 TOTAL ===');
  const colombiaCustomsFixture = customsFixture.weeks;
  for (const major of MAJORS) {
    for (const half of ['1', '2']) {
      const wk = `${major}-0${half}`;
      const entry = getHistoricalColombiaWeekly('2026', wk);
      check(`${wk} historical 존재`, Boolean(entry));
      const rates = effectiveRatesForWeek(RATE_DEFAULTS, '2026', major, 'colombia');
      const total = computeColombiaCustomsTotal(entry.row, rates);
      const expected = colombiaCustomsFixture[major].colombia[wk].total;
      check(`${wk} TOTAL 재계산 = ${expected}`, near(total, expected, 0.5), `actual=${total}`);
    }
  }

  console.log('\n=== 콜롬비아 배분(H) → fixture 카테고리별 H(장미/카네이션/알스트로/루스커스)와 일치 ===');
  for (const major of MAJORS) {
    const fixtureCats = Object.fromEntries(fixture.weeks[major].categories.map((c) => [c.category, c.cells.H.value]));
    const summedH = Object.fromEntries(COLOMBIA_ALLOC_CATEGORIES.map((c) => [c, 0]));
    for (const half of ['1', '2']) {
      const wk = `${major}-0${half}`;
      const entry = getHistoricalColombiaWeekly('2026', wk);
      const rates = effectiveRatesForWeek(RATE_DEFAULTS, '2026', major, 'colombia');
      const total = computeColombiaCustomsTotal(entry.row, rates);
      const alloc = computeColombiaAllocationFromTotal(total, 0, entry.boxQty, rates);
      for (const cat of COLOMBIA_ALLOC_CATEGORIES) summedH[cat] += alloc[cat].H;
    }
    for (const cat of COLOMBIA_ALLOC_CATEGORIES) {
      check(`${major}차 ${cat} 배분 H = ${fixtureCats[cat]}`, near(summedH[cat], fixtureCats[cat], 0.5), `actual=${summedH[cat]}`);
    }
  }

  console.log('\n=== 콜롬비아 실제 트럭 대수 — 22~27차 원본 실제값 보존(추천 재계산이 아님) ===');
  // 26-01 GW=6706kg: 용량분해 추천은 5t 1대 + 2.5t 1대이지만,
  // 원본 실제 청구는 5t 1대뿐이다 — 이 차이 자체가 "실제값과 추천값이 다를 수 있고,
  // 실제값이 항상 우선"이라는 규칙의 증거다.
  const w2601 = getHistoricalColombiaWeekly('2026', '26-01');
  check('26-01 실제 트럭 = 5t 1대', w2601.row.Truck5t === 1 && w2601.row.Truck1t === 0 && w2601.row.Truck2_5t === 0);
  const recommend2601 = deriveTruckPlan(w2601.row.GW);
  check('26-01 용량분해 추천은 실제와 다름(5t 1대+2.5t 1대) — 그래서 실제값 보존이 필요함',
    recommend2601.Truck5t === 1 && recommend2601.Truck2_5t === 1 && recommend2601.Truck1t === 0);

  console.log('\n=== deriveTruckPlan 차량 등급 (2.5t 초과~5t = 5t 1대) ===');
  const p3000 = deriveTruckPlan(3000);
  check('3,000kg → 5t 1대 (2.5t 초과는 5t)', p3000.Truck5t === 1 && p3000.Truck2_5t === 0 && p3000.Truck1t === 0);
  const p3342 = deriveTruckPlan(3342);
  check('3,342kg → 5t 1대 275,000원 등급', p3342.Truck5t === 1 && p3342.Truck2_5t === 0 && p3342.Truck1t === 0);
  const p6000 = deriveTruckPlan(6000);
  check('6,000kg → 5t 1대 + 1t 1대', p6000.Truck5t === 1 && p6000.Truck1t === 1 && p6000.Truck2_5t === 0);
  const p800 = deriveTruckPlan(800);
  check('800kg → 1t 1대', p800.Truck1t === 1 && p800.Truck2_5t === 0 && p800.Truck5t === 0);
  const p0 = deriveTruckPlan(0);
  check('0kg → 추천 없음(missing)', p0.source === 'missing');

  console.log('\n=== 과세환율(R) historical — 2026 22~27차 본표 R열과 일치 ===');
  for (const major of MAJORS) {
    for (const cat of fixture.weeks[major].categories.map((c) => c.category)) {
      const expected = fixture.weeks[major].categories.find((c) => c.category === cat).cells.R?.value;
      if (typeof expected !== 'number' || expected <= 0) continue;
      const actual = getHistoricalTaxableRate('2026', major, cat);
      check(`${major}차 ${cat} R = ${expected}`, near(actual, expected, 0.005), `actual=${actual}`);
    }
  }
  check('2025년은 historical R 미적용', getHistoricalTaxableRate('2025', '27', '콜롬비아 수국') === null);

  console.log('\n=== resolveCountryCustomsTotal — 우선순위(explicit saved > excel historical > gw auto > missing) ===');
  const noRow = resolveCountryCustomsTotal({ row: null, gwDef: null, rates: RATE_DEFAULTS, category: '베트남', orderYear: '2026', major: '22' });
  check('저장행 없음 + historical 있음 → excel_historical_snapshot', noRow.source === HISTORICAL_CUSTOMS_SOURCE && near(noRow.total, 1176190, 1));
  const savedRow = resolveCountryCustomsTotal({
    row: { GW1: 100, GW2: 0, Customs1: 5000 }, gwDef: null, rates: RATE_DEFAULTS, category: '베트남', orderYear: '2026', major: '22',
  });
  check('저장행 있으면 historical을 절대 쓰지 않음(explicit > historical)', savedRow.source === 'saved' && !near(savedRow.total, 1176190, 1000));
  const outOfScope = resolveCountryCustomsTotal({ row: null, gwDef: null, rates: RATE_DEFAULTS, category: '베트남', orderYear: '2025', major: '22' });
  check('2025년 동일 차수는 historical 미적용(missing)', outOfScope.source === 'missing' && outOfScope.total === 0);

  console.log('\n=== resolveColombiaCustomsAllocation — 우선순위 동일 검증 + 박스수량도 historical로 대체 ===');
  const colHistorical = resolveColombiaCustomsAllocation({
    orderWeek: '26-01', orderYear: '2026', major: '26', colRow: null, boxQty: { '콜롬비아 장미': 1 }, gwDef: null, airTotal: 0, rates: RATE_DEFAULTS,
  });
  check('저장행 없음 → excel_historical_snapshot, GW/총액이 원본값 그대로',
    colHistorical.source === HISTORICAL_CUSTOMS_SOURCE && colHistorical.gw === 6706 && near(colHistorical.total, 3432760, 1));
  check('박스수량도 historical(원본 시트)로 대체 — 현재 입고 DB의 boxQty를 쓰지 않음',
    colHistorical.boxQty['콜롬비아 장미'] === 209);
  const colSaved = resolveColombiaCustomsAllocation({
    orderWeek: '26-01', orderYear: '2026', major: '26',
    colRow: { GW: 100, CustomsFee: 1000 }, boxQty: { '콜롬비아 장미': 1, '콜롬비아 카네이션': 1, '콜롬비아 알스트로': 1, '콜롬비아 루스커스': 1 },
    gwDef: null, airTotal: 0, rates: RATE_DEFAULTS,
  });
  check('저장행이 있으면 historical을 절대 쓰지 않음', colSaved.source === 'saved' && colSaved.gw === 100);
  const colOutOfScope = resolveColombiaCustomsAllocation({
    orderWeek: '26-01', orderYear: '2025', major: '26', colRow: null, boxQty: {}, gwDef: null, airTotal: 0, rates: RATE_DEFAULTS,
  });
  check('2025년 동일 반차수는 historical 미적용', colOutOfScope.source === 'missing');

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

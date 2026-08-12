// 2026년 22~27차 그외통관비(H) 감사 기준값 회귀 검증.
// lib/profitReportAuditedBaseline.js(프로덕션 단일 진실 소스)가
// __tests__/fixtures/profit-report-22-27.json(원본 워크북 read-only 추출, 테스트 증거)과 정확히
// 일치하는지, 그리고 lib/customsForwarding.js의 우선순위(explicit saved > audited baseline >
// current auto > global defaults)가 국가/콜롬비아 양쪽에서 올바르게 동작하는지 대조한다.
// 실행: node __tests__/profitReportAuditedBaseline.test.js
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
    computeColombiaAllocationFromTotal, effectiveRatesForWeek,
  } = await import('../lib/customsForwarding.js');
  const {
    AUDITED_BASELINE_YEAR, AUDITED_GRAND_TOTAL_BY_MAJOR,
    getAuditedBakSangRate, getAuditedCountryH, getAuditedColombiaWeekly, auditedColombiaWeeks,
  } = await import('../lib/profitReportAuditedBaseline.js');

  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-report-22-27.json'), 'utf8'));
  const MAJORS = ['22', '23', '24', '25', '26', '27'];

  console.log('=== 백상 창고료 요율(BakSangRate) — 22차만 370, 23~27차 460, 연도 오염 없음 ===');
  check("2026-22 = 370", getAuditedBakSangRate('2026', '22') === 370);
  for (const m of ['23', '24', '25', '26', '27']) {
    check(`2026-${m} = 460`, getAuditedBakSangRate('2026', m) === 460);
  }
  check('2025-22는 적용 안 됨(null) — 교차연도 오염 없음', getAuditedBakSangRate('2025', '22') === null);
  check('2026-28은 감사 대상 밖(null)', getAuditedBakSangRate('2026', '28') === null);
  check('AUDITED_BASELINE_YEAR = 2026', AUDITED_BASELINE_YEAR === '2026');

  console.log('\n=== 국가별(콜롬비아 수국 포함) 감사 H — fixture 원본 카테고리별 셀값과 정확히 일치 ===');
  const NON_COLOMBIA4 = COUNTRY_CATEGORIES; // 11개 국가(콜롬비아 수국 포함), 4품목 제외
  for (const major of MAJORS) {
    const fixtureCats = Object.fromEntries(fixture.weeks[major].categories.map((c) => [c.category, c.cells.H.value]));
    for (const cat of NON_COLOMBIA4) {
      const expected = fixtureCats[cat];
      const actual = getAuditedCountryH('2026', major, cat);
      check(`${major}차 ${cat} H = ${expected}`, near(actual, expected, 0.5), `actual=${actual}`);
    }
  }

  console.log('\n=== 콜롬비아 4품목 반차수 GW·박스수량·TOTAL 및 카테고리별 배분 H — fixture와 정확히 일치 ===');
  for (const major of MAJORS) {
    const weeks = auditedColombiaWeeks().filter((w) => w.startsWith(`${major}-`));
    check(`${major}차 반차수 2개(1차/2차)`, weeks.length === 2, weeks.join(','));
    const summedH = Object.fromEntries(COLOMBIA_ALLOC_CATEGORIES.map((c) => [c, 0]));
    for (const wk of weeks) {
      const baseline = getAuditedColombiaWeekly('2026', wk);
      check(`${wk} 감사 기준값 존재`, Boolean(baseline));
      const alloc = computeColombiaAllocationFromTotal(baseline.total, 0, baseline.boxQty, RATE_DEFAULTS);
      for (const cat of COLOMBIA_ALLOC_CATEGORIES) summedH[cat] += alloc[cat].H;
    }
    const fixtureCats = Object.fromEntries(fixture.weeks[major].categories.map((c) => [c.category, c.cells.H.value]));
    for (const cat of COLOMBIA_ALLOC_CATEGORIES) {
      check(`${major}차 ${cat} 배분 H = ${fixtureCats[cat]}`, near(summedH[cat], fixtureCats[cat], 0.5), `actual=${summedH[cat]}`);
    }
  }

  console.log('\n=== 정확한 콜롬비아 박스수량/GW(요청사항 4번 원문 수치) ===');
  const EXPECTED_COLOMBIA = {
    '22-01': { gw: 7530, total: 3134100, boxQty: { '콜롬비아 장미': 190, '콜롬비아 카네이션': 505, '콜롬비아 알스트로': 28, '콜롬비아 루스커스': 75 } },
    '22-02': { gw: 553, total: 376610, boxQty: { '콜롬비아 장미': 6, '콜롬비아 카네이션': 44, '콜롬비아 알스트로': 7, '콜롬비아 루스커스': 0 } },
    '26-01': { gw: 6706, total: 3432760, boxQty: { '콜롬비아 장미': 209, '콜롬비아 카네이션': 441, '콜롬비아 알스트로': 16, '콜롬비아 루스커스': 27 } },
    '26-02': { gw: 655, total: 473300, boxQty: { '콜롬비아 장미': 27, '콜롬비아 카네이션': 40, '콜롬비아 알스트로': 4, '콜롬비아 루스커스': 0 } },
    '27-02': { gw: 1371, total: 890660, boxQty: { '콜롬비아 장미': 59, '콜롬비아 카네이션': 74, '콜롬비아 알스트로': 12, '콜롬비아 루스커스': 0 } },
  };
  for (const [wk, expected] of Object.entries(EXPECTED_COLOMBIA)) {
    const actual = getAuditedColombiaWeekly('2026', wk);
    check(`${wk} GW=${expected.gw}`, actual.gw === expected.gw);
    check(`${wk} TOTAL=${expected.total}`, actual.total === expected.total);
    check(`${wk} boxQty 일치`, JSON.stringify(actual.boxQty) === JSON.stringify(expected.boxQty));
  }

  console.log('\n=== 그랜드토탈(국가 소계 + 콜롬비아 4품목 합계) — 요청사항 5번 원문 수치 ===');
  for (const major of MAJORS) {
    let countrySum = 0;
    for (const cat of NON_COLOMBIA4) countrySum += getAuditedCountryH('2026', major, cat);
    let colombiaSum = 0;
    for (const wk of auditedColombiaWeeks().filter((w) => w.startsWith(`${major}-`))) {
      const b = getAuditedColombiaWeekly('2026', wk);
      colombiaSum += b.total;
    }
    const expected = AUDITED_GRAND_TOTAL_BY_MAJOR[major];
    check(`${major}차 국가 소계 = ${expected.countrySubtotal}`, near(countrySum, expected.countrySubtotal));
    check(`${major}차 콜롬비아 합계 = ${expected.colombiaTotal}`, near(colombiaSum, expected.colombiaTotal));
    check(`${major}차 그랜드토탈 = ${expected.total}`, near(countrySum + colombiaSum, expected.total));
  }

  console.log('\n=== resolveCountryCustomsTotal — 우선순위(explicit saved > audited baseline > current auto > global defaults) ===');
  const noRow = resolveCountryCustomsTotal({ row: null, gwDef: null, rates: RATE_DEFAULTS, category: '베트남', orderYear: '2026', major: '22' });
  check('저장행 없음 + 감사값 있음 → audited_baseline', noRow.source === 'audited_baseline' && near(noRow.total, 1176190));
  const savedRow = resolveCountryCustomsTotal({
    row: { GW1: 100, GW2: 0, Customs1: 5000 }, gwDef: null, rates: RATE_DEFAULTS, category: '베트남', orderYear: '2026', major: '22',
  });
  check('저장행 있으면 감사값을 절대 쓰지 않음(explicit > baseline)', savedRow.source === 'saved' && !near(savedRow.total, 1176190, 1000));
  const outOfScope = resolveCountryCustomsTotal({ row: null, gwDef: null, rates: RATE_DEFAULTS, category: '베트남', orderYear: '2025', major: '22' });
  check('2025년 동일 차수는 감사값 미적용(missing)', outOfScope.source === 'missing' && outOfScope.total === 0);

  console.log('\n=== resolveColombiaCustomsAllocation — 우선순위 동일 검증 ===');
  const colBaseline = resolveColombiaCustomsAllocation({
    orderWeek: '26-01', orderYear: '2026', major: '26', colRow: null, boxQty: {}, gwDef: null, airTotal: 0, rates: RATE_DEFAULTS,
  });
  check('저장행 없음 → audited_baseline, GW/총액이 감사값 그대로', colBaseline.source === 'audited_baseline' && colBaseline.gw === 6706 && colBaseline.total === 3432760);
  const colSaved = resolveColombiaCustomsAllocation({
    orderWeek: '26-01', orderYear: '2026', major: '26',
    colRow: { GW: 100, CustomsFee: 1000 }, boxQty: { '콜롬비아 장미': 1, '콜롬비아 카네이션': 1, '콜롬비아 알스트로': 1, '콜롬비아 루스커스': 1 },
    gwDef: null, airTotal: 0, rates: RATE_DEFAULTS,
  });
  check('저장행이 있으면 감사값을 절대 쓰지 않음', colSaved.source === 'saved' && colSaved.gw === 100);
  const colOutOfScope = resolveColombiaCustomsAllocation({
    orderWeek: '26-01', orderYear: '2025', major: '26', colRow: null, boxQty: {}, gwDef: null, airTotal: 0, rates: RATE_DEFAULTS,
  });
  check('2025년 동일 반차수는 감사값 미적용', colOutOfScope.source === 'missing');

  console.log('\n=== effectiveRatesForWeek — 저장된 요율이 없을 때만 감사 요율로 대체 ===');
  const laterGlobalRate = { ...RATE_DEFAULTS, BakSangRate: 999 }; // 관리자가 나중에 전역 요율을 바꿔도
  check('2026-22는 전역 요율이 바뀌어도 370 유지', effectiveRatesForWeek(laterGlobalRate, '2026', '22').BakSangRate === 370);
  check('2026-30(감사 대상 밖)은 전역 요율 그대로', effectiveRatesForWeek(laterGlobalRate, '2026', '30').BakSangRate === 999);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

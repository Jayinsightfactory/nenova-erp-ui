const fs = require('fs');
const path = require('path');
let failed = 0;
const check = (label, ok, detail = '') => { if (ok) console.log(`  ✓ ${label}`); else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed += 1; } };
const near = (a, b, tolerance = 0.01) => Math.abs(Number(a) - Number(b)) <= tolerance;

async function main() {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-report-week-28-customs.json'), 'utf8'));
  const { computeCountryCustomsTotal, computeColombiaCustomsTotal, deriveWorldFreight, effectiveCountryWorldFreight, mergeCountryGw, normalizeCountryInput } = await import('../lib/customsForwarding.js');

  console.log('=== 28차 Excel H 구성요소 ===');
  let countryTotal = 0;
  for (const item of fixture.countries) {
    const actual = computeCountryCustomsTotal(normalizeCountryInput(item.row), fixture.rates, item.category);
    check(`${item.sourceCell} ${item.category}`, near(actual, item.expectedH), `${actual} != ${item.expectedH}`);
    countryTotal += actual;
  }
  let colombiaTotal = 0;
  for (const item of fixture.colombiaPhases) {
    const actual = computeColombiaCustomsTotal(item.row, fixture.rates);
    check(`${item.orderWeek} 콜롬비아 TOTAL`, near(actual, item.expectedH), `${actual} != ${item.expectedH}`);
    colombiaTotal += actual;
  }
  check('국가 합계 6,410,350', near(countryTotal, 6410350), String(countryTotal));
  check('콜롬비아 1·2차 합계 5,049,760', near(colombiaTotal, 5049760), String(colombiaTotal));
  check('Excel H23 합계 11,460,110', near(countryTotal + colombiaTotal, fixture.excelH));
  check('보고된 H 차이 +657,113 산술 재현', fixture.excelH - fixture.reportedComparison.impliedComparedH === fixture.reportedComparison.reportedDelta);
  check('비교 대상 국가별 원천은 미검증으로 격리', fixture.reportedComparison.status === '미검증');

  console.log('\n=== 1·2차 차량·VAT·직접입력 ===');
  const hyd = fixture.countries[0];
  const first = deriveWorldFreight(hyd.row.GW1, fixture.rates);
  const second = deriveWorldFreight(hyd.row.GW2, fixture.rates);
  check('1차 2,857kg → 2.5t 1대 + 1t 1대', first.Truck2_5t === 1 && first.Truck1t === 1 && first.amount === 286000);
  check('2차 1,743kg → 2.5t 1대', second.Truck2_5t === 1 && second.amount === 187000);
  check('월드운송료 공급가 = (286,000+187,000)/1.1', near(first.amount / 1.1 + second.amount / 1.1, 430000));
  const directZero = effectiveCountryWorldFreight(hyd.row, { GW1: hyd.row.GW1, GW2: hyd.row.GW2 }, fixture.rates);
  check('WebCustoms 직접입력 0도 자동값보다 우선', directZero.row.WorldFreight1 === 0 && directZero.row.WorldFreight2 === 0);
  const explicitAuto = effectiveCountryWorldFreight({ GW1: 2857, GW2: 1743, WorldFreight1: 0, WorldFreight2: 0, WorldFreight1Manual: 0, WorldFreight2Manual: 0 }, null, fixture.rates);
  check('Manual=0이면 결합 GW 차량 조합을 1차에만 자동 반영', explicitAuto.row.WorldFreight1 === 484000 && explicitAuto.row.WorldFreight2 === 0);
  check('직접입력 GW 0도 자동 GW로 덮어쓰지 않음', mergeCountryGw({ GW1: 0 }, { GW1: 2857 }).GW1 === 0);

  console.log('\n=== 연도·차수·단가이력 정적 계약 ===');
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'customsForwarding.js'), 'utf8');
  const api = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'customs-clearance.js'), 'utf8');
  check('단가 이력은 적용 연도+대차수 복합키', source.includes('EffectiveOrderYear') && source.includes('EffectiveMajorWeek'));
  check('대상 차수 이하 최근 단가 선택', source.includes('<= @target') && source.includes('PARTITION BY ConfigKey'));
  check('보고서 계산이 연도·차수 단가를 요청', source.includes('getRateConfig(orderYear, major)'));
  check('단가 저장 API가 연도·차수를 전달', api.includes('saveRateConfig(req.body?.rates || {}, actor, orderYear, major)'));
  check('전년도 동일 28차 fixture 제외', fixture.crossYearFixture.selected.orderYear !== fixture.crossYearFixture.priorYearSameWeek.orderYear && fixture.crossYearFixture.expectedSelectedGW === fixture.crossYearFixture.selected.GW);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}
main().catch((error) => { console.error(error); process.exit(1); });

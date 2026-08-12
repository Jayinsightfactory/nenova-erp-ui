// 입고 GW/CW 기반 콜롬비아 트럭 자동계산·매출이익 검증 회귀 테스트
// 실행: node __tests__/customsForwardingAuto.test.js
const fs = require('fs');
const path = require('path');
const near = (actual, expected, tolerance = 0.01) => Math.abs(Number(actual) - Number(expected)) <= tolerance;
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
    RATE_DEFAULTS,
    computeColombiaCustomsTotal,
    computeCountryCustomsTotal,
    mergeColombiaGw,
    mergeColombiaTruck,
    normalizeCountryInput,
    deriveWorldFreight,
    effectiveCountryWorldFreight,
    vatInclusiveToNet,
    vatNetToInclusive,
  } = await import('../lib/customsForwarding.js');
  const { deriveColombiaTruckAllocation } = await import('../lib/colombiaTruck.js');
  const { buildProfitReportAudit } = await import('../lib/profitReportAudit.js');
  const forwardingSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'customsForwarding.js'), 'utf8');

  console.log('\n=== 운송료 전표 국가 약칭 매핑 ===');
  check('에콰 전표 약칭을 에콰도르로 자동 분류', forwardingSource.includes("f.InvoiceNo LIKE N'%에콰%'") && forwardingSource.includes("THEN N'에콰도르'"));

  console.log('=== 22~27차 엑셀 GW → 트럭 등급 규칙 ===');
  for (const gw of [237, 553, 655, 966]) {
    const a = deriveColombiaTruckAllocation(gw);
    check(`${gw}kg → 1t 1대`, a.Truck1t === 1 && a.Truck2_5t === 0 && a.Truck5t === 0);
  }
  check('1371kg → 2.5t 1대', (() => {
    const a = deriveColombiaTruckAllocation(1371);
    return a.Truck1t === 0 && a.Truck2_5t === 1 && a.Truck5t === 0;
  })());
  for (const gw of [6404, 6706, 7020, 7530, 7613]) {
    const a = deriveColombiaTruckAllocation(gw);
    check(`${gw}kg → 5t 1대`, a.Truck1t === 0 && a.Truck2_5t === 0 && a.Truck5t === 1);
  }

  console.log('\n=== 자동 트럭값의 통관비 반영 ===');
  const merged = mergeColombiaTruck(mergeColombiaGw({ HandlingFee: 33000, ItemCount: 4 }, { GW: 7613, CW: 7613 }), { GW: 7613, CW: 7613 });
  check('입고 GW가 저장값이 없을 때 자동 병합', merged.GW === 7613 && merged.CW === 7613);
  check('자동 트럭 source 표시', merged.truckSource === 'warehouse_gw_auto');
  check('7613kg 트럭료가 5t 단가로 계산', near(computeColombiaCustomsTotal(merged, RATE_DEFAULTS), 3849980));

  console.log('\n=== 국가별 월드 운송료 GW 자동계산 (단일 GW 등급표) ===');
  check('800kg → 월드운송료 1t', deriveWorldFreight(800, RATE_DEFAULTS).amount === RATE_DEFAULTS.Truck1t);
  check('1800kg → 월드운송료 2.5t', deriveWorldFreight(1800, RATE_DEFAULTS).amount === RATE_DEFAULTS.Truck2_5t);
  check('7613kg → 월드운송료 5t', deriveWorldFreight(7613, RATE_DEFAULTS).amount === RATE_DEFAULTS.Truck5t);
  check('월드운송료 부가세 포함→제외 변환', vatInclusiveToNet(99000) === 90000 && vatNetToInclusive(90000) === 99000);

  console.log('\n=== 국가별 월드 운송료는 1차+2차 결합 GW로 트럭 1대만 선정 (2026-08-12 결함수정) ===');
  // 결함: 이전에는 1차 GW와 2차 GW를 각각 별도 트럭으로 계산해 26차에 이중계상이 발생했다.
  // 이제는 그 대차수 국가의 GW1+GW2를 합산한 뒤 트럭 1대만 선정해 1차 칸에 전액 반영하고 2차는 0이다.
  const worldAuto = effectiveCountryWorldFreight({}, { GW1: 800, GW2: 1800 }, RATE_DEFAULTS);
  check('800+1800=2600kg → 결합 5t 트럭 1대(2.5t+1t 이중계상 아님)',
    worldAuto.row.WorldFreight1 === RATE_DEFAULTS.Truck5t && worldAuto.row.WorldFreight2 === 0,
    `WorldFreight1=${worldAuto.row.WorldFreight1} WorldFreight2=${worldAuto.row.WorldFreight2}`);
  check('화면 자동 월드운송료는 부가세 제외가로 1차 칸에만 표시',
    worldAuto.auto.WorldFreight1 === vatInclusiveToNet(RATE_DEFAULTS.Truck5t) && worldAuto.auto.WorldFreight2 === 0);
  check('2차 칸 source는 결합계산으로 0이 됐음을 설명', worldAuto.source.WorldFreight2 === 'combined_gw_zeroed');

  console.log('\n=== 요청사항 2번 원문 예시 — 26차 콜롬비아 수국/네덜란드/중국 결합 GW 트럭 ===');
  const colombiaHydrangea26 = effectiveCountryWorldFreight({}, { GW1: 2779, GW2: 1444 }, RATE_DEFAULTS);
  check('콜롬비아 수국 26차: 2779+1444=4223kg → 5t 트럭 1대(275,000 gross / 250,000 net)',
    colombiaHydrangea26.row.WorldFreight1 === 275000 && colombiaHydrangea26.row.WorldFreight2 === 0
    && colombiaHydrangea26.auto.WorldFreight1 === 250000,
    JSON.stringify(colombiaHydrangea26.row));
  const nl26 = effectiveCountryWorldFreight({}, { GW1: 192, GW2: 520 }, RATE_DEFAULTS);
  check('네덜란드 26차: 192+520=712kg → 1t 트럭 1대(99,000 gross / 90,000 net)',
    nl26.row.WorldFreight1 === 99000 && nl26.row.WorldFreight2 === 0 && nl26.auto.WorldFreight1 === 90000,
    JSON.stringify(nl26.row));
  const china26 = effectiveCountryWorldFreight({}, { GW1: 646, GW2: 201 }, RATE_DEFAULTS);
  check('중국 26차: 646+201=847kg → 1t 트럭 1대', china26.row.WorldFreight1 === 99000 && china26.row.WorldFreight2 === 0,
    JSON.stringify(china26.row));
  // 이중계상 회귀 방지: 결합 트럭 금액은 GW1 단독 트럭 + GW2 단독 트럭의 합보다 항상 작거나 같아야 한다
  // (콜롬비아 수국 26차는 이전 구현이면 5t(275,000)+2.5t(187,000)=462,000으로 187,000 과다계상됐다).
  const gw1Alone = deriveWorldFreight(2779, RATE_DEFAULTS).amount;
  const gw2Alone = deriveWorldFreight(1444, RATE_DEFAULTS).amount;
  check('결합 계산이 반차수 개별 트럭 합보다 과다계상하지 않음(예전 방식과 달리 이중계상 없음)',
    colombiaHydrangea26.row.WorldFreight1 + colombiaHydrangea26.row.WorldFreight2 < gw1Alone + gw2Alone,
    `결합=${colombiaHydrangea26.row.WorldFreight1} 개별합=${gw1Alone + gw2Alone}`);

  console.log('\n=== 명시적 수기 override는 결합계산보다 우선 보존 ===');
  const worldLegacy = effectiveCountryWorldFreight({ WorldFreight1: 123456 }, { GW1: 800, GW2: 1800 }, RATE_DEFAULTS);
  check('override 플래그 없는 기존 리터럴은 결합 GW 자동값으로 전환(2차는 0)',
    worldLegacy.row.WorldFreight1 === RATE_DEFAULTS.Truck5t && worldLegacy.row.WorldFreight2 === 0
    && worldLegacy.source.WorldFreight1 === 'warehouse_gw_auto');
  const worldOverride = effectiveCountryWorldFreight({ WorldFreight1: 123456, WorldFreight1Manual: 1 }, { GW1: 800, GW2: 1800 }, RATE_DEFAULTS);
  check('1차만 명시적 override면 그 값을 그대로 보존하고 2차는 0(결합 트럭에 이미 반영된 자리)',
    worldOverride.row.WorldFreight1 === 123456 && worldOverride.row.WorldFreight2 === 0
    && worldOverride.source.WorldFreight1 === 'manual_override' && worldOverride.source.WorldFreight2 === 'combined_gw_zeroed');
  const worldBothOverride = effectiveCountryWorldFreight(
    { WorldFreight1: 100000, WorldFreight1Manual: 1, WorldFreight2: 50000, WorldFreight2Manual: 1 },
    { GW1: 800, GW2: 1800 }, RATE_DEFAULTS,
  );
  check('1차·2차 모두 명시적 override면 둘 다 그대로 보존(자동 결합계산 미적용)',
    worldBothOverride.row.WorldFreight1 === 100000 && worldBothOverride.row.WorldFreight2 === 50000
    && worldBothOverride.source.WorldFreight1 === 'manual_override' && worldBothOverride.source.WorldFreight2 === 'manual_override');

  console.log('\n=== 잔여 결함(2026-08-12): override 플래그 없는 레거시 2차 리터럴이 결합 자동값에 이중계상되지 않음 ===');
  // WorldFreight2Manual 없이 WorldFreight2 리터럴만 저장된 구형 행 + 결합 GW 자동값이 둘 다 있으면
  // 1차(결합 트럭 전액)+2차(레거시 리터럴)를 그대로 더하면 이중계상된다. 2차는 반드시 0이어야 한다.
  const worldLegacyBoth = effectiveCountryWorldFreight(
    { WorldFreight1: 111, WorldFreight2: 222 }, { GW1: 800, GW2: 1800 }, RATE_DEFAULTS,
  );
  check('1차·2차 모두 override 플래그 없는 레거시 리터럴이면 결합 자동값이 1차에만 반영되고 2차는 0(이중계상 없음)',
    worldLegacyBoth.row.WorldFreight1 === RATE_DEFAULTS.Truck5t && worldLegacyBoth.row.WorldFreight2 === 0
    && worldLegacyBoth.source.WorldFreight2 === 'combined_gw_zeroed',
    JSON.stringify(worldLegacyBoth.row));
  const worldLegacy2Only = effectiveCountryWorldFreight(
    { WorldFreight2: 222 }, { GW1: 800, GW2: 1800 }, RATE_DEFAULTS,
  );
  check('2차만 override 플래그 없는 레거시 리터럴이면(1차는 원래 비어있음) 결합 자동값이 1차에 반영되고 2차는 0',
    worldLegacy2Only.row.WorldFreight1 === RATE_DEFAULTS.Truck5t && worldLegacy2Only.row.WorldFreight2 === 0
    && worldLegacy2Only.source.WorldFreight2 === 'combined_gw_zeroed',
    JSON.stringify(worldLegacy2Only.row));
  const worldLegacy2NoGw = effectiveCountryWorldFreight({ WorldFreight2: 222 }, { GW1: 0, GW2: 0 }, RATE_DEFAULTS);
  check('결합 GW 자체가 없어 자동값을 낼 수 없을 때만 2차 레거시 리터럴을 보존(과거 저장분을 조용히 지우지 않음)',
    worldLegacy2NoGw.row.WorldFreight2 === 222 && worldLegacy2NoGw.source.WorldFreight2 === 'legacy_saved');

  console.log('\n=== 자동 GW는 검증 오류로 재표시하지 않음 ===');
  const audited = buildProfitReportAudit([{
    category: '콜롬비아 장미',
    auto: { N: 100 },
    manual: {},
    stock: {},
    source: { H: 'gw_auto' },
  }]);
  check('자동 GW만으로 CUSTOMS_GW_AUTO 경고를 만들지 않음', !audited.issues.some((x) => x.code === 'CUSTOMS_GW_AUTO'));
  check('자동 GW 외 누락이 없으면 준비완료', audited.status === 'ready', JSON.stringify(audited));

  console.log('\n=== 국가별 관세·선율 분할 입력 합산 ===');
  const splitInput = normalizeCountryInput({
    Customs1_1: 100, Customs1_2: 200, Customs1_3: 50,
    Customs2_1: 10, Customs2_2: 20, Customs2_3: '',
    SunYul1_1: 110, SunYul1_2: 220, SunYul1_3: 55,
    SunYul2_1: 55, SunYul2_2: '', SunYul2_3: 0,
  });
  check('관세 1차 1/2/3 합계가 Customs1에 저장', splitInput.Customs1 === 350);
  check('관세 2차 1/2/3 합계가 Customs2에 저장', splitInput.Customs2 === 30);
  check('선율 1차 1/2/3 합계가 SunYul1에 저장', splitInput.SunYul1 === 385);
  check('선율 2차 1/2/3 합계가 SunYul2에 저장', splitInput.SunYul2 === 55);
  check('국가 통관비 계산이 분할 합계를 사용', near(computeCountryCustomsTotal(splitInput, RATE_DEFAULTS, '태국'), 350 + 30 + 385 / 1.1 + 55 / 1.1));
  check('빈 분할칸은 합계 0으로 저장', normalizeCountryInput({ Customs1_1: '', Customs1_2: '', Customs1_3: '' }).Customs1 === 0);

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

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
    buildForwardingLedger,
    isForwardingValueItem,
    explicitForwardingCategory,
  } = await import('../lib/customsForwarding.js');
  const { deriveColombiaTruckAllocation } = await import('../lib/colombiaTruck.js');
  const { buildProfitReportAudit } = await import('../lib/profitReportAudit.js');
  const forwardingSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'customsForwarding.js'), 'utf8');

  console.log('\n=== 운송료 전표 자동분류·원천합계 대조 ===');
  check('공용 항공료 판정이 한글·영문 항공료를 포함',
    isForwardingValueItem('장미 운송료') && isForwardingValueItem('AIR FREIGHT') && isForwardingValueItem('SERVICE FEE'));
  check('Gross/Chargeable weight는 금액 전표에서 제외',
    !isForwardingValueItem('Gross weight') && !isForwardingValueItem('Chargeable weight'));
  check('명시 품목명은 콜롬비아 화종과 국가를 직접 결정',
    explicitForwardingCategory('현지상차운임') === '콜롬비아 수국'
      && explicitForwardingCategory('카네이션 운송료') === '콜롬비아 카네이션'
      && explicitForwardingCategory('장미 운송료') === '콜롬비아 장미'
      && explicitForwardingCategory('루스커스 운송료') === '콜롬비아 루스커스'
      && explicitForwardingCategory('네덜란드 운송료') === '네덜란드');

  const row = (overrides = {}) => ({
    OrderYear: '2026', OrderWeek: '31-01', WarehouseKey: 1, WarehouseDetailKey: 1,
    OrderNo: 'AWB-1', InvoiceNo: 'INV-1', FarmName: 'TEST', ProdKey: 1,
    ProdName: 'ROSE / Test 50cm', FlowerName: '장미', CounName: '콜롬비아',
    TPrice: 100, OutQuantity: 1, BoxQuantity: 0, BunchQuantity: 1, SteamQuantity: 10,
    ...overrides,
  });
  const reconciled = buildForwardingLedger([
    row(),
    row({ WarehouseDetailKey: 2, ProdKey: 2, ProdName: 'AIR FREIGHT', FlowerName: '국내', CounName: '국내', TPrice: 50 }),
    row({ WarehouseKey: 2, WarehouseDetailKey: 3, OrderNo: 'AWB-NL', InvoiceNo: 'INV-NL', FarmName: 'HOLEX', ProdKey: 3, ProdName: 'Tulip White', FlowerName: '튤립', CounName: '네덜란드', TPrice: 200 }),
    row({ WarehouseKey: 2, WarehouseDetailKey: 4, OrderNo: 'AWB-NL', InvoiceNo: 'INV-NL', FarmName: 'HOLEX', ProdKey: 4, ProdName: 'SERVICE FEE', FlowerName: '국내', CounName: '국내', TPrice: 20 }),
    row({ WarehouseKey: 3, WarehouseDetailKey: 5, OrderNo: 'AWB-COL', InvoiceNo: 'COL', FarmName: 'FREIGHTWISE', ProdKey: 5, ProdName: '카네이션 운송료', FlowerName: '국내', CounName: '국내', TPrice: 30 }),
    row({ WarehouseKey: 4, WarehouseDetailKey: 6, OrderNo: 'AWB-W', InvoiceNo: 'W', FarmName: 'FREIGHTWISE', ProdKey: 6, ProdName: 'Gross weight', FlowerName: '국내', CounName: '국내', TPrice: 999 }),
  ], { major: 31, orderYear: '2026' });
  check('같은 BILL/AWB와 명시 품목 규칙으로 포워딩을 전부 분류',
    reconciled.status === 'ready' && reconciled.classifiedRowCount === 3 && reconciled.unmatchedRows.length === 0,
    JSON.stringify(reconciled));
  check('분류 결과는 국가별 직접합계/콜롬비아 공유합계로 중복 없이 연결',
    reconciled.direct['콜롬비아 장미'] === 50 && reconciled.direct['네덜란드'] === 20
      && reconciled.direct['콜롬비아 카네이션'] === 30
      && near(reconciled.classificationDelta, 0));
  check('무게 placeholder 금액은 항공료 원천합계에서 제외', reconciled.sourceTotal === 100);

  const unknown = buildForwardingLedger([
    row({ WarehouseKey: 10, WarehouseDetailKey: 10, OrderNo: 'UNKNOWN', InvoiceNo: '', FarmName: '', ProdName: 'AIR FREIGHT', FlowerName: '', CounName: '', TPrice: 10 }),
  ], { major: 31, orderYear: '2026' });
  check('국가 근거 없는 항공료는 USD 추정하지 않고 UNKNOWN 미분류로 차단',
    unknown.status === 'incomplete' && unknown.unmatchedRows.length === 1 && unknown.totalsByCurrency.UNKNOWN?.unmatched === 10,
    JSON.stringify(unknown));

  const missing31 = buildForwardingLedger([
    row({ WarehouseKey: 20, WarehouseDetailKey: 20, OrderWeek: '31-02', TPrice: 200 }),
  ], { major: 31, orderYear: '2026' });
  check('29차 이후 구매 범위에 항공료가 없으면 누락 범위를 구체적으로 차단',
    missing31.status === 'incomplete'
      && missing31.missingExpectedScopes.some((item) => item.orderWeek === '31-02' && item.category === '콜롬비아 장미'),
    JSON.stringify(missing31));
  const blankDetail = buildForwardingLedger([
    row({ WarehouseKey: 21, WarehouseDetailKey: 21, OrderWeek: '31-02', TPrice: 0, OutQuantity: 0, BunchQuantity: 0, SteamQuantity: 0 }),
  ], { major: 31, orderYear: '2026' });
  check('금액·수량 0 빈 상세행은 항공료 필요 범위로 오판하지 않음',
    blankDetail.status === 'ready' && blankDetail.missingExpectedScopes.length === 0);
  const missing28 = buildForwardingLedger([
    row({ WarehouseKey: 22, WarehouseDetailKey: 22, OrderWeek: '28-02', TPrice: 200 }),
  ], { major: 28, orderYear: '2026' });
  check('29차 이전 동일 누락은 역사자료 검토 대상으로만 표시', missing28.status === 'review' && !missing28.strict);

  const forwardingAudit = buildProfitReportAudit([{
    category: '콜롬비아 장미', currency: 'USD', auto: { Q: 100, S: 0, R: 1450 }, manual: {}, stock: {},
    source: { H: 'gw_auto', S: 'missing', R: 'saved_official_week' },
  }], { major: 31, forwardingLedger: missing31 });
  check('29차 이후 포워딩 누락은 보고서 검증을 실제로 중단',
    forwardingAudit.issues.some((item) => item.code === 'FORWARDING_INCOMPLETE')
      && forwardingAudit.issues.some((item) => item.code === 'FORWARDING_SCOPE_MISSING'));
  const historicalAudit = buildProfitReportAudit([{
    category: '콜롬비아 장미', currency: 'USD', auto: { Q: 100, S: 0, R: 1450 }, manual: {}, stock: {},
    source: { H: 'gw_auto', S: 'missing', R: 'saved_official_week' },
  }], { major: 28, forwardingLedger: missing28 });
  check('28차 이전 포워딩 누락은 신규 엄격 차단을 적용하지 않음',
    !historicalAudit.issues.some((item) => String(item.code).startsWith('FORWARDING_')));
  const previousAudit = buildProfitReportAudit([{
    category: '콜롬비아 장미', currency: 'USD', auto: { Q: 100, S: 10, R: 1450 }, manual: {}, stock: {},
    source: { H: 'gw_auto', S: 'auto', R: 'saved_official_week' },
  }], {
    major: 32,
    forwardingLedger: reconciled,
    previousMajor: 31,
    previousOrderYear: '2026',
    previousForwardingLedger: missing31,
  });
  check('직전차수 포워딩 누락도 현재 기초재고가 조용히 확정되지 않도록 차단',
    previousAudit.issues.some((item) => item.code === 'PREVIOUS_FORWARDING_INCOMPLETE' && item.columns.includes('E')));
  check('입고 원장 조회는 연도+대차수로 제한하고 수량·금액·BILL/AWB 근거를 함께 읽음',
    forwardingSource.includes("wm.OrderWeek LIKE @pfx")
      && forwardingSource.includes("wm.OrderYear AS NVARCHAR(4)")
      && forwardingSource.includes('wd.OutQuantity')
      && forwardingSource.includes('wm.OrderNo'));

  console.log('=== 22~27차 GW → 트럭 추천(용량분해, 2026-08-12: 등급표 1건 선택에서 변경) ===');
  // 5t 묶음을 먼저 빼고, 남은 중량은 1t/2.5t/2.5t+1t 조합으로 덮는다(3t=2.5t+1t).
  // 이 값은 "추천"이며, 저장된 실제 대수가 있으면
  // mergeColombiaTruck()이 그 실제값을 우선한다(아래 별도 검증).
  for (const gw of [237, 553, 655, 966]) {
    const a = deriveColombiaTruckAllocation(gw);
    check(`${gw}kg 추천 → 1t 1대`, a.Truck1t === 1 && a.Truck2_5t === 0 && a.Truck5t === 0);
  }
  check('1371kg 추천 → 2.5t 1대', (() => {
    const a = deriveColombiaTruckAllocation(1371);
    return a.Truck1t === 0 && a.Truck2_5t === 1 && a.Truck5t === 0;
  })());
  check('6404kg 추천 → 5t 1대 + 2.5t 1대', (() => {
    const a = deriveColombiaTruckAllocation(6404);
    return a.Truck5t === 1 && a.Truck2_5t === 1 && a.Truck1t === 0;
  })());
  check('7530kg 추천 → 5t 1대 + 2.5t 1대 + 1t 1대', (() => {
    const a = deriveColombiaTruckAllocation(7530);
    return a.Truck5t === 1 && a.Truck2_5t === 1 && a.Truck1t === 1;
  })());
  check('3,000kg 추천 = 2.5t 1대 + 1t 1대(요청사항 원문 예시, 5t로 바꾸지 않음)', (() => {
    const a = deriveColombiaTruckAllocation(3000);
    return a.Truck2_5t === 1 && a.Truck1t === 1 && a.Truck5t === 0;
  })());

  console.log('\n=== 저장된 실제 트럭 대수는 추천값으로 덮이지 않음(2026-08-12) ===');
  const actualTruck = mergeColombiaTruck({ GW: 7613, Truck5t: 1 }, { GW: 7613, CW: 7613 });
  check('실제 대수가 있으면 truckSource=saved_actual, 추천값으로 재계산하지 않음',
    actualTruck.truckSource === 'saved_actual' && actualTruck.Truck5t === 1 && actualTruck.Truck2_5t === undefined);

  console.log('\n=== 자동 트럭값(추천)의 통관비 반영 ===');
  const merged = mergeColombiaTruck(mergeColombiaGw({ HandlingFee: 33000, ItemCount: 4 }, { GW: 7613, CW: 7613 }), { GW: 7613, CW: 7613 });
  check('입고 GW가 저장값이 없을 때 자동 병합', merged.GW === 7613 && merged.CW === 7613);
  check('자동 트럭 source 표시', merged.truckSource === 'warehouse_gw_auto');
  check('7613kg 추천 트럭료(5t+2.5t+1t 합산) 반영', near(computeColombiaCustomsTotal(merged, RATE_DEFAULTS), 4135980));

  console.log('\n=== 국가별 월드 운송료 GW 자동계산(용량분해) ===');
  check('800kg → 월드운송료 1t', deriveWorldFreight(800, RATE_DEFAULTS).amount === RATE_DEFAULTS.Truck1t);
  check('1,800kg → 월드운송료 2.5t 1대', deriveWorldFreight(1800, RATE_DEFAULTS).amount === RATE_DEFAULTS.Truck2_5t);
  check('7,613kg → 5t+2.5t+1t 합산', deriveWorldFreight(7613, RATE_DEFAULTS).amount
    === RATE_DEFAULTS.Truck5t + RATE_DEFAULTS.Truck2_5t + RATE_DEFAULTS.Truck1t);
  check('월드운송료 부가세 포함→제외 변환', vatInclusiveToNet(99000) === 90000 && vatNetToInclusive(90000) === 99000);

  console.log('\n=== 국가별 월드 운송료는 1차+2차 결합 GW로 트럭을 선정 (2026-08-12 결함수정) ===');
  // 결함: 이전에는 1차 GW와 2차 GW를 각각 별도 트럭으로 계산해 26차에 이중계상이 발생했다.
  // 이제는 그 대차수 국가의 GW1+GW2를 합산한 뒤 용량분해 추천값을 1차 칸에 전액 반영하고 2차는 0이다.
  const worldAuto = effectiveCountryWorldFreight({}, { GW1: 800, GW2: 1800 }, RATE_DEFAULTS);
  check('800+1800=2,600kg → 결합 2.5t 1대+1t 1대(286,000, 이중계상 아님)',
    worldAuto.row.WorldFreight1 === 286000 && worldAuto.row.WorldFreight2 === 0,
    `WorldFreight1=${worldAuto.row.WorldFreight1} WorldFreight2=${worldAuto.row.WorldFreight2}`);
  check('화면 자동 월드운송료는 부가세 제외가로 1차 칸에만 표시',
    worldAuto.auto.WorldFreight1 === vatInclusiveToNet(286000) && worldAuto.auto.WorldFreight2 === 0);
  check('2차 칸 source는 결합계산으로 0이 됐음을 설명', worldAuto.source.WorldFreight2 === 'combined_gw_zeroed');

  console.log('\n=== 요청사항 2번 원문 예시 — 26차 콜롬비아 수국/네덜란드/중국 결합 GW 트럭 ===');
  const colombiaHydrangea26 = effectiveCountryWorldFreight({}, { GW1: 2779, GW2: 1444 }, RATE_DEFAULTS);
  check('콜롬비아 수국 26차: 2779+1444=4,223kg → 결합 2.5t 1대+1t 2대(385,000 gross / 350,000 net)',
    colombiaHydrangea26.row.WorldFreight1 === 385000 && colombiaHydrangea26.row.WorldFreight2 === 0
    && colombiaHydrangea26.auto.WorldFreight1 === 350000,
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
    worldLegacy.row.WorldFreight1 === 286000 && worldLegacy.row.WorldFreight2 === 0
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
    worldLegacyBoth.row.WorldFreight1 === 286000 && worldLegacyBoth.row.WorldFreight2 === 0
    && worldLegacyBoth.source.WorldFreight2 === 'combined_gw_zeroed',
    JSON.stringify(worldLegacyBoth.row));
  const worldLegacy2Only = effectiveCountryWorldFreight(
    { WorldFreight2: 222 }, { GW1: 800, GW2: 1800 }, RATE_DEFAULTS,
  );
  check('2차만 override 플래그 없는 레거시 리터럴이면(1차는 원래 비어있음) 결합 자동값이 1차에 반영되고 2차는 0',
    worldLegacy2Only.row.WorldFreight1 === 286000 && worldLegacy2Only.row.WorldFreight2 === 0
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

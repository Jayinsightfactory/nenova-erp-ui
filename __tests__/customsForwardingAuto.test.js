// 입고 GW/CW 기반 콜롬비아 트럭 자동계산·매출이익 검증 회귀 테스트
// 실행: node __tests__/customsForwardingAuto.test.js
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
  } = await import('../lib/customsForwarding.js');
  const { deriveColombiaTruckAllocation } = await import('../lib/colombiaTruck.js');
  const { buildProfitReportAudit } = await import('../lib/profitReportAudit.js');

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

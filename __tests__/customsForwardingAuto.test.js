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
    mergeColombiaGw,
    mergeColombiaTruck,
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

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

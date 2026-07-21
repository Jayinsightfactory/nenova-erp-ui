// 견적 확정 사이클 단위 검증
// 실행: node __tests__/estimateFixCycle.test.js

async function main() {
  const { getFixCycleWeeksForEditedItems } = await import('../lib/estimateFixCycle.js');
  const fs = await import('node:fs');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  const ship = { SubWeeksFix: '24-02:1', SubWeeks: '24-01,24-02' };
  const edited = [
    { OrderWeek: '24-01', ProdName: 'Hydrangea' },
    { OrderWeek: '24-01', ProdName: 'Freight' },
  ];

  console.log('=== getFixCycleWeeksForEditedItems ===');
  const cycle = getFixCycleWeeksForEditedItems(edited, ship);
  assert('24-01 수정 시 24-01 포함', cycle.includes('24-01'));
  assert('24-02 trailing 포함', cycle.includes('24-02'));

  const only02 = getFixCycleWeeksForEditedItems([{ OrderWeek: '24-02' }], ship);
  assert('24-02만 수정', only02.join(',') === '24-02');

  const page = fs.readFileSync('pages/estimate.js', 'utf8');
  const fixApi = fs.readFileSync('pages/api/shipment/fix.js', 'utf8');
  assert('통합 저장도 자동 확정 사이클을 사용', page.includes('runCombinedFixCycle'));
  assert('통합 저장은 서버 확정 범위 오류를 재시도', page.includes('firstError.fixedWeeks'));
  assert('자동 사이클은 전체 고정 범위를 해제·재확정', page.includes('countryFlowers: []'));
  assert('확정 후보 조회는 OrderYear를 사용', fixApi.includes('CAST(sm.OrderYear AS NVARCHAR(4)), @yr'));
  assert('확정 후보 함수에 OrderYear 전달', fixApi.includes('loadShipmentCategoryTargets(orderYear, orderWeek'));
  assert('재고 재계산 품목 조회에 OrderYear 전달', fixApi.includes('loadShipmentProdKeys(orderYear, orderWeek'));

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

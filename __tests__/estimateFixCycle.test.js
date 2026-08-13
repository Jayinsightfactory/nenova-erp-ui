// 견적 확정 사이클 단위 검증
// 실행: node __tests__/estimateFixCycle.test.js

async function main() {
  const { spawnSync } = await import('node:child_process');
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
  assert('확정 후보 조회는 OrderYear를 사용', fixApi.includes('sm.OrderYear=@yr AND sm.OrderWeek=@wk'));
  assert('확정 후보 함수에 OrderYear 전달', fixApi.includes('loadShipmentCategoryTargets(orderYear, orderWeek'));
  assert('재고 재계산 품목 조회에 OrderYear 전달', fixApi.includes('loadShipmentProdKeys(orderYear, orderWeek'));
  assert('확정 음수검사는 전차수+입고+조정-출고 공식을 사용', fixApi.includes("ROUND(ISNULL(prev.Stock,0)+ISNULL(i.qty,0)+ISNULL(a.qty,0)-ISNULL(o.qty,0),2) < 0"));
  assert('카테고리형 SP도 전체 음수검사를 우회하지 않음', !fixApi.includes('if (!procedureShape.hasCountryFlower) {\n    const wholeWeekNegativeRows'));
  assert('전차수 음수 이월도 확정을 차단', fixApi.includes('OR ISNULL(prev.Stock,0)<0'));
  assert('클라이언트 skipStockCalc로 재고 재계산을 우회하지 못함', !fixApi.includes('const skipStockCalc = req.body?.skipStockCalc === true'));
  assert('부족분 자동보정은 Product.Stock도 EXE 순서대로 갱신', fixApi.includes("UPDATE Product SET Stock=ROUND(@after, 2) WHERE ProdKey=@pk"));
  assert('대량 재고 재계산도 보정 트랜잭션 queryFn을 사용', fixApi.includes('{ retries: 4, baseDelay: 300, queryFn: logContext.queryFn }'));

  const yearContract = spawnSync(process.execPath, ['__tests__/estimateFixStatusYearContract.test.js'], { stdio: 'inherit' });
  assert('확정현황 선택연도/교차연도 계약', yearContract.status === 0);
  const editYearContract = spawnSync(process.execPath, ['__tests__/estimateEditYearContract.test.js'], { stdio: 'inherit' });
  assert('견적 편집 선택연도/교차연도/SSR 계약', editYearContract.status === 0);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

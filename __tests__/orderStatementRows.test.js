// __tests__/orderStatementRows.test.js
// 실행: node __tests__/orderStatementRows.test.js

async function main() {
  const {
    orderDetailQuantityAndUnit,
    buildPrintRowsFromOrderDetails,
    parentWeekFromOrderWeek,
  } = await import('../lib/orderStatementRows.js');

  let passed = 0;
  let failed = 0;
  const assert = (cond, msg) => {
    if (cond) passed++;
    else { failed++; console.error('FAIL:', msg); }
  };

  const u1 = orderDetailQuantityAndUnit({
    BoxQuantity: 10, BunchQuantity: 0, SteamQuantity: 0, OutUnit: '박스',
  });
  assert(u1.unit === '박스' && u1.qty === 10, 'box qty');

  const u2 = orderDetailQuantityAndUnit({
    BoxQuantity: 0, BunchQuantity: 133, SteamQuantity: 0, OutUnit: '단',
  });
  assert(u2.unit === '단' && u2.qty === 133, 'bunch qty');

  const u3 = orderDetailQuantityAndUnit({
    BoxQuantity: 0, BunchQuantity: 0, SteamQuantity: 7, OutUnit: '송이',
  });
  assert(u3.unit === '송이' && u3.qty === 7, 'stem qty');

  const rows = buildPrintRowsFromOrderDetails([
    { ProdKey: 1, ProdName: 'ROSE A', DisplayName: '장미 A', FlowerName: '장미', CounName: '콜롬비아', BunchQuantity: 50, OutUnit: '단', Cost: 1100 },
    { ProdKey: 1, ProdName: 'ROSE A', DisplayName: '장미 A', FlowerName: '장미', CounName: '콜롬비아', BunchQuantity: 30, OutUnit: '단', Cost: 1100 },
    { ProdKey: 2, ProdName: 'HYDR W', DisplayName: '수국 W', FlowerName: '수국', CounName: '콜롬비아', BoxQuantity: 5, OutUnit: '박스', Cost: 9130 },
  ]);
  assert(rows.length === 2, 'merge by prod+unit');
  assert(rows.find(r => r.ProdKey === 1)?.Quantity === 80, 'sum same prod unit');

  assert(parentWeekFromOrderWeek('2026-28-01') === '28', 'parent from full week');
  assert(parentWeekFromOrderWeek('28-02') === '28', 'parent from sub week');

  console.log(`orderStatementRows.test: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });

// 견적서 불변조건 단위 검증
// 실행: node __tests__/estimateInvariants.test.js

async function main() {
  const {
    weekdayFromYmd,
    weekdayKrFromYmd,
    filterItemsByWeekday,
    estimateAggregateKey,
    checkCostQtyInvariant,
    checkSplitSumInvariant,
    splitEstByShipQty,
  } = await import('../lib/estimateInvariants.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) { pass++; }
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  console.log('=== weekdayFromYmd (KST 로컬) ===');
  assert('2026-06-04 = 목', weekdayKrFromYmd('2026-06-04') === '목');
  assert('2026-06-07 = 일', weekdayKrFromYmd('2026-06-07') === '일');
  assert('invalid = empty', weekdayKrFromYmd('') === '');

  console.log('\n=== filterItemsByWeekday (주광 Lavender 시뮬) ===');
  const lavRows = [
    { ProdKey: 1, ProdName: 'ALSTROMERIA Lavender', Quantity: 160, outDate: '2026-06-04', EstimateType: '정상출고' },
    { ProdKey: 1, ProdName: 'ALSTROMERIA Lavender', Quantity: 320, outDate: '2026-06-07', EstimateType: '정상출고' },
  ];
  const thuOnly = filterItemsByWeekday(lavRows, new Set(['목']));
  assert('목요일만 1행', thuOnly.length === 1);
  assert('목요일 수량 160', thuOnly[0]?.Quantity === 160);
  const all = filterItemsByWeekday(lavRows, new Set(['월', '화', '수', '목', '금', '토', '일']));
  assert('전체 7요일 2행', all.length === 2);
  assert('미선택 0행', filterItemsByWeekday(lavRows, new Set()).length === 0);

  console.log('\n=== estimateAggregateKey (출고일별 병합 방지) ===');
  const k1 = estimateAggregateKey({ ProdKey: 1, Unit: '송이', Cost: 700, outDate: '2026-06-04' });
  const k2 = estimateAggregateKey({ ProdKey: 1, Unit: '송이', Cost: 700, outDate: '2026-06-07' });
  assert('출고일 다르면 키 다름', k1 !== k2);

  console.log('\n=== checkCostQtyInvariant ===');
  const costRow = { Quantity: 160, Cost: 700, Amount: 101818, Vat: 10182 };
  assert('160×700=101818+10182', checkCostQtyInvariant(costRow).ok);

  console.log('\n=== checkSplitSumInvariant (480=160+320) ===');
  const split = checkSplitSumInvariant(
    [
      { Quantity: 160, Amount: 101818, Vat: 10182 },
      { Quantity: 320, Amount: 203637, Vat: 20363 },
    ],
    { EstQuantity: 480, Amount: 305455, Vat: 30545 }
  );
  assert('분할 합=Detail', split.ok);

  console.log('\n=== splitEstByShipQty (16+32 → 160+320) ===');
  const parts = splitEstByShipQty(480, [
    { ShipmentQuantity: 16, ShipmentDtm: '2026-06-04' },
    { ShipmentQuantity: 32, ShipmentDtm: '2026-06-07' },
  ]);
  assert('expQty 160', parts[0].expQty === 160);
  assert('expQty 320', parts[1].expQty === 320);
  assert('합 480', parts[0].expQty + parts[1].expQty === 480);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

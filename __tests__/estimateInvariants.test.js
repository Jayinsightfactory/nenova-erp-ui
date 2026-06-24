// 견적서 불변조건 단위 검증
// 실행: node __tests__/estimateInvariants.test.js

async function main() {
  const {
    weekdayFromYmd,
    weekdayKrFromYmd,
    filterItemsByWeekday,
    filterPrintTargetItems,
    formatEstimatePrintDescr,
    isOperationalEstimateDescr,
    isPrintableEstimateRow,
    isEstimateDeductionRow,
    sanitizeEstimateDescrForDisplay,
    estimateAggregateKey,
    checkCostQtyInvariant,
    checkSplitSumInvariant,
    splitEstByDistributeUnits,
    applyByDateRowQuantities,
    filterActiveEstimateShipmentRows,
  } = await import('../lib/estimateInvariants.js');
  const { distributeUnits } = await import('../lib/distributeUnits.js');
  const { scaleShipmentDateQtys } = await import('../lib/syncShipmentDateEst.js');

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
  const withDed = [
    ...lavRows,
    { ProdKey: 99, ProdName: 'HYDRANGEA White', Quantity: -2, outDate: '2026-06-01', EstimateType: '불량차감/송이' },
  ];
  const thuWithDed = filterItemsByWeekday(withDed, new Set(['목']));
  assert('목 필터 + 차감 1행 포함', thuWithDed.length === 2);
  assert('차감 행 유지', thuWithDed.some(r => r.EstimateType === '불량차감/송이'));

  console.log('\n=== filterPrintTargetItems (종합/선출고) ===');
  const mixed = [
    { ProdKey: 1, Quantity: 10, outDate: '2026-06-04', EstimateType: '정상출고' },
    { ProdKey: 2, Quantity: -2, outDate: '2026-06-01', EstimateType: '불량차감/송이' },
  ];
  const totalPrint = filterPrintTargetItems(mixed, new Set(['목']), 'total');
  assert('종합출고: 차감 포함 2행', totalPrint.length === 2);
  const selectPrint = filterPrintTargetItems(mixed, new Set(['목']), 'select');
  assert('선출고: 정상출고만 1행', selectPrint.length === 1);
  const zeroDed = [
    { ProdKey: 3, Quantity: 0, Amount: 0, Vat: 0, EstimateType: '불량차감/송이', ProdName: 'ROSE Test' },
  ];
  assert('수량0 차감 제외', filterPrintTargetItems(zeroDed, new Set(['월', '화', '수', '목', '금', '토', '일']), 'total').length === 0);

  console.log('\n=== isPrintableEstimateRow (nenova.exe FormPrintEstimate) ===');
  assert('수량0 정상출고 제외(금액 있어도)', !isPrintableEstimateRow({ EstimateType: '정상출고', Quantity: 0, Amount: 1000, Vat: 100 }));
  assert('수량>0 단가0 출력', isPrintableEstimateRow({ EstimateType: '정상출고', Quantity: 10, Cost: 0, Amount: 0, Vat: 0 }));
  assert('수량 음수 차감 출력', isPrintableEstimateRow({ EstimateType: '불량차감/송이', Quantity: -2, Amount: -100, Vat: -10 }));

  console.log('\n=== formatEstimatePrintDescr (적요) ===');
  assert('변경이력 Descr 제외', formatEstimatePrintDescr({ EstimateType: '정상출고', Descr: '임16>12,임12>14' }) === '');
  assert('차감 출고일', formatEstimatePrintDescr(
    { EstimateKey: 1, EstimateType: '불량차감/송이', outDate: '2026-06-04' }
  ) === '4일');
  assert('차감 Descr 로그 미출력', formatEstimatePrintDescr(
    { EstimateKey: 1, EstimateType: '검역차감/송이', Descr: '차감수량 10>8', outDate: '2026-06-04' }
  ) === '4일');
  assert('차수별 분배(옵션)', formatEstimatePrintDescr(
    { EstimateType: '정상출고', _distribDesc: '1차 10단, 2차 5단' },
    { showDistribDesc: true }
  ) === '1차 10단, 2차 5단');
  assert('운영로그 판별', isOperationalEstimateDescr('임16>12,임12>14'));
  assert('일반 메모는 유지', formatEstimatePrintDescr({ EstimateType: '정상출고', Descr: '특별요청' }) === '특별요청');
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

  console.log('\n=== applyByDateRowQuantities (차감 수량 유지) ===');
  const dedRow = {
    EstimateType: '불량차감/송이',
    DateShipQty: null,
    OutUnit: '박스',
    EstUnit: '송이',
    SteamOf1Box: 10,
    Quantity: -5,
    Amount: -3182,
    Vat: -318,
    Cost: 700,
  };
  const kept = applyByDateRowQuantities([dedRow])[0];
  assert('차감 Quantity 유지', kept.Quantity === -5);
  assert('차감 Amount 유지', kept.Amount === -3182);
  const normalRow = {
    EstimateType: '정상출고',
    DateShipQty: 16,
    OutUnit: '박스',
    EstUnit: '송이',
    SteamOf1Box: 10,
    Quantity: 999,
    Cost: 700,
  };
  const remapped = applyByDateRowQuantities([normalRow])[0];
  assert('정상출고 16박스→160송이', remapped.Quantity === 160);

  console.log('\n=== filterActiveEstimateShipmentRows (OutQuantity=0 유령행·수량0 차감) ===');
  const ghosts = filterActiveEstimateShipmentRows([
    { EstimateType: '정상출고', ProdName: 'MEL ROSE', Quantity: 0, Cost: 0, Amount: 0, Vat: 0 },
    { EstimateType: '정상출고', ProdName: 'Freedom', Quantity: 60, Cost: 13700, Amount: 747273, Vat: 74727 },
    { EstimateKey: 99, EstimateType: '단가차감', ProdName: 'ROSE', Quantity: 0, Cost: 2700, Amount: 0, Vat: 0 },
    { EstimateKey: 100, EstimateType: '불량차감/송이', ProdName: 'ROSE', Quantity: -3, Cost: 700, Amount: -1918, Vat: -192 },
  ]);
  assert('유령 정상출고 제외', ghosts.length === 2);
  assert('수량0 단가차감 제외', !ghosts.some(r => r.EstimateType === '단가차감'));
  assert('수량 음수 불량차감 유지', ghosts.some(r => r.EstimateType === '불량차감/송이'));

  console.log('\n=== isEstimateDeductionRow (Estimate 전용 행) ===');
  assert('EstimateKey+SdetailKey null', isEstimateDeductionRow({ EstimateKey: 1, EstimateType: 'fee03' }));
  assert('정상출고 ShipmentDetail', !isEstimateDeductionRow({ EstimateKey: null, SdetailKey: 10, EstimateType: '정상출고' }));

  console.log('\n=== sanitizeEstimateDescrForDisplay (차감 비고) ===');
  assert('차감수량 로그 숨김', sanitizeEstimateDescrForDisplay({ EstimateKey: 1, Descr: '차감수량 5>3' }) === '');
  assert('차감단가 로그 숨김', sanitizeEstimateDescrForDisplay({ EstimateKey: 1, Descr: '\n차감단가 700>650' }) === '');

  console.log('\n=== splitEstByDistributeUnits (송이 16+32 → 160+320) ===');
  const steamProd = { OutUnit: '박스', EstUnit: '송이', BunchOf1Box: 0, SteamOf1Bunch: 0, SteamOf1Box: 10 };
  const parts = splitEstByDistributeUnits(
    [
      { ShipmentQuantity: 16, ShipmentDtm: '2026-06-04' },
      { ShipmentQuantity: 32, ShipmentDtm: '2026-06-07' },
    ],
    steamProd,
    700
  );
  assert('expQty 160', parts[0].expQty === 160);
  assert('expQty 320', parts[1].expQty === 320);
  assert('합 480', parts[0].expQty + parts[1].expQty === 480);

  console.log('\n=== distributeUnits 수국 화이트 (주광 23-01) ===');
  const hydr = { OutUnit: '박스', EstUnit: '송이', BunchOf1Box: 0, SteamOf1Bunch: 0, SteamOf1Box: 30 };
  const thu = distributeUnits(10, hydr);
  const sun = distributeUnits(180, hydr);
  assert('목 10박스=300송이', thu.box === 10 && thu.estQty === 300);
  assert('일 180박스=5400송이', sun.box === 180 && sun.estQty === 5400);
  assert('목≠전량190', thu.estQty !== 5700);

  console.log('\n=== scaleShipmentDateQtys (다중 출고일 비율 스케일) ===');
  const dateRows = [
    { SdateKey: 1, ShipmentQuantity: 10 },
    { SdateKey: 2, ShipmentQuantity: 180 },
  ];
  const scaled = scaleShipmentDateQtys(dateRows, 190, 200);
  const scaledSum = scaled.reduce((s, r) => s + r.newShipQty, 0);
  assert('합=200', scaledSum === 200);
  assert('목 비율 유지(≈11)', scaled[0].newShipQty === 11);
  assert('일 나머지(189)', scaled[1].newShipQty === 189);

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

const assert = require('assert');

(async () => {
  const {
    buildChinaVolumeWorkbookRows,
    chinaVolumeCellText,
    chinaVolumeProductLabel,
    parseChinaBoxNumbers,
    splitChinaBoxQuantity,
    parseChinaPackingRows,
    planChinaBoxNeighborAreas,
    matchChinaPackingRows,
    mergeChinaCellAllocations,
    mergeChinaPackingIntoPivotCells,
    validateChinaCellAllocation,
    summarizeChinaVolumeTotals,
  } = await import('../lib/chinaVolumeBoard.js');

  assert.strictEqual(chinaVolumeProductLabel('CHINA / ROSE Diana 50cm'), 'ROSE Diana 50cm');
  assert.strictEqual(chinaVolumeProductLabel('China/ Hydrangea Blue (블루)'), 'Hydrangea Blue (블루)');
  assert.strictEqual(chinaVolumeCellText(20, [{ boxNo: '16' }, { boxNo: '17' }]), '20 (16,17)');
  const workbookRows = buildChinaVolumeWorkbookRows({
    year: 2026,
    week: '35-01',
    customers: [{ custKey: 1, custName: 'CL1', orderCode: 'CL1' }],
    rows: [{ prodKey: 9, prodName: 'CHINA / ROSE Diana 50cm full name', outOrders: { CL1: 20 } }],
    cells: { '1:9': { quantity: 20, allocations: [{ boxNo: '16', quantity: 10 }, { boxNo: '17', quantity: 10 }] } },
  });
  assert.deepStrictEqual(workbookRows[2], ['ROSE Diana 50cm full name', '20 (16,17)']);
  const neighborRows = [
    { prodKey: 1, outOrders: { A: 10, B: 0, C: 5 } },
    { prodKey: 2, outOrders: { A: 0, B: 0, C: 0 } },
  ];
  const neighborCustomers = [
    { custKey: 1, custName: 'A' }, { custKey: 2, custName: 'B' }, { custKey: 3, custName: 'C' },
  ];
  const neighborPlan = planChinaBoxNeighborAreas({
    rows: neighborRows,
    customers: neighborCustomers,
    cells: {
      '1:1': { quantity: 10, allocations: [{ boxNo: '100', quantity: 10 }] },
      '3:1': { quantity: 5, allocations: [{ boxNo: '101', quantity: 5 }] },
    },
  });
  assert.strictEqual(neighborPlan['1:1'], 'right', '오른쪽 빈 셀을 우선 예약한다');
  assert.strictEqual(neighborPlan['3:1'], 'down', '이미 예약됐거나 차 있는 좌우 셀을 덮지 않고 아래 빈 셀을 사용한다');

  assert.deepStrictEqual(parseChinaBoxNumbers('NO.16.17'), ['16', '17']);
  assert.deepStrictEqual(parseChinaBoxNumbers('NO.31-37'), ['31', '32', '33', '34', '35', '36', '37']);
  assert.deepStrictEqual(parseChinaBoxNumbers('NO.9.10.11.12（9送检）'), ['9', '10', '11', '12']);
  assert.deepStrictEqual(splitChinaBoxQuantity(20, ['16', '17']), [
    { boxNo: '16', quantity: 10 },
    { boxNo: '17', quantity: 10 },
  ]);
  assert.deepStrictEqual(splitChinaBoxQuantity(10, ['10', '11']), [
    { boxNo: '10', quantity: 5 },
    { boxNo: '11', quantity: 5 },
  ]);

  const parsed = parseChinaPackingRows([
    ['Customer', 'Box No.', 'Item Name', 'Quantity'],
    ['CL1', 'NO.16.17', 'ROSE Diana', 20],
    ['', 'NO.10.11', 'ROSE Idana', 10],
  ]);
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[1].customerCode, 'CL1');

  const matched = matchChinaPackingRows(parsed, {
    customers: [{ custKey: 7, custName: '주광농원', orderCode: 'CL1' }],
    rows: [
      { prodKey: 70, country: '중국', flower: '장미', prodName: 'ROSE Diana' },
      { prodKey: 71, country: '중국', flower: '장미', prodName: 'ROSE Idana' },
      { prodKey: 99, country: '콜롬비아', flower: '장미', prodName: 'ROSE Diana' },
    ],
  });
  assert.ok(matched.every(row => row.mappingStatus === 'MATCHED'));
  const cells = mergeChinaCellAllocations(matched);
  assert.deepStrictEqual(cells['7:70'].allocations, [
    { boxNo: '16', quantity: 10 },
    { boxNo: '17', quantity: 10 },
  ]);
  assert.strictEqual(validateChinaCellAllocation(cells['7:70']).valid, true);
  const pivotCells = mergeChinaPackingIntoPivotCells(matched, {
    customers: [{ custKey: 7, custName: '주광농원', orderCode: 'CL1' }],
    rows: [
      { prodKey: 70, country: '중국', prodName: 'ROSE Diana', outOrders: { 주광농원: 18 } },
      { prodKey: 71, country: '중국', prodName: 'ROSE Idana', outOrders: { 주광농원: 10 } },
    ],
  });
  assert.strictEqual(pivotCells['7:70'].quantity, 18, '웹 셀 수량은 패킹 20이 아니라 피벗 분배 18을 유지');
  assert.strictEqual(pivotCells['7:70'].packingQuantity, 20);
  assert.strictEqual(validateChinaCellAllocation({ quantity: 20, allocations: [{ boxNo: '16', quantity: 5 }] }).valid, false);

  const totalFixture = {
    pivotData: {
      customers: [{ custKey: 7, custName: '주광농원', orderCode: 'CL1' }],
      rows: [
        { prodKey: 70, country: '중국', prodName: 'ROSE Diana', unit: '단', outOrders: { 주광농원: 18 } },
        { prodKey: 71, country: '중국', prodName: 'HYDRANGEA Blue', unit: '박스', outOrders: { 주광농원: 10 } },
      ],
    },
    packingRows: [
      { sourceRow: 2, mappingStatus: 'MATCHED', cellKey: '7:70', quantity: 20 },
      { sourceRow: 3, mappingStatus: 'MATCHED', cellKey: '7:71', quantity: 10 },
    ],
    cells: {
      '7:70': { quantity: 18, allocations: [{ boxNo: '16', quantity: 20 }] },
      '7:71': { quantity: 10, allocations: [{ boxNo: '17', quantity: 10 }] },
    },
  };
  const totals = summarizeChinaVolumeTotals(totalFixture);
  assert.strictEqual(totals.packingTotal, 30, '원장 전체 합계');
  assert.strictEqual(totals.matchedPackingTotal + totals.unmatchedPackingTotal, totals.packingTotal, '원장 합계 = 매칭 + 미매칭');
  assert.strictEqual(totals.pivotTotal, 28, '피벗 합계는 별도 참고값');
  assert.strictEqual(totals.allocationTotal, 30, '박스 배정 합계');
  assert.strictEqual(totals.pivotVsPackingDifference, -2, '피벗-패킹 차이는 참고값');
  assert.strictEqual(totals.boardAllocationDifference, -2, '현재 표시수량과 박스 배정 합계 차이를 별도 검출');
  assert.deepStrictEqual(totals.unitTotals.map(item => [item.unit, item.packing]), [['단', 20], ['박스', 10]], '단과 박스를 하나의 의미 없는 합계로 섞지 않는다');
  assert.strictEqual(totals.status, 'WARNING', '피벗 차이는 참고값이지만 현재 표시수량과 박스배정이 다르면 확인 경고');

  const exact = summarizeChinaVolumeTotals({
    ...totalFixture,
    cells: {
      '7:70': { quantity: 20, allocations: [{ boxNo: '16', quantity: 20 }] },
      '7:71': { quantity: 10, allocations: [{ boxNo: '17', quantity: 10 }] },
    },
  });
  assert.strictEqual(exact.status, 'OK', '매칭 원장·표시수량·박스배정이 셀별로 같으면 정상');
  assert.strictEqual(exact.mismatches.length, 0);

  const omitted = summarizeChinaVolumeTotals({
    ...totalFixture,
    packingRows: [totalFixture.packingRows[0], { mappingStatus: 'CUSTOMER_UNMATCHED', quantity: 4 }],
    cells: { '7:70': totalFixture.cells['7:70'] },
  });
  assert.strictEqual(omitted.packingTotal, 24);
  assert.strictEqual(omitted.matchedPackingTotal + omitted.unmatchedPackingTotal, 24);
  assert.strictEqual(omitted.unmatchedPackingTotal, 4, '미매칭 원장도 누락 없이 합계에 포함');
  assert.strictEqual(omitted.unmatchedRowCount, 1);
  assert.strictEqual(omitted.status, 'WARNING', '미매칭은 경고');

  const boxShort = summarizeChinaVolumeTotals({
    ...totalFixture,
    cells: { ...totalFixture.cells, '7:70': { quantity: 18, allocations: [{ boxNo: '16', quantity: 19 }] } },
  });
  assert.strictEqual(boxShort.mismatches.length, 1, '품목별 박스 배정 부족을 검출');
  assert.strictEqual(boxShort.mismatches[0].allocationDifference, 1);
  assert.strictEqual(boxShort.status, 'WARNING');

  console.log('chinaVolumeBoard tests passed');
})().catch(error => { console.error(error); process.exit(1); });

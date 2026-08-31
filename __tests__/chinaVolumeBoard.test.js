const assert = require('assert');

(async () => {
  const {
    buildChinaVolumeWorkbookRows,
    applyChinaPackingCustomerMatch,
    rematchChinaPackingRow,
    canApplyChinaPackingRows,
    chinaPackingDistributions,
    chinaVolumeCellText,
    chinaVolumeProductLabel,
    parseChinaBoxNumbers,
    splitChinaBoxQuantity,
    parseChinaPackingRows,
    planChinaBoxNeighborAreas,
    matchChinaPackingRows,
    mergeChinaCellAllocations,
    mergeChinaPackingIntoPivotCells,
    setChinaPackingRowDistributions,
    distributeChinaBoxAllocations,
    restoreChinaPackingCells,
    validateChinaCellAllocation,
    validateChinaPackingDistribution,
    summarizeChinaVolumeTotals,
    stepChinaOrderWeek,
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
  assert.deepStrictEqual(workbookRows[3], ['ROSE Diana 50cm full name', '20 (16,17)']);
  const appliedWorkbookRows = buildChinaVolumeWorkbookRows({
    year: 2026,
    week: '35-01',
    customers: [
      { custKey: 1, custName: 'CL1', orderCode: 'CL1', area: '서울' },
      { custKey: 2, custName: 'CL2', orderCode: 'CL2', area: '경기' },
    ],
    customerDays: { 1: '수', 2: '목' },
    rows: [
      { prodKey: 9, prodName: 'CHINA / ROSE Diana', outOrders: { CL1: 20, CL2: 30 } },
      { prodKey: 10, prodName: 'CHINA / ROSE Unapplied', outOrders: { CL1: 10, CL2: 10 } },
    ],
    cells: { '1:9': { quantity: 20, allocations: [{ boxNo: '16', quantity: 20 }] } },
    appliedOnly: true,
  });
  assert.deepStrictEqual(appliedWorkbookRows, [
    ['2026년 35-01 중국 물량표', '서울'],
    ['출고요일', '수'],
    ['품목', 'CL1\nCL1'],
    ['ROSE Diana', '20 (16)'],
  ], '최종 엑셀은 적용된 셀만 포함하고 거래처 지역·비고 기반 중국 출고요일을 표시한다');
  assert.strictEqual(stepChinaOrderWeek('35-01', -1), '34-01');
  assert.strictEqual(stepChinaOrderWeek('35-1', 1), '36-01');
  assert.strictEqual(stepChinaOrderWeek('01-01', -1), '01-01');
  const matchedPacking = { sourceRow: 2, mappingStatus: 'MATCHED', cellKey: '7:70', quantity: 20, allocations: [{ boxNo: '16', quantity: 10 }, { boxNo: '17', quantity: 10 }] };
  assert.strictEqual(canApplyChinaPackingRows([matchedPacking]), true, '전부 매칭·분배된 인보이스만 적용 가능');
  assert.strictEqual(canApplyChinaPackingRows([matchedPacking, { mappingStatus: 'PRODUCT_UNMATCHED' }]), false, '미매칭 한 건이라도 있으면 적용 차단');
  assert.strictEqual(canApplyChinaPackingRows([]), false, '빈 업로드는 적용할 수 없다');
  const splitPacking = setChinaPackingRowDistributions([matchedPacking], 2, [{ cellKey: '7:70', quantity: 12 }, { cellKey: '8:70', quantity: 8 }])[0];
  assert.deepStrictEqual(chinaPackingDistributions(splitPacking), [{ cellKey: '7:70', quantity: 12 }, { cellKey: '8:70', quantity: 8 }], '한 인보이스 행을 여러 주문 셀로 나눈다');
  assert.strictEqual(validateChinaPackingDistribution(splitPacking).valid, true, '분배합계가 인보이스 원본과 같으면 저장 가능');
  assert.strictEqual(validateChinaPackingDistribution({ ...splitPacking, distributions: [{ cellKey: '7:70', quantity: 19 }] }).valid, false, '미분배 수량이 남으면 적용 차단');
  assert.deepStrictEqual(distributeChinaBoxAllocations(matchedPacking.allocations, splitPacking.distributions), [
    { cellKey: '7:70', quantity: 12, allocations: [{ boxNo: '16', quantity: 10 }, { boxNo: '17', quantity: 2 }] },
    { cellKey: '8:70', quantity: 8, allocations: [{ boxNo: '17', quantity: 8 }] },
  ], '분배 대상이 나뉘어도 원본 박스번호와 수량을 순서대로 보존한다');
  assert.deepStrictEqual(mergeChinaCellAllocations([splitPacking]), {
    '7:70': { quantity: 12, allocations: [{ boxNo: '16', quantity: 10 }, { boxNo: '17', quantity: 2 }], sourceRows: [2] },
    '8:70': { quantity: 8, allocations: [{ boxNo: '17', quantity: 8 }], sourceRows: [2] },
  }, '직접 분배 결과가 업체·품목별 최종 셀과 박스 표시에 반영된다');
  const customerFixed = applyChinaPackingCustomerMatch([{ sourceRow: 3, product: { prodKey: 70 }, mappingStatus: 'CUSTOMER_UNMATCHED' }], 3, { custKey: 7, custName: '주광농원' });
  assert.strictEqual(customerFixed[0].mappingStatus, 'MATCHED', '업체 미매칭도 대조 화면에서 수정할 수 있다');
  assert.strictEqual(customerFixed[0].cellKey, '7:70');
  const rematched = rematchChinaPackingRow([
    { sourceRow: 3, quantity: 20, customer: { custKey: 7 }, product: { prodKey: 70 }, cellKey: '7:70', mappingStatus: 'MATCHED', distributions: [{ cellKey: '7:70', quantity: 12 }, { cellKey: '8:70', quantity: 8 }] },
    { sourceRow: 4, quantity: 10, cellKey: '9:90', mappingStatus: 'MATCHED' },
  ], 3, { custKey: 8, custName: '일신원예' }, { prodKey: 71, prodName: 'SOLOMIO ROSE (PINK)' });
  assert.strictEqual(rematched[0].cellKey, '8:71', '기존 매칭도 명시한 업체·품목으로 다시 연결한다');
  assert.deepStrictEqual(rematched[0].distributions, [{ cellKey: '8:71', quantity: 20 }], '재매칭 시 과거 분배를 새 대상 전량 1건으로 안전하게 초기화한다');
  assert.strictEqual(rematched[1].cellKey, '9:90', '다른 원본 행은 변경하지 않는다');
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
  const solomio = matchChinaPackingRows([
    { sourceRow: 2, sourceItemName: 'SOLOMIO ROSE PINK', customerCode: 'CL1', quantity: 10 },
  ], {
    customers: [{ custKey: 7, custName: '주광농원', orderCode: 'CL1' }],
    rows: [
      { prodKey: 72, country: '중국', flower: '카네이션', prodName: 'Spray Carnation CHINA / 솔로미오 Solomio Rose (pink)' },
    ],
  });
  assert.strictEqual(solomio[0].mappingStatus, 'MATCHED', '패킹 SOLOMIO ROSE PINK는 전산 괄호 표기와 화종명이 달라도 실제 중국 품목명으로 매칭한다');
  assert.strictEqual(solomio[0].product.prodKey, 72);
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
  assert.strictEqual(pivotCells['7:70'].quantity, 20, '웹 셀 주 표시수량은 업로드 패킹 20을 채운다');
  assert.strictEqual(pivotCells['7:70'].packingQuantity, 20);
  assert.strictEqual(pivotCells['7:70'].orderQuantity, 18, '전산 주문수량은 비교값으로 별도 보존한다');
  const packingWorkbookRows = buildChinaVolumeWorkbookRows({
    year: 2026,
    week: '35-01',
    customers: [{ custKey: 7, custName: '주광농원', orderCode: 'CL1' }],
    rows: [{ prodKey: 70, prodName: 'ROSE Diana', outOrders: { 주광농원: 18 } }],
    cells: pivotCells,
  });
  assert.strictEqual(packingWorkbookRows[3][1], '20 (16,17)', '엑셀에도 패킹수량과 박스번호를 함께 출력한다');
  const restoredCells = restoreChinaPackingCells({
    '7:70': { quantity: 18, packingQuantity: 20, allocations: [{ boxNo: '16', quantity: 10 }, { boxNo: '17', quantity: 10 }] },
  }, matched, {
    customers: [{ custKey: 7, custName: '주광농원', orderCode: 'CL1' }],
    rows: [
      { prodKey: 70, country: '중국', prodName: 'ROSE Diana', outOrders: { 주광농원: 18 } },
      { prodKey: 71, country: '중국', prodName: 'ROSE Idana', outOrders: { 주광농원: 10 } },
    ],
  });
  assert.strictEqual(restoredCells['7:70'].quantity, 20, '기존 저장본도 재업로드 없이 패킹 수량으로 복원한다');
  assert.strictEqual(restoredCells['7:70'].orderQuantity, 18);
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
  assert.strictEqual(totals.invoiceMismatches.length, 1, '업로드 검토에는 실제 주문-인보이스 차이만 표시한다');
  assert.strictEqual(totals.invoiceMismatches[0].invoiceDifference, 2, '양수 차이는 인보이스 초과수량이다');
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

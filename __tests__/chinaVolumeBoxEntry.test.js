const assert = require('node:assert/strict');

(async () => {
  const {
    appendChinaVolumeCellHistory,
    applyChinaVolumeBoxEntries,
    buildChinaVolumeGridTotals,
    buildChinaVolumeWorkbookRows,
    chinaVolumeCellText,
    normalizeChinaVolumeCellHistory,
    parseChinaManualBoxNumbers,
    restoreChinaPackingCells,
  } = await import('../lib/chinaVolumeBoard.js');

  assert.deepEqual(parseChinaManualBoxNumbers('1'), { ok: true, boxNumbers: ['1'], text: '1' });
  assert.deepEqual(parseChinaManualBoxNumbers('11.12.13'), { ok: true, boxNumbers: ['11', '12', '13'], text: '11,12,13' });
  assert.equal(chinaVolumeCellText(24, [], ['11', '12', '13']), '24 (11,12,13)', '직접 입력한 번호는 연속 범위로 압축하지 않는다');
  assert.equal(parseChinaManualBoxNumbers('11.a.13').ok, false, '숫자 외 문자가 섞인 입력은 적용하지 않는다');

  const rows = [
    { prodKey: 71, prodName: 'Hydrangea Blue', outOrders: { '주광농원': 8, CL2: 3 } },
    { prodKey: 72, prodName: 'Rose Diana', outOrders: { '주광농원': 5 } },
  ];
  const customers = [
    { custKey: 11, custName: '주광농원', orderCode: 'CL1' },
    { custKey: 12, custName: 'CL2', orderCode: 'CL2' },
  ];
  const first = applyChinaVolumeBoxEntries({
    rows,
    customers,
    cells: {},
    changedAt: '2026-10-07T01:00:00.000Z',
    entries: [
      { prodKey: 71, custKey: 11, quantity: '10', boxNumbersText: '11.12.13' },
      { prodKey: 72, custKey: 12, quantity: '4', boxNumbersText: '1' },
    ],
  });
  assert.equal(first.ok, true);
  assert.deepEqual(first.cells['11:71'].boxNumbers, ['11', '12', '13']);
  assert.equal(first.cells['11:71'].quantity, 10);
  assert.deepEqual(first.cells['11:71'].allocations, undefined, '박스번호 텍스트를 기존 패킹 박스별 수량배정으로 임의 환산하지 않는다');
  assert.deepEqual(first.cells['11:71'].editHistory[0], {
    fromQuantity: 8,
    toQuantity: 10,
    fromBoxNumbers: [],
    toBoxNumbers: ['11', '12', '13'],
    changedAt: '2026-10-07T01:00:00.000Z',
  });

  const totals = buildChinaVolumeGridTotals({ rows, customers, cells: first.cells });
  assert.deepEqual(totals.rowTotals, { '71': 13, '72': 9 }, '행 합계는 수동 변경량과 원래 셀값을 다시 합산한다');
  assert.deepEqual(totals.customerTotals, { '11': 15, '12': 7 }, '업체 합계도 셀 변경 즉시 다시 계산한다');
  assert.equal(totals.grandTotal, 22);

  const updated = applyChinaVolumeBoxEntries({
    rows,
    customers,
    cells: first.cells,
    changedAt: '2026-10-07T02:00:00.000Z',
    entries: [{ prodKey: 71, custKey: 11, quantity: '12', boxNumbersText: '11,12,13' }],
  });
  assert.equal(updated.cells['11:71'].editHistory.length, 2, '두 번째 변경도 기존 이력 뒤에 누적된다');
  assert.equal(updated.cells['11:71'].editHistory[1].fromQuantity, 10);
  assert.deepEqual(updated.cells['11:71'].editHistory[1].fromBoxNumbers, ['11', '12', '13']);
  assert.equal(appendChinaVolumeCellHistory(updated.cells['11:71'].editHistory, {
    fromQuantity: 12, toQuantity: 12, fromBoxNumbers: ['11', '12', '13'], toBoxNumbers: ['11', '12', '13'],
  }).length, 2, '동일값 재저장은 수정 이력으로 쌓지 않는다');
  assert.equal(normalizeChinaVolumeCellHistory([{ fromQuantity: -1, toQuantity: 2, changedAt: '2026-10-07T00:00:00.000Z' }]).length, 0);

  const duplicate = applyChinaVolumeBoxEntries({ rows, customers, cells: first.cells, entries: [
    { prodKey: 71, custKey: 11, quantity: 9, boxNumbersText: '2' },
    { prodKey: 71, custKey: 11, quantity: 10, boxNumbersText: '3' },
  ] });
  assert.equal(duplicate.ok, false, '한 번의 일괄 적용 안에서 같은 품목·업체 셀은 중복 수정할 수 없다');
  assert.equal(duplicate.cells, first.cells, '검증 실패는 전체 batch를 그대로 둔다');
  const invalidBatch = applyChinaVolumeBoxEntries({ rows, customers, cells: first.cells, entries: [
    { prodKey: 71, custKey: 11, quantity: 11, boxNumbersText: '1.2' },
    { prodKey: 72, custKey: 12, quantity: -1, boxNumbersText: '4' },
  ] });
  assert.equal(invalidBatch.ok, false);
  assert.equal(invalidBatch.cells, first.cells, '잘못된 행 하나가 있어도 일부 행만 적용하지 않는다');

  const restored = restoreChinaPackingCells({
    '11:71': { quantity: 12, quantityEdited: true, boxNumbers: ['11', '12', '13'], editHistory: updated.cells['11:71'].editHistory },
    '12:72': { quantity: 4, quantityEdited: true, boxNumbers: ['1'], editHistory: first.cells['12:72'].editHistory },
  }, [], { rows, customers });
  assert.equal(restored['11:71'].quantity, 12, '저장 후 재조회에도 수정 수량을 보존한다');
  assert.deepEqual(restored['11:71'].boxNumbers, ['11', '12', '13']);
  assert.equal(restored['12:72'].editHistory.length, 1, '패킹 원장에 없는 직접 입력 셀도 복원한다');

  const workbookRows = buildChinaVolumeWorkbookRows({
    year: 2026,
    week: '40-01',
    rows: [rows[0]],
    customers: [customers[0]],
    cells: { '11:71': { quantity: 12, boxNumbers: ['11', '12', '13'] } },
    appliedOnly: true,
  });
  assert.equal(workbookRows[3][1], 12, '엑셀 수량 시트에는 수량만 내보내고 박스번호 메타데이터는 제외한다');

  console.log('china volume box entry contract passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

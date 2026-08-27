const assert = require('assert');

(async () => {
  const {
    buildChinaVolumeWorkbookRows,
    chinaVolumeCellText,
    chinaVolumeProductLabel,
    parseChinaBoxNumbers,
    splitChinaBoxQuantity,
    parseChinaPackingRows,
    matchChinaPackingRows,
    mergeChinaCellAllocations,
    mergeChinaPackingIntoPivotCells,
    validateChinaCellAllocation,
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

  console.log('chinaVolumeBoard tests passed');
})().catch(error => { console.error(error); process.exit(1); });

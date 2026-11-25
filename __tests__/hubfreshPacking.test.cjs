const assert = require('node:assert/strict');
const test = require('node:test');
const XLSX = require('xlsx');

test('HUBFRESH separates carton ownership and round-trips the Nenova packing sheet', async () => {
  const { parseHubfreshInvoice, sumHubfreshRows, hubfreshPackingGrid, hubfreshItemKey } = await import('../lib/hubfreshPacking.js');
  const { parseWarehousePackingWorkbook } = await import('../lib/warehousePackingImport.js');
  const header = ['English name', 'Chinese name', 'Customer Code', 'Ctn No', 'Code', 'Length', 'Specification',
    'Box specifications', 'Order Quantities', 'Total of bunches', 'Stems', 'UNIT PRICE', 'AMOUNT'];
  const grid = [
    ['HUBFRESH', 'INVOICE NO. XJ-2026-NN012'],
    header,
    ['Rose', '', 'YCL1', 1, 'R', '60CM', '10Stem/Bunch', '100*40*20', 1, 5, 50, 3, 15],
    ['Rose', '', 'CL2', '3-4', 'R', '60CM', '10Stem/Bunch', '100*40*20', 2, 10, 100, 3, 30],
    ['', '玫瑰', 'INT', 5, 'R', '60CM', '10Stem/Bunch', '100*40*20', 1, 5, 50, '', 0],
    ['Rose', '', 'CL1 / INT', '6,7', 'R', '60CM', '10Stem/Bunch', '100*40*20', 2, 10, 100, 3, 30],
    ['Rose', '', '', '', 'R', '60CM', '10Stem/Bunch', '100*40*20', 1, 5, 50, 3, 15],
  ];
  const data = parseHubfreshInvoice(grid);
  assert.deepEqual([data.nenova.length, data.other.length, data.review.length], [2, 1, 2]);
  assert.equal(data.other[0].price, 0);
  const [merged] = sumHubfreshRows(data.nenova);
  assert.deepEqual([merged.boxes, merged.amount, [...merged.cartons]], [3, 45, ['1', '3-4']]);
  const names = { [hubfreshItemKey(merged)]: 'ERP Rose 60CM' };
  for (const year of ['2025', '2026']) {
    const workbook = XLSX.utils.book_new();
    const packed = hubfreshPackingGrid(data.invoice, data.nenova, names, '48-01', `${year}-11-24`);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(packed), 'PACKING');
    const result = parseWarehousePackingWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), XLSX);
    assert.equal(result.meta.orderYear, year);
    assert.deepEqual(result.rows.map(row => [row.orderCode, row.prodName, row.boxQty, row.totalPrice]),
      [['YCL1', 'ERP Rose 60CM', 1, 15], ['CL2', 'ERP Rose 60CM', 2, 30]]);
  }
  const withCosts = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(withCosts, XLSX.utils.aoa_to_sheet(
    hubfreshPackingGrid(data.invoice, data.nenova, names, '48-01', '2026-11-24', { awb: '999-12345675', freight: 1830, gw: 512.5, cw: 620 })
  ), 'PACKING');
  const parsedWithCosts = parseWarehousePackingWorkbook(XLSX.write(withCosts, { type: 'array', bookType: 'xlsx' }), XLSX);
  assert.deepEqual([parsedWithCosts.meta.awb, parsedWithCosts.meta.freight, parsedWithCosts.meta.gw, parsedWithCosts.meta.cw],
    ['999-12345675', 1830, 512.5, 620]);
  assert.deepEqual(parsedWithCosts.rows.slice(2).map(row => [row.prodName, row.steamQty, row.totalPrice]),
    [['운송료', 1, 1830], ['Gross weight', 512.5, 0], ['Chargeable weight', 620, 0]]);
  assert.throws(() => hubfreshPackingGrid(data.invoice, data.nenova, {}, '48-01', '2026-11-24'), /ERP/);
});

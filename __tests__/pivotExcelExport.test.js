// node __tests__/pivotExcelExport.test.js

const assert = (label, cond) => {
  if (!cond) { console.error(`  ✗ ${label}`); process.exitCode = 1; }
  else console.log(`  ✓ ${label}`);
};

async function main() {
  const {
    rowHasPivotQty,
    buildPivotExportColumns,
    rowsToCsvAoA,
  } = await import('../lib/pivotExcelExport.js');

  console.log('=== rowHasPivotQty ===');
  assert('주문만', rowHasPivotQty({ totalOrder: 0, orders: { A: 5 }, incoming: {} }));
  assert('전재고만 → 제외', !rowHasPivotQty({ prevStock: 100, orders: {}, incoming: {} }));
  assert('입고만', rowHasPivotQty({ totalIncoming: 10, incoming: { F: 10 } }));

  console.log('\n=== buildPivotExportColumns ===');
  const cols = buildPivotExportColumns({
    showArea: false, showOutDate: false, showInPrice: false, showInTotal: false,
    showArrival: false, showAWB: false, showDescr: false, showAmount: true,
    showQty: true, showCost: false, showDistCost: true,
    showSections: { prev: true, order: true, incoming: false, out: true, none: false, cur: false },
    compact: true,
    showOrderCustCols: false, showOutCustCols: false,
    showIncomingFarmCols: false, showIncomingCompactTotal: false,
    sortedCusts: [], farms: [],
  });
  assert('전재고 컬럼', cols.some(c => c.header === '01.전재고'));
  assert('분배금액 컬럼', cols.some(c => c.header.includes('분배금액')));

  const rows = [
    { country: 'K', flower: 'F', prodName: 'P', prevStock: 10, orders: { A: 2 }, distCostOrders: { A: 100 }, totalOrder: 2, confirmedOut: 0 },
  ];
  const aoa = rowsToCsvAoA(cols, rows.filter(rowHasPivotQty));
  assert('합계행 포함', aoa.length === 3);
  assert('합계행 전재고', aoa[2][cols.findIndex(c => c.header === '01.전재고')] === 10);

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch(e => { console.error(e); process.exitCode = 1; });

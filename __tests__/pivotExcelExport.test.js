// node __tests__/pivotExcelExport.test.js

const assert = (label, cond) => {
  if (!cond) { console.error(`  ✗ ${label}`); process.exitCode = 1; }
  else console.log(`  ✓ ${label}`);
};

async function main() {
  const {
    rowHasPivotQty,
    rowHasPivotQtyInWeeks,
    getPivotWeekRow,
    buildPivotExportColumns,
    buildPivotExportGrid,
    rowsToCsvAoA,
    formatExportCell,
  } = await import('../lib/pivotExcelExport.js');

  console.log('=== rowHasPivotQty ===');
  assert('주문만', rowHasPivotQty({ totalOrder: 0, orders: { A: 5 }, incoming: {} }));
  assert('전재고만 → 제외', !rowHasPivotQty({ prevStock: 100, orders: {}, incoming: {} }));
  assert('입고만', rowHasPivotQty({ totalIncoming: 10, incoming: { F: 10 } }));

  console.log('\n=== rowHasPivotQtyInWeeks ===');
  const base = { prodKey: 1, country: 'K', flower: 'F', prodName: 'P', orders: {}, totalOrder: 0 };
  const byWeek = {
    '04-01': { rows: [{ prodKey: 1, orders: {}, totalOrder: 0 }] },
    '04-02': { rows: [{ prodKey: 1, orders: { A: 3 }, totalOrder: 3 }] },
  };
  assert('04-01만 0 → 04-02에 수량 있으면 포함', rowHasPivotQtyInWeeks(base, ['04-01', '04-02'], byWeek));
  assert('모든 차수 0 → 제외', !rowHasPivotQtyInWeeks(base, ['04-01'], byWeek));

  console.log('\n=== formatExportCell ===');
  assert('0 → 빈칸', formatExportCell(0) === '');
  assert('5 유지', formatExportCell(5) === 5);

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

  console.log('\n=== buildPivotExportGrid multi-week ===');
  const grid = buildPivotExportGrid({
    showArea: false, showOutDate: false, showInPrice: false, showInTotal: false,
    showArrival: false, showAWB: false, showDescr: false, showAmount: false,
    showQty: true, showCost: false, showDistCost: false,
    showSections: { prev: false, order: true, incoming: false, out: false, none: false, cur: false },
    compact: true,
    showOrderCustCols: false, showOutCustCols: false,
    showIncomingFarmCols: false, showIncomingCompactTotal: false,
    sortedCusts: [], farms: [],
    weeks: ['04-01', '04-02'],
    byWeek,
    weekLabel: w => `2026-${w}`,
  });
  assert('차수별 02.주문 컬럼', grid.some(c => c.header === '2026-04-01_02.주문_수량'));
  assert('차수2 컬럼', grid.some(c => c.header === '2026-04-02_02.주문_수량'));

  const rows = [
    { prodKey: 1, country: 'K', flower: 'F', prodName: 'P', prevStock: 10, orders: { A: 2 }, distCostOrders: { A: 100 }, totalOrder: 2, confirmedOut: 0 },
  ];
  const aoa = rowsToCsvAoA(cols, rows.filter(rowHasPivotQty), { blankZero: true });
  assert('합계행 포함', aoa.length === 3);
  assert('0 셀 빈칸', aoa[1][cols.findIndex(c => c.header === '04.출고_수량')] === '');

  const wr = getPivotWeekRow({ prodKey: 1, prodName: 'X' }, '04-02', byWeek);
  assert('차수행 조회', wr.totalOrder === 3);

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch(e => { console.error(e); process.exitCode = 1; });

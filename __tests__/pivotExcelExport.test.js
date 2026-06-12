// node __tests__/pivotExcelExport.test.js

const assert = (label, cond) => {
  if (!cond) { console.error(`  ✗ ${label}`); process.exitCode = 1; }
  else console.log(`  ✓ ${label}`);
};

async function main() {
  const {
    rowHasPivotQty,
    rowMatchesExportFilter,
    getPivotWeekRow,
    buildPivotExportColumns,
    buildPivotExportGrid,
    rowsToCsvAoA,
    formatExportCell,
  } = await import('../lib/pivotExcelExport.js');

  console.log('=== rowHasPivotQty ===');
  assert('주문만', rowHasPivotQty({ totalOrder: 0, orders: { A: 5 }, incoming: {} }));
  assert('전재고만 → 제외', !rowHasPivotQty({ prevStock: 100, orders: {}, incoming: {} }));

  console.log('\n=== rowMatchesExportFilter (표시 구분만) ===');
  const outOnly = {
    showSections: { prev: false, order: false, incoming: false, out: true, none: false, cur: false },
    showOrderCustCols: false,
    showOutCustCols: true,
    sortedCusts: [{ custName: '신라호텔' }],
    farms: [],
  };
  assert('출고 0 주문만 → 제외', !rowMatchesExportFilter(
    { orders: { 신라호텔: 7 }, outOrders: {}, confirmedOut: 0 },
    outOnly,
  ));
  assert('출고 있으면 포함', rowMatchesExportFilter(
    { orders: {}, outOrders: { 신라호텔: 2 }, confirmedOut: 2 },
    outOnly,
  ));

  console.log('\n=== buildPivotExportColumns — 합산용 분리 열 ===');
  const cols = buildPivotExportColumns({
    showArea: false, showOutDate: false, showInPrice: false, showInTotal: false,
    showArrival: false, showAWB: false, showDescr: false, showAmount: false,
    showQty: true, showCost: false, showDistCost: true,
    showSections: { prev: false, order: true, incoming: false, out: false, none: false, cur: false },
    compact: false,
    showOrderCustCols: true, showOutCustCols: false,
    showIncomingFarmCols: false, showIncomingCompactTotal: false,
    sortedCusts: [{ custName: '신라호텔' }], farms: [],
  });
  assert('거래처 수량 열', cols.some(c => c.header === '신라호텔_수량'));
  assert('거래처 분배단가 열', cols.some(c => c.header === '신라호텔_분배단가'));
  assert('거래처 분배금액 열', cols.some(c => c.header === '신라호텔_분배금액'));
  assert('주문Total 수량 열', cols.some(c => c.header === '02.주문Total_수량'));

  const byWeek = {
    '04-01': { rows: [{ prodKey: 1, orders: {}, totalOrder: 0 }] },
    '04-02': { rows: [{ prodKey: 1, orders: { A: 3 }, totalOrder: 3 }] },
  };
  const grid = buildPivotExportGrid({
    showArea: false, showOutDate: false, showInPrice: false, showInTotal: false,
    showArrival: false, showAWB: false, showDescr: false, showAmount: false,
    showQty: true, showCost: false, showDistCost: true,
    showSections: { prev: false, order: true, incoming: false, out: false, none: false, cur: false },
    compact: true,
    showOrderCustCols: false, showOutCustCols: false,
    showIncomingFarmCols: false, showIncomingCompactTotal: false,
    sortedCusts: [], farms: [],
    weeks: ['04-01', '04-02'],
    byWeek,
    weekLabel: w => `2026-${w}`,
  });
  assert('차수별 02.주문_수량 열', grid.some(c => c.header === '2026-04-01_02.주문_수량'));
  assert('차수별 02.주문_분배금액 열', grid.some(c => c.header === '2026-04-01_02.주문_분배금액'));

  const rows = [
    { prodKey: 1, country: 'K', flower: 'F', prodName: 'P', orders: { 신라호텔: 2 }, distCostOrders: { 신라호텔: 100 }, totalOrder: 2 },
  ];
  const aoa = rowsToCsvAoA(cols, rows, { blankZero: true });
  assert('합계행 포함', aoa.length === 3);
  const qtyIdx = cols.findIndex(c => c.header === '신라호텔_수량');
  assert('수량 셀 숫자', aoa[1][qtyIdx] === 2);
  assert('0 셀 빈칸', formatExportCell(0) === '');

  const wr = getPivotWeekRow({ prodKey: 1, prodName: 'X' }, '04-02', byWeek);
  assert('차수행 조회', wr.totalOrder === 3);

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch(e => { console.error(e); process.exitCode = 1; });

// 실행: node __tests__/orderImportPricePivot.test.js
async function main() {
  const L = await import('../lib/orderImportPricePivot.js');
  let failed = 0;
  const ok = (c, m) => { if (!c) { failed++; console.error('FAIL:', m); } };

  const wk = L.nearbyWeeks('2026-44-01', 5);
  ok(wk.length === 11 && wk[0] === '2026-39-01' && wk[10] === '2026-49-01', 'nearbyWeeks 11개');
  ok(L.nearbyWeeks('2026-02-02', 5)[0] === '2026-01-02', 'nearbyWeeks 시작 클램프');
  ok(L.nearbyWeeks('bad').length === 0, 'nearbyWeeks 잘못된 입력');
  ok(JSON.stringify(L.splitFullWeek('2026-44-01')) === '{"orderYear":"2026","orderWeek":"44-01"}', 'splitFullWeek');
  ok(L.splitFullWeek('44-01') === null, 'splitFullWeek 잘못된 입력');

  const customers = [{ custKey: 1, custName: 'A' }, { custKey: 2, custName: 'B' }, { custKey: 3, custName: 'C' }];
  const products = [{ prodKey: 10, displayName: 'P10' }, { prodKey: 20, displayName: 'P20' }];
  const cells = [
    { custKey: 1, prodKey: 10, cost: 100, isFix: true, details: [{ sdetailKey: 1, shipmentKey: 11, cost: 100 }, { sdetailKey: 2, shipmentKey: 11, cost: 100 }] },
    { custKey: 2, prodKey: 20, cost: 50, isFix: false, details: [{ sdetailKey: 3, shipmentKey: 12, cost: 50 }] },
    { custKey: 3, prodKey: 10, cost: 70, isFix: false, details: [{ sdetailKey: 4, shipmentKey: 13, cost: 70 }] },
  ];
  const map = L.indexCells(cells);
  const sel = L.rectSelection(customers, products, map, { row: 2, col: 1 }, { row: 0, col: 0 });
  ok(sel.length === 3, '역방향 드래그 3셀');
  ok(L.rectSelection(customers, products, map, { row: 0, col: 1 }, { row: 0, col: 1 }).length === 0, '빈 셀 제외');
  ok(L.rectSelection(customers, products, map, null, { row: 0, col: 0 }).length === 0, '시작점 없음');

  ok(L.parsePrice('1,200') === 1200 && L.parsePrice('') === null && L.parsePrice('-1') === null && L.parsePrice('abc') === null, 'parsePrice');

  const ch = L.changedCells(map, { '1:10': 120, '2:20': 50, '3:10': '', '9:9': 5 });
  ok(ch.length === 1 && ch[0].key === '1:10', '같은 값/빈 값/없는 셀 제외');

  const ch2 = L.changedCells(map, { '1:10': 120, '2:20': 60 });
  const reqs = L.buildCostRequests(ch2, '2026');
  ok(reqs.length === 2, '업체별 2건');
  const r1 = reqs.find(r => r.custKey === 1);
  ok(r1.body.items.length === 2 && r1.body.mode === 'once' && r1.body.orderYear === '2026', '셀 대표 detail 전부');
  ok(r1.body.items.every(i => i.cost === 120 && i.expectedOldCost === 100), 'expectedOldCost=조회값');
  ok(r1.body.source === 'import-direct-pivot', 'source 식별');

  const sm = L.summarizeChanges(ch2, customers, products);
  ok(sm.custCount === 2 && sm.cellCount === 2 && sm.fixedCells === 1 && sm.lines[0].includes('100 → 120'), '요약');

  if (failed) { console.error(`${failed} failed`); process.exit(1); }
  console.log('orderImportPricePivot: all passed');
}
main();

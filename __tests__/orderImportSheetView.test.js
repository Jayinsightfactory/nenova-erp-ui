// 실행: node __tests__/orderImportSheetView.test.js
async function main() {
  const L = await import('../lib/orderImportSheetView.js');
  let failed = 0;
  const ok = (c, m) => { if (!c) { failed++; console.error('FAIL:', m); } };

  const rows = [
    { rowNo: 1, cells: ['제목', '', ''] },
    { rowNo: 2, cells: ['카네이션', '색상', '수량'] },
    { rowNo: 3, cells: ['', ' ', null] },
    { rowNo: 4, cells: [] },
    { rowNo: 5, cells: ['', '', ''] },
    { rowNo: 6, cells: ['', '돈셀', 3] },
    { rowNo: 7, cells: ['', '', ''] },
    { rowNo: 8, cells: ['', '', 0] },
  ];
  const seg = L.collapseEmptySheetRows(rows);
  ok(seg.length === 6, `세그먼트 6개 (실제 ${seg.length})`);
  ok(seg[2].type === 'gap' && seg[2].rowNos.join() === '3,4,5', '연속 빈 행 3~5 접힘');
  ok(seg[3].type === 'row' && seg[3].row.rowNo === 6, '데이터 행 유지');
  ok(seg[4].type === 'gap' && seg[4].rowNos.join() === '7', '단일 빈 행도 gap');
  ok(L.collapseEmptySheetRows(rows).filter(s => s.type === 'row').length === 4, '숫자 0 행은 빈 행 아님');
  const kept = L.collapseEmptySheetRows(rows, [4]);
  ok(kept.some(s => s.type === 'row' && s.row.rowNo === 4), 'keepRowNos 유지');
  ok(L.collapseEmptySheetRows(null).length === 0, 'null 입력');

  const sw = [
    { orderWeek: '44-01', details: [{ prodKey: 10, cost: 11500 }, { prodKey: 20, cost: 900 }] },
    { orderWeek: '44-02', details: [{ prodKey: 10, cost: 12000 }] },
  ];
  const a = L.lookupCurrentCost(sw, ['44-01'], 10);
  ok(a.status === 'ok' && a.cost === 11500 && a.orderWeek === '44-01', '단건 조회');
  const b = L.lookupCurrentCost(sw, ['44-01', '44-02'], 10);
  ok(b.status === 'multi' && b.cost === 11500 && b.count === 2, '여러 건은 첫 값 + multi');
  ok(L.lookupCurrentCost(sw, ['44-02'], 20).status === 'none', '선택 차수에 분배 없음');
  ok(L.lookupCurrentCost([], ['44-01'], 10).status === 'none', 'priceTargets 비어 있음');
  ok(L.lookupCurrentCost(sw, ['44-01'], 0).status === 'none', 'prodKey 없음');

  ok(L.isPriceChanged(a, 11500) === false, '같은 단가');
  ok(L.isPriceChanged(a, 12000) === true, '다른 단가');
  ok(L.isPriceChanged(a, 0) === false, '수정 단가 비어 있음');
  ok(L.isPriceChanged({ status: 'none' }, 500) === false, '분배 없음은 강조 안 함');

  if (failed) { console.error(`${failed} failed`); process.exit(1); }
  console.log('orderImportSheetView: all passed');
}
main();

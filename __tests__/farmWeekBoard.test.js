const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const {
    buildFarmWeekBoard,
    classifyFarmComparisonRow,
    filterFarmBoardRows,
    formatFarmBoardCell,
    moveFarmWeek,
    pickActiveVarietySelection,
    summarizeComparisonBoard,
    summarizeFarmRows,
    varietyKey,
  } = await import('../lib/farmWeekBoard.js');

  const base = {
    orderYear: '2026',
    orderWeek: '39-02',
    prodKey: 1,
    prodName: 'Rose',
    country: '콜롬비아',
    flower: '장미',
    unit: '박스',
    quantity: 3,
    kind: 'incoming',
    farm: 'A',
  };
  const source = [
    base,
    { ...base, quantity: 2 },
    { ...base, kind: 'order', quantity: 9 },
    { ...base, kind: 'distribution', quantity: 7 },
    { ...base, kind: 'adjustment', quantity: -1 },
    { ...base, orderYear: '2025', quantity: 999 }, // 교차연도 제외 검증
    { ...base, orderWeek: '39-01', quantity: 888 }, // 타 세부차수 제외 검증
    { ...base, prodKey: 2, prodName: 'DistOnly', unit: '단', kind: 'distribution', quantity: 4 },
    { ...base, prodKey: 3, prodName: 'UnorderedIncoming', farm: null, quantity: 2 },
    { ...base, prodKey: 4, prodName: 'OrderOnlyUnreceived', kind: 'order', farm: null, quantity: 12 },
    { ...base, prodKey: 5, prodName: 'ExactMatch', kind: 'incoming', farm: 'B', quantity: 6 },
    { ...base, prodKey: 5, prodName: 'ExactMatch', kind: 'order', farm: null, quantity: 6 },
  ];

  const result = buildFarmWeekBoard(source, { orderYear: '2026', orderWeek: '39-02' });
  assert.equal(result.length, 5);
  const rose = result.find(r => r.prodKey === 1);
  assert.equal(rose.received, 5);
  assert.equal(rose.order, 9);
  assert.equal(rose.distribution, 7);
  assert.equal(rose.adjustment, -1);
  assert.equal(result.find(r => r.prodKey === 3).incoming['농장 미지정'], 2);
  assert.equal(summarizeFarmRows(result).length, 2);

  // 주문·입고 비교 필터: 주문+입고, 주문만(미입고), 입고만(미주문 입고) 모두 포함되고 분배만 있는 무관 품목(prodKey=2)은 제외
  const selectedKey = varietyKey(base);
  const orderTabRows = filterFarmBoardRows(result, { selected: selectedKey, tab: 'order' });
  assert.deepEqual(
    orderTabRows.map(r => r.prodKey).sort((a, b) => a - b),
    [1, 3, 4, 5],
  );

  // 상태 판정 검증
  assert.deepEqual(classifyFarmComparisonRow(result.find(r => r.prodKey === 1), 'order'), {
    target: 9,
    received: 5,
    diff: -4,
    status: 'shortage',
    label: '입고부족',
  });
  assert.deepEqual(classifyFarmComparisonRow(result.find(r => r.prodKey === 4), 'order'), {
    target: 12,
    received: 0,
    diff: -12,
    status: 'unreceived',
    label: '미입고',
  });
  assert.deepEqual(classifyFarmComparisonRow(result.find(r => r.prodKey === 3), 'order'), {
    target: 0,
    received: 2,
    diff: 2,
    status: 'unordered',
    label: '미주문 입고',
  });
  assert.deepEqual(classifyFarmComparisonRow(result.find(r => r.prodKey === 5), 'order'), {
    target: 6,
    received: 6,
    diff: 0,
    status: 'matched',
    label: '일치',
  });

  // 비교 탭에서 0 수량이 공란('')으로 숨겨지지 않고 '0'으로 명시 표시되는지 검증
  assert.equal(formatFarmBoardCell(0, 'received', 'order'), '0');
  assert.equal(formatFarmBoardCell(0, 'order', 'order'), '0');
  assert.equal(formatFarmBoardCell(0, 'difference', 'order'), '0');
  assert.equal(formatFarmBoardCell(2, 'difference', 'order'), '+2');
  assert.equal(formatFarmBoardCell(-4, 'difference', 'order'), '-4');
  // 농장별 입고 탭 및 개별 농장 셀은 0일 때 공란 유지
  assert.equal(formatFarmBoardCell(0, 'received', 'farm'), '');
  assert.equal(formatFarmBoardCell(0, 'farm:A', 'order'), '');

  // 비교 요약 집계 검증
  const summary = summarizeComparisonBoard(orderTabRows, 'order');
  assert.equal(summary.counts.all, 4);
  assert.equal(summary.counts.shortage, 1);
  assert.equal(summary.counts.unreceived, 1);
  assert.equal(summary.counts.unordered, 1);
  assert.equal(summary.counts.matched, 1);
  assert.equal(summary.counts.mismatch, 3);
  assert.equal(summary.byUnit[0].target, 27); // 9 + 0 + 12 + 6
  assert.equal(summary.byUnit[0].received, 13); // 5 + 2 + 0 + 6
  assert.equal(summary.byUnit[0].difference, -14);

  // 상태 필터 동작 검증
  assert.equal(filterFarmBoardRows(result, { selected: selectedKey, tab: 'order', statusFilter: 'unreceived' }).length, 1);
  assert.equal(filterFarmBoardRows(result, { selected: selectedKey, tab: 'order', statusFilter: 'unordered' }).length, 1);

  // 유효 품종 자동 선택 검증
  const emptyVariety = JSON.stringify(['태국', '모카라']);
  assert.equal(pickActiveVarietySelection(emptyVariety, result, [{ country: '콜롬비아', flower: '장미' }], 'order'), selectedKey);
  assert.equal(pickActiveVarietySelection(selectedKey, result, [{ country: '콜롬비아', flower: '장미' }], 'order'), selectedKey);

  assert.equal(moveFarmWeek('2026-52-04', 1), '2027-01-01');
  assert.equal(moveFarmWeek('2026-01-01', -1), '2025-52-04');
  assert.equal(moveFarmWeek('2026-39-01', 1), '2026-39-02');
  assert.equal(moveFarmWeek('invalid', 1), null);
  assert.notEqual(varietyKey(base), varietyKey({ ...base, country: '중국' }));

  const page = fs.readFileSync('pages/stats/farm-week-board.js', 'utf8');
  assert(page.includes('groups.get(country).push(row)'));
  assert(page.includes('aria-label="국가 선택"'));
  assert(page.includes('activeVarieties.map(row'));
  assert(page.includes('aria-pressed={activeCountry === country}') || page.includes('aria-pressed={activeCountry===country}'));
  assert(page.includes("farms.map(f => ['farm:' + f, f, 75])") || page.includes("farms.map(f=>['farm:'+f,f,75])"));
  assert(page.includes('담당자별 주문발주 내역서'));
  assert(page.includes('주문수량(주문등록)'));
  assert(page.includes('입고수량(실제입고)'));

  const css = fs.readFileSync('components/FarmWeekBoard.module.css', 'utf8');
  assert(css.includes('.scroller td:nth-child(n+3){text-align:center;'));
  assert(/\.scroller thead th\{[^}]*white-space:normal;[^}]*overflow-wrap:anywhere/.test(css));

  assert.deepEqual(buildFarmWeekBoard([], { orderYear: '2026', orderWeek: '39-02' }), []);

  const sql = fs.readFileSync('lib/farmWeekBoardSql.js', 'utf8');
  for (const alias of ['wm', 'om', 'sm', 'sh']) {
    assert(sql.includes(`${alias}.OrderYear=@year`));
    assert(sql.includes(`${alias}.OrderWeek=@week`));
  }
  assert(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(sql));
  assert(!sql.includes('sd.isDeleted'));
  assert(!sql.includes('sd.isFix'));

  const api = fs.readFileSync('pages/api/stats/farm-week-board.js', 'utf8');
  assert(api.includes('withAuth'));
  assert(api.includes("req.method !== 'GET'"));

  console.log('farmWeekBoard: cross-year, order-incoming comparison, unreceived/unordered, zero display, GET/auth passed');
})().catch(e => {
  console.error(e);
  process.exitCode = 1;
});

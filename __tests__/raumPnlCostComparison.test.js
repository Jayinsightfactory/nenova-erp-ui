const assert = require('node:assert/strict');

async function main() {
  const { buildRaumPnlCostComparison } = await import('../lib/raumPnlCostComparison.js');
  const { RAUM_PNL_COST_COMPARISON_SQL } = await import('../lib/raumPnlCostComparisonServer.js');

  const items = [
    { name: '장미  A', prodKey: 10, unit: '단', isCustom: false },
    { name: '다른 이름', prodKey: 10, unit: '단', isCustom: false },
    { name: '같은 이름', prodKey: 11, unit: '단', isCustom: false },
    { name: '같은 이름', prodKey: 12, unit: '단', isCustom: false },
    { name: '미매칭 품목', prodKey: null, unit: '단', isCustom: false },
    { name: '  공백   품목 ', prodKey: null, unit: '단', isCustom: false },
    { name: '수기 품목', prodKey: null, unit: '단', isCustom: true },
    { name: '단위 품목', prodKey: 13, unit: '박스', isCustom: false },
    { name: '', prodKey: null, unit: '단', isCustom: false },
    { name: 'Case Name', prodKey: null, unit: '단', isCustom: false },
  ];
  const rows = [
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '서로 다른 이름', prodKey: 10, unit: '단', costPrice: '200' },
    { orderYear: 2026, major: '2', partnerCode: 'RAUM', name: '장미 A', prodKey: 10, unit: '단', costPrice: 100 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '장미 A', prodKey: 10, unit: '단', costPrice: 200 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '장미 A', prodKey: 10, unit: '단', costPrice: 200 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '장미 A', prodKey: 10, unit: '단', costPrice: 0 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '같은 이름', prodKey: 11, unit: '단', costPrice: 300 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '같은 이름', prodKey: 12, unit: '단', costPrice: 400 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '미매칭  품목', prodKey: null, unit: '단', costPrice: 500 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '수기 품목', prodKey: null, unit: '단', isCustom: true, costPrice: 600 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '단위 품목', prodKey: 13, unit: '단', costPrice: 700 },
    { orderYear: 2025, major: '99', partnerCode: 'raum', name: '장미 A', prodKey: 10, unit: '단', costPrice: 999 },
    { orderYear: 2026, major: '99', partnerCode: 'choimun', name: '장미 A', prodKey: 10, unit: '단', costPrice: 998 },
    { orderYear: 2026, major: '3', partnerCode: 'raum', name: '장미 A', prodKey: 10, unit: '단', costPrice: null },
    { orderYear: 2026, major: '3', partnerCode: 'raum', name: '장미 A', prodKey: 10, unit: '단', costPrice: '' },
    { orderYear: 2026, major: '3', partnerCode: 'raum', name: '장미 A', prodKey: 10, unit: '단', costPrice: '   ' },
    { orderYear: 2026, major: '0', partnerCode: 'raum', name: '장미 A', prodKey: 10, unit: '단', costPrice: 777 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '', prodKey: null, unit: '단', costPrice: 888 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: '장미 a', prodKey: null, unit: '단', costPrice: 889 },
    { orderYear: 2026, major: '10', partnerCode: 'raum', name: 'case name', prodKey: null, unit: '단', costPrice: 890 },
  ];
  const before = JSON.parse(JSON.stringify({ items, rows }));
  const result = buildRaumPnlCostComparison(items, rows, { orderYear: 2026, partnerCode: 'RAUM' });

  assert.deepEqual(result.weeks, [
    { key: '10', label: '10차' },
    { key: '3', label: '3차' },
    { key: '2', label: '2차' },
  ], 'weeks should be scoped and numerically sorted');
  assert.deepEqual(result.rows[0], [[0, 200], [], [100]], 'same ProdKey matches despite a different name and retains distinct numeric costs');
  assert.deepEqual(result.rows[1], [[0, 200], [], [100]], 'same ProdKey remains the identity');
  assert.deepEqual(result.rows[2], [[300], [], []], 'same ProdKey matches its own historical row');
  assert.deepEqual(result.rows[3], [[400], [], []], 'same ProdKey matches its own historical row');
  assert.deepEqual(result.rows[4], [[500], [], []], 'unmatched names match only after whitespace normalization');
  assert.deepEqual(result.rows[5], [[], [], []], 'non-identical normalized names must remain unmatched');
  assert.deepEqual(result.rows[6], [[600], [], []], 'custom rows are a separate identity');
  assert.deepEqual(result.rows[7], [[], [], []], 'unit is part of the identity');
  assert.deepEqual(result.rows[8], [[], [], []], 'empty names must not match blank historical names');
  assert.deepEqual(result.rows[9], [[], [], []], 'name matching is whitespace-normalized but case-sensitive');
  assert.deepEqual({ items, rows }, before, 'inputs must not be mutated');

  assert.deepEqual(
    buildRaumPnlCostComparison(items, rows),
    { weeks: [], rows: items.map(() => []) },
    'missing scope must fail closed rather than returning another partner or year',
  );

  const sql = RAUM_PNL_COST_COMPARISON_SQL;
  assert.match(sql, /^\s*SELECT\b/i, 'comparison query must be SELECT-only');
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|EXEC)\b/i, 'comparison query must not write');
  assert.match(sql, /m\.OrderYear\s*=\s*@yr/i, 'query must constrain year');
  assert.match(sql, /m\.PartnerCode\s*=\s*@pc/i, 'query must constrain partner');
  assert.match(sql, /ISNULL\(m\.isDeleted\s*,\s*0\)\s*=\s*0/i, 'query must exclude deleted masters');

  const fs = require('node:fs');
  const path = require('node:path');
  const preview = fs.readFileSync(path.join(__dirname, '../components/raum/RaumCostHistoryPreview.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../pages/raum/pnl.js'), 'utf8');
  assert.match(preview, /ref: anchorRef/, 'hover trigger must bind its real input ref');
  assert.match(preview, /onMouseEnter: show/);
  assert.match(preview, /onFocus: show/);
  assert.match(preview, /role="tooltip"/);
  assert.match(preview, /Escape/);
  assert.match(preview, /createPortal/);
  assert.doesNotMatch(preview, /\bfetch\s*\(/, 'hover reuses already scoped comparison data without additional requests');
  assert.match(page, /valuesByWeek=\{costComparisonByIndex\[i\]\}/, 'hover and right-side table share the same item matrix');

  console.log('Raum P&L cost comparison tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sourceRow = (major, pnlKey, itemKey, costPrice, overrides = {}) => ({
  orderYear: '2026', partnerCode: 'shilla', major, pnlKey, itemKey,
  name: '호접 · 화이트', prodKey: 3074, unit: '8스팀', qty: 2,
  costPrice, salePrice: 200, saleAmount: 400, isCustom: false,
  ...overrides,
});

async function main() {
  const { defaultPnlTitle } = await import('../lib/raumPnlPartner.js');
  const { raumPnlCollisionLocationRows } = await import('../lib/raumPnlCollisionLocation.js');
  const { buildShillaDetailCostUpdates, withShillaDetailCostBaseline, applyShillaDetailCostDraft } = await import('../lib/shillaPnlDetailCost.js');
  const { buildRaumPnlCostComparison, buildRaumPnlCombinedPurchaseCostMatrix } = await import('../lib/raumPnlCostComparison.js');
  const { buildRaumPnlWorkbook } = await import('../lib/raumPnlExcel.js');
  const ExcelJS = (await import('exceljs')).default;

  assert.equal(defaultPnlTitle('shilla', '39-2'), '신라호텔 39-2차');
  assert.equal(raumPnlCollisionLocationRows([{ location: { major: '39-2', orderYear: '2026' } }])[0].major, '39-2차');
  assert.equal(raumPnlCollisionLocationRows([{ location: { major: '39-02' } }])[0].major, '차수 미상');

  const baseline = withShillaDetailCostBaseline([sourceRow('39-2', 61, 101, 0)]);
  const edit = applyShillaDetailCostDraft(baseline, 0, '1250');
  assert.deepEqual(buildShillaDetailCostUpdates(edit, { pnlKey: 61, major: '39-2' })[0], {
    pnlKey: 61, major: '39-2', identity: 'prod:3074|unit:8스팀|ordinary',
    expected: [{ itemKey: 101, costPrice: 0 }], costPrice: 1250,
  });
  assert.throws(() => buildShillaDetailCostUpdates(edit, { pnlKey: 61, major: '39-02' }), /저장된 신라/);

  const rows = [
    sourceRow('39', 60, 100, 100),
    sourceRow('39-2', 61, 101, 200),
    sourceRow('39-1', 62, 102, null),
    sourceRow('40', 63, 103, 400),
    sourceRow('39-2', 64, 104, 999, { orderYear: '2025' }),
  ];
  const comparison = buildRaumPnlCostComparison([rows[0]], rows, { orderYear: '2026', partnerCode: 'shilla' });
  assert.deepEqual(comparison.weeks.map(week => week.label), ['40차', '39-2차', '39-1차', '39차']);
  assert.deepEqual(comparison.rows[0], [[400], [200], [], [100]]);

  const shared = [sourceRow('39', 70, 110, 50, { partnerCode: 'raum' })];
  const matrix = buildRaumPnlCombinedPurchaseCostMatrix(shared, rows.filter(row => row.pnlKey !== 62 && row.pnlKey !== 63), { orderYear: '2026' });
  assert.deepEqual(matrix.weeks.map(week => week.label), ['39-2차', '39차']);
  assert.deepEqual(matrix.conflicts, [], '39 and 39-2 are separate settlements, not a collision');
  const item = matrix.items.find(value => value.prodKey === 3074);
  assert.equal(item.cells[0].shared, null);
  assert.equal(item.cells[0].shilla.values[0], 200);
  assert.equal(item.cells[0].shilla.major, '39-2');
  assert.equal(item.cells[1].shared.values[0], 50);
  assert.equal(item.cells[1].shilla.values[0], 100);
  const duplicate = buildRaumPnlCombinedPurchaseCostMatrix(shared, [...rows.slice(0, 2), sourceRow('39-2', 65, 105, 500)], { orderYear: '2026' });
  assert.match(duplicate.conflicts[0], /39-2차/);

  const workbook = await buildRaumPnlWorkbook([
    { master: { PartnerCode: 'shilla', OrderYear: '2026', MajorWeek: '39', QuoteDate: '2026-09-29' }, items: [{ name: '호접', unit: '8스팀', qty: 1, price: 200, costPrice: 100 }] },
    { master: { PartnerCode: 'shilla', OrderYear: '2026', MajorWeek: '39-2', QuoteDate: '2026-10-02' }, items: [{ name: '호접', unit: '8스팀', qty: 2, price: 200, costPrice: 200 }] },
  ]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(workbook);
  assert.ok(wb.getWorksheet('39차'));
  assert.ok(wb.getWorksheet('39-2차'));
  assert.match(wb.getWorksheet('39-2차').getCell('A1').value, /39-2차 \(10\/2\)/);
  const summary = wb.getWorksheet('결산');
  assert.equal(summary.getCell('A3').value, '39차');
  assert.equal(summary.getCell('A4').value, '39-2차');
  assert.match(summary.getCell('C4').value.formula, /'39-2차'!/);
  assert.equal(summary.getCell('C4').value.result, 400);

  const pnlSource = fs.readFileSync(path.join(__dirname, '../pages/raum/pnl.js'), 'utf8');
  assert.match(pnlSource, /month\.weeks\.map\(week => formatPnlPeriod\(week\.slice\(5\)\)/);
  assert.match(pnlSource, /pnlPeriodBaseMajor\(detail\.meta\.major\)/);
  assert.doesNotMatch(pnlSource, /Number\(batch\.major\)|Number\(m\.MajorWeek\)/);
  console.log('Shilla period consumers passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

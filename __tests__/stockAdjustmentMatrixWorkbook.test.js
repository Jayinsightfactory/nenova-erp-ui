import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { buildStockAdjustmentMatrix } from '../lib/stockAdjustmentMatrix.js';
import { buildStockAdjustmentMatrixWorkbook } from '../lib/stockAdjustmentMatrixWorkbook.js';

const base = {
  historyKey: '001', orderYear: '2026', orderWeek: '41-01', prodKey: '0007',
  productName: '=2+2', country: '@COUNTRY', flower: '+Rose', unit: '단',
  beforeValue: 0, afterValue: 0.123456789, reason: '=HYPERLINK("bad")', changeType: '재고조정', changedBy: '+worker',
};

async function reopen(matrix, ignoredFlowRows) {
  const generated = await buildStockAdjustmentMatrixWorkbook(matrix, ignoredFlowRows);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await generated.xlsx.writeBuffer());
  return book;
}

test('single adjustment sheet preserves precise values, blank/zero/invalid, literal text and frozen headers', async () => {
  const matrix = buildStockAdjustmentMatrix([
    base, { ...base, historyKey: '002', orderWeek: '41-2', afterValue: 0 },
    { ...base, historyKey: '003', orderWeek: '41-3', beforeValue: null, afterValue: 'bad' },
  ], { orderYear: '2026', major: '41', search: 'rose' }, ['41-4']);
  const book = await reopen(matrix, [{ major: '42', productName: '제외할 흐름차이', adjustment: 99 }]);
  assert.deepEqual(book.worksheets.map((s) => s.name), ['세부차수별 실제 조정']);
  const sheet = book.worksheets[0];
  assert.deepEqual(sheet.getRow(6).values.slice(1), ['품목번호', '품명', '단위', '41-1', '41-2', '41-3', '41-4', '순조정']);
  assert.equal(sheet.getCell('D7').value, 0.123456789);
  assert.equal(sheet.getCell('E7').value, 0);
  assert.equal(sheet.getCell('F7').value, '확인 필요');
  assert.equal(sheet.getCell('G7').value, null);
  assert.equal(sheet.getCell('H7').value, '확인 필요');
  assert.equal(sheet.getCell('D7').numFmt, '+0.###;-0.###;0');
  assert.equal(sheet.getCell('A7').value, '0007');
  assert.equal(sheet.getCell('B7').value, '=2+2');
  assert.equal(sheet.getCell('B7').type, ExcelJS.ValueType.String);
  assert.ok(sheet.getCell('B7').alignment.wrapText);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].xSplit, 2);
  assert.equal(sheet.views[0].ySplit, 6);
  assert.equal(sheet.autoFilter, 'A6:H7');
  assert.match(sheet.getCell('A2').value, /2026.*41.*rose/);
  assert.match(sheet.getCell('A3').value, /StockHistory.*AfterValue/);
  assert.equal(sheet.getCell('A10').value, '품종별 합계 · 수국 제외');
  assert.equal(sheet.getCell('A13').value, '합계');
  assert.equal(sheet.getCell('B13').value, '+Rose');
  assert.equal(sheet.getCell('B13').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('H13').value, '확인 필요');
  assert.equal(sheet.getCell('G13').value, null);
});

test('special period columns remain visible; empty workbook retains every catalog week and filter', async () => {
  const matrix = buildStockAdjustmentMatrix([
    { ...base, orderWeek: '41' }, { ...base, historyKey: 'badweek', orderWeek: '=BAD()' },
  ], { orderYear: 2026 });
  const book = await reopen(matrix);
  const majorColumn = 4 + matrix.weeks.findIndex((week) => week.key === 'major:41');
  const specialColumn = 4 + matrix.weeks.findIndex((week) => week.key === 'invalid:=BAD()');
  assert.match(book.worksheets[0].getCell(6, majorColumn).value, /세부차수 미지정/);
  assert.match(book.worksheets[0].getCell(6, specialColumn).value, /확인 필요/);
  assert.equal(book.worksheets[0].getCell(6, specialColumn).type, ExcelJS.ValueType.String);
  assert.equal(book.worksheets[0].columnCount, matrix.weeks.length + 4, 'all annual matrix weeks are exported');
  const empty = await reopen(buildStockAdjustmentMatrix([], { orderYear: 2026, major: '41' }, ['41-1', '41-2']));
  assert.equal(empty.worksheets.length, 1);
  assert.equal(empty.worksheets[0].rowCount, 11);
  assert.equal(empty.worksheets[0].autoFilter, 'A6:F6');
  assert.equal(empty.worksheets[0].getCell('D6').value, '41-1');
  assert.equal(empty.worksheets[0].getCell('E6').value, '41-2');
});

test('tiny positive and negative nonzero quantities display scientifically instead of zero', async () => {
  const matrix = buildStockAdjustmentMatrix([
    { ...base, orderWeek: '41-1', afterValue: 0.0001 },
    { ...base, historyKey: 'negative', orderWeek: '41-2', afterValue: -0.0001 },
    { ...base, historyKey: 'microscopic', orderWeek: '41-3', afterValue: 1e-20 },
    { ...base, historyKey: 'zero', orderWeek: '41-4', afterValue: 0 },
  ], { orderYear: 2026, major: '41' });
  const book = await reopen(matrix);
  const actual = book.worksheets[0];
  for (const [address, value] of [['D7', 0.0001], ['E7', -0.0001], ['F7', 1e-20]]) {
    assert.equal(actual.getCell(address).value, value);
    assert.equal(actual.getCell(address).numFmt, '+0.##############E+00;-0.##############E+00;0');
  }
  assert.equal(actual.getCell('G7').value, 0);
  assert.equal(actual.getCell('G7').numFmt, '+0.###;-0.###;0');
  assert.equal(actual.getCell('H7').value, 1e-20);
  assert.equal(actual.getCell('H7').numFmt, '+0.##############E+00;-0.##############E+00;0');
  assert.notEqual(actual.getCell('A7').fill?.fgColor?.argb, 'FFEAF5ED', 'near-zero is not exact zero');
});

test('only valid event rows with exact zero net get whole-row green plus numeric/text meaning', async () => {
  const matrix = buildStockAdjustmentMatrix([
    { ...base, prodKey: 'zero', productName: '실제 0', afterValue: 0 },
    { ...base, prodKey: 'cancel', productName: '상쇄', afterValue: 2.125 },
    { ...base, prodKey: 'cancel', productName: '상쇄', orderWeek: '41-2', afterValue: -2.125 },
    { ...base, prodKey: 'invalid', productName: '오류', afterValue: null },
  ], { orderYear: 2026, major: '41' }, ['41-1', '41-2', '41-3']);
  matrix.rows.push({ key: 'no-events', prodKey: 'no-events', productName: '이력 없음', unit: '단', cells: {}, net: 0, eventCount: 0, invalidCount: 0 });
  const book = await reopen(matrix);
  const sheet = book.worksheets[0];
  for (let r = 7; r <= 6 + matrix.rows.length; r += 1) {
    const id = sheet.getCell(r, 1).value;
    const green = id === 'zero' || id === 'cancel';
    for (let c = 1; c <= 7; c += 1) {
      assert.equal(sheet.getCell(r, c).fill?.fgColor?.argb === 'FFEAF5ED', green, id + ': entire row including blank weeks follows zero criterion');
    }
    if (green) {
      assert.equal(sheet.getCell(r, 7).value, 0, 'zero remains a number');
      assert.match(sheet.getCell(r, 7).note, /차수별 조정 합계 0/);
      assert.equal(sheet.getCell(r, 6).value, null, 'blank has no invented adjustment');
    }
    if (id === 'invalid') assert.equal(sheet.getCell(r, 7).value, '확인 필요');
  }
  assert.match(sheet.getCell('A4').value, /연한 초록 행 = 차수별 조정 합계 0/);
  assert.match(sheet.getCell('A5').value, /차수별 조정 합계 0: 2행/);
});

test('same-sheet flower summary excludes hydrangea, separates units and keeps exact signed/tiny/zero values', async () => {
  const matrix = buildStockAdjustmentMatrix([
    { ...base, prodKey: '1', flower: '장미', afterValue: 2.125 },
    { ...base, prodKey: '2', flower: '장미', orderWeek: '41-2', afterValue: -2.125 },
    { ...base, prodKey: '3', flower: '장미', unit: '박스', afterValue: 0.0001 },
    { ...base, prodKey: '4', flower: '튤립', afterValue: -1e-20 },
    { ...base, prodKey: '5', flower: '수국', afterValue: 999 },
  ], { orderYear: 2026, major: '41' }, ['41-3']);
  delete matrix.flowerTotals; // Older API payloads use the exact same pure helper fallback.
  const book = await reopen(matrix);
  assert.equal(book.worksheets.length, 1);
  const sheet = book.worksheets[0];
  const productEnd = 6 + matrix.rows.length;
  assert.equal(sheet.autoFilter, 'A6:G' + productEnd, 'filter excludes the summary block');
  assert.equal(sheet.getCell(productEnd + 1, 1).value, null);
  assert.equal(sheet.getCell(productEnd + 2, 1).value, null);
  assert.equal(sheet.getCell(productEnd + 3, 1).value, '품종별 합계 · 수국 제외');
  assert.match(sheet.getCell(productEnd + 4, 1).value, /품종\/단위별 합계.*단위 미확인은 품목별 분리/);
  assert.deepEqual(sheet.getRow(productEnd + 5).values.slice(1), ['구분', '품종', '단위', '41-1', '41-2', '41-3', '순조정']);
  const totals = [];
  for (let r = productEnd + 6; r <= sheet.rowCount; r += 1) totals.push({ row: r, flower: sheet.getCell(r, 2).value, unit: sheet.getCell(r, 3).value });
  assert.equal(totals.length, 3);
  assert.ok(totals.every((row) => row.flower !== '수국'));
  const zero = totals.find((row) => row.flower === '장미' && row.unit === '단').row;
  assert.equal(sheet.getCell(zero, 4).value, 2.125);
  assert.equal(sheet.getCell(zero, 5).value, -2.125);
  assert.equal(sheet.getCell(zero, 6).value, null);
  assert.equal(sheet.getCell(zero, 7).value, 0);
  for (let c = 1; c <= 7; c += 1) assert.equal(sheet.getCell(zero, c).fill.fgColor.argb, 'FFEAF5ED');
  assert.match(sheet.getCell(zero, 7).note, /합계 0/);
  const tinyPositive = totals.find((row) => row.unit === '박스').row;
  const tinyNegative = totals.find((row) => row.flower === '튤립').row;
  assert.equal(sheet.getCell(tinyPositive, 7).value, 0.0001);
  assert.equal(sheet.getCell(tinyNegative, 7).value, -1e-20);
  for (const r of [tinyPositive, tinyNegative]) assert.equal(sheet.getCell(r, 7).numFmt, '+0.##############E+00;-0.##############E+00;0');
});

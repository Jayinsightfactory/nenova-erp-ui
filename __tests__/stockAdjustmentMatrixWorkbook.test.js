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

async function reopen(matrix, flowRows) {
  const generated = await buildStockAdjustmentMatrixWorkbook(matrix, flowRows);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await generated.xlsx.writeBuffer());
  return book;
}

test('XLSX roundtrip preserves decimals, blank vs zero vs invalid and separate residual', async () => {
  const matrix = buildStockAdjustmentMatrix([
    base, { ...base, historyKey: '002', orderWeek: '41-2', afterValue: 0 },
    { ...base, historyKey: '003', orderWeek: '41-3', beforeValue: null, afterValue: 'bad' },
  ], { orderYear: '2026', major: '41', search: 'rose' }, ['41-4']);
  const flow = [{ orderYear: 2026, major: '42', prodKey: 'other', productName: '다른 품목', category: '기타', begin: 5, arrivals: 1, shipments: 8, impliedEnd: -2, snapshotEnd: 3, adjustment: 5, negativeFlow: true }, { orderYear: 2025, major: '41', adjustment: 100 }];
  const book = await reopen(matrix, flow);
  assert.deepEqual(book.worksheets.map((s) => s.name), ['세부차수별 실제 조정', '실제 조정 원이력', '기존 대차수 흐름차이']);
  const sheet = book.worksheets[0];
  assert.equal(sheet.getCell('F7').value, 0.123456789);
  assert.equal(sheet.getCell('G7').value, 0);
  assert.equal(sheet.getCell('H7').value, '확인 필요');
  assert.equal(sheet.getCell('I7').value, null);
  assert.equal(sheet.getCell('J7').value, '확인 필요');
  assert.equal(sheet.getCell('F7').numFmt, '+0.###;-0.###;0');
  assert.equal(sheet.getCell('A7').value, '0007');
  assert.equal(sheet.getCell('B7').value, '=2+2');
  assert.equal(sheet.getCell('B7').type, ExcelJS.ValueType.String);
  assert.ok(sheet.getCell('B7').alignment.wrapText);
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].xSplit, 2);
  assert.equal(sheet.views[0].ySplit, 6);
  assert.equal(sheet.autoFilter, 'A6:J7');
  assert.match(sheet.getCell('A2').value, /2026.*41.*rose/);
  assert.match(sheet.getCell('A3').value, /StockHistory.*AfterValue/);
  const original = book.worksheets[1];
  assert.equal(original.getCell('J9').value, null);
  assert.equal(original.getCell('K9').value, 'bad');
  assert.equal(original.getCell('L9').value, '확인 필요');
  assert.equal(original.getCell('N7').value, base.reason);
  assert.equal(original.getCell('N7').type, ExcelJS.ValueType.String);
  assert.equal(original.getCell('P7').value, '+worker');
  const residual = book.worksheets[2];
  assert.match(residual.getCell('A2').value, /선택 연도 전체.*차수\/검색 필터 미적용.*다른 계산값/);
  assert.equal(residual.getCell('A7').value, '42', 'residual retains other major and product');
  assert.equal(residual.getCell('H7').value, -2);
  assert.equal(residual.getCell('J7').value, 5);
  assert.equal(residual.rowCount, 7, 'cross-year explicit residual is excluded and no mixed unit total is added');
});

test('major-only and malformed original periods remain visible; empty workbook retains filter and header', async () => {
  const matrix = buildStockAdjustmentMatrix([
    { ...base, orderWeek: '41' }, { ...base, historyKey: 'badweek', orderWeek: '=BAD()' },
  ], { orderYear: 2026 });
  const book = await reopen(matrix, []);
  assert.match(book.worksheets[0].getCell('F6').value, /세부차수 미지정/);
  assert.match(book.worksheets[0].getCell('G6').value, /확인 필요/);
  assert.equal(book.worksheets[1].getCell('C8').value, '=BAD()');
  assert.equal(book.worksheets[1].getCell('C8').type, ExcelJS.ValueType.String);
  const empty = await reopen(buildStockAdjustmentMatrix([], { orderYear: 2026 }, ['41-1']), []);
  assert.equal(empty.worksheets[0].rowCount, 6);
  assert.equal(empty.worksheets[0].autoFilter, 'A6:G6');
  assert.equal(empty.worksheets[0].getCell('F6').value, '41-1');
  assert.equal(empty.worksheets[1].rowCount, 6);
});

test('tiny positive and negative nonzero quantities display scientifically instead of zero', async () => {
  const matrix = buildStockAdjustmentMatrix([
    { ...base, orderWeek: '41-1', afterValue: 0.0001 },
    { ...base, historyKey: 'negative', orderWeek: '41-2', afterValue: -0.0001 },
    { ...base, historyKey: 'microscopic', orderWeek: '41-3', afterValue: 1e-20 },
    { ...base, historyKey: 'zero', orderWeek: '41-4', afterValue: 0 },
  ], { orderYear: 2026 });
  const book = await reopen(matrix, [{ major: '41', adjustment: -0.0001 }]);
  const actual = book.worksheets[0];
  for (const [address, value] of [['F7', 0.0001], ['G7', -0.0001], ['H7', 1e-20]]) {
    assert.equal(actual.getCell(address).value, value);
    assert.equal(actual.getCell(address).numFmt, '+0.##############E+00;-0.##############E+00;0');
  }
  assert.equal(actual.getCell('I7').value, 0);
  assert.equal(actual.getCell('I7').numFmt, '+0.###;-0.###;0');
  assert.equal(actual.getCell('J7').value, 1e-20);
  assert.equal(actual.getCell('J7').numFmt, '+0.##############E+00;-0.##############E+00;0');
  assert.equal(book.worksheets[1].getCell('L7').numFmt, '+0.##############E+00;-0.##############E+00;0');
  assert.equal(book.worksheets[2].getCell('J7').numFmt, '+0.##############E+00;-0.##############E+00;0');
});

import assert from 'node:assert/strict';
import { appendDutchQuantityHistory, buildDutchQuantitySummaryValues, createDutchBlankCellEntry, normalizeDutchQuantityHistory, parseDutchSheetQuantity } from '../lib/dutchSheetQuantityEdit.js';

assert.deepEqual(parseDutchSheetQuantity('12'), { ok: true, quantity: 12 });
assert.deepEqual(parseDutchSheetQuantity(' 1.25 '), { ok: true, quantity: 1.25 });
assert.deepEqual(parseDutchSheetQuantity('0'), { ok: true, quantity: 0 });
assert.deepEqual(parseDutchSheetQuantity(''), { ok: false, reason: 'empty' });
assert.deepEqual(parseDutchSheetQuantity('   '), { ok: false, reason: 'empty' });
assert.deepEqual(parseDutchSheetQuantity('abc'), { ok: false, reason: 'not-finite' });
assert.deepEqual(parseDutchSheetQuantity('Infinity'), { ok: false, reason: 'not-finite' });
assert.deepEqual(parseDutchSheetQuantity('-0.1'), { ok: false, reason: 'negative' });

const colName = index => String.fromCharCode(65 + index);
const address = ({ r, c }) => `${colName(c)}${r + 1}`;
const mockXlsx = { utils: {
  encode_cell: address,
  decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 5, c: 5 } }),
} };
const sheet = {
  '!ref': 'A1:F6',
  D3: { v: '업체 A' }, E3: { v: '업체 B' }, F3: { v: '주문' },
  A4: { v: 'Hydrangea' }, B4: { v: 'Blue' }, C4: { v: '파랑' },
};
const blankCell = createDutchBlankCellEntry(mockXlsx, sheet, '네덜란드', 3, 3, 3);
assert.deepEqual(blankCell, {
  id: '네덜란드!D4', added: false, sourceCellDraft: true, sheetName: '네덜란드', cellAddress: 'D4',
  product: 'Hydrangea', color: 'Blue', sourceFlower: 'Hydrangea', sourceItem: 'Blue', sourceColor: '파랑',
  customer: '업체 A', sourceCustomer: '업체 A', sourceRow: 3, sourceColumn: 3, layoutVersion: 3, quantity: 0, unit: '',
});
assert.equal(createDutchBlankCellEntry(mockXlsx, sheet, '네덜란드', 3, 5, 3), null, '요약 주문 열은 수량 셀로 취급하지 않는다');
assert.equal(createDutchBlankCellEntry(mockXlsx, sheet, '네덜란드', 2, 3, 3), null, '헤더 행은 편집하지 않는다');
assert.equal(createDutchBlankCellEntry(mockXlsx, { ...sheet, A4: { v: '합계' } }, '네덜란드', 3, 3, 3), null, '합계 행은 편집하지 않는다');
assert.equal(createDutchBlankCellEntry(mockXlsx, { ...sheet, D4: { f: '1+2', v: 3 } }, '네덜란드', 3, 3, 3), null, '수식 셀은 편집하지 않는다');
assert.equal(createDutchBlankCellEntry(mockXlsx, { ...sheet, D4: { v: 'memo' } }, '네덜란드', 3, 3, 3), null, '텍스트 셀은 편집하지 않는다');
assert.ok(createDutchBlankCellEntry(mockXlsx, { ...sheet, D4: { v: 0 } }, '네덜란드', 3, 3, 3), '원본 0 셀은 수량 입력 대상으로 허용한다');
assert.deepEqual(appendDutchQuantityHistory([], null, 4, '2026-10-07T00:00:00.000Z'), [{ from: null, to: 4, changedAt: '2026-10-07T00:00:00.000Z' }]);
assert.equal(normalizeDutchQuantityHistory([{ from: 1, to: 2, changedAt: 'bad' }]).length, 0, '잘못된 이력은 표시·저장하지 않는다');
const totalsMock = { utils: { ...mockXlsx.utils, decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 5, c: 6 } }) } };
const totalsSheet = {
  '!ref': 'A1:G6', D3: { v: '업체 A' }, E3: { v: '업체 B' }, F3: { v: '주문' }, G3: { v: '입고' },
  A4: { v: '장미' }, D4: { v: 5 }, E4: { v: 2 }, F4: { v: 7 }, G4: { v: 9 },
  A5: { v: '합계' }, D5: { v: 5 }, E5: { v: 2 }, F5: { v: 7 }, G5: { v: 9 },
};
const summaryEntries = [
  { id: 'D4', added: false, sheetName: 'NL', sourceRow: 3, sourceColumn: 3, layoutVersion: 3, quantity: 8 },
  { id: 'E4', added: false, sheetName: 'NL', sourceRow: 3, sourceColumn: 4, layoutVersion: 3, quantity: 3 },
];
assert.deepEqual([...buildDutchQuantitySummaryValues(totalsMock, totalsSheet, 'NL', summaryEntries)], [['F4', 11], ['D5', 8], ['E5', 3], ['F5', 11]], '행 주문합계와 고객별/주문 총합계를 즉시 다시 계산하되 입고 합계는 유지한다');
console.log('dutch sheet quantity edit tests passed');

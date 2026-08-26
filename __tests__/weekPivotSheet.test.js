// node __tests__/weekPivotSheet.test.js
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import XLSXStyled from 'xlsx-js-style';
import JSZip from 'jszip';
import { buildWeekPivotSheet } from '../lib/weekPivotSheet.js';

const weeks = ['29-01', '29-02'];
const sheet = buildWeekPivotSheet(XLSX, {
  weeks,
  custKeys: [10, 20],
  prodKeys: [100, 200],
  prodMap: {
    100: { coun: '콜롬비아', flower: '장미', name: '레드', displayName: '레드 장미' },
    200: { coun: '케냐', flower: '카네이션', name: '핑크' },
  },
  dataMap: {
    '100-10-29-01': 3, '100-20-29-01': 2, '100-10-29-02': 4,
    '200-10-29-01': 1,
  },
  inMap: { '100-29-01': 10, '100-29-02': 5, '200-29-01': 2 },
  startStocks: { '100-29-01': { stock: 8 }, '200-29-01': { stock: 1 } },
  prevStockMap: { 100: 99, 200: 4 },
  descrMap: {
    '100-10-29-01': 'ADD 3',
    '100-20-29-01': '=SUM(A1:A2)',
    '100-20-29-02': 'CANCEL 2', // zero quantity still must be exported
    '200-10-29-01': '"quoted" raw note',
  },
  areaGroups: [{ area: '서울', count: 2 }],
  customerLabel: (key) => ({ 10: '호텔A', 20: '호텔B' })[key],
  productLabel: (product) => product.displayName || product.name,
});

assert.equal(sheet.D4.v, 3);
assert.equal(sheet.E4.v, 2);
assert.equal(sheet.F4.v, 8);
assert.equal(sheet.G4.v, 10);
assert.equal(sheet.H4.v, 5);
assert.equal(sheet.I4.v, 13);
assert.equal(sheet.J4.t, 's');
assert.equal(sheet.J4.v, '호텔A: ADD 3\n호텔B: =SUM(A1:A2)');
assert.equal(sheet.Q4.v, '호텔B: CANCEL 2');
assert.equal(sheet.J6.f, undefined, 'notes total cell intentionally has no formula');
assert.equal(sheet.D6.f, 'SUM(D4:D5)');
assert.equal(sheet.I6.f, 'SUM(I4:I5)');
assert.ok(sheet['!merges'].some((merge) => merge.s.r === 0 && merge.s.c === 3 && merge.e.c === 9));
assert.ok(sheet['!merges'].some((merge) => merge.s.r === 1 && merge.s.c === 5 && merge.e.c === 9));
assert.equal(sheet['!cols'][9].wch, 36);
assert.ok(sheet['!rows'][3].hpt >= 30, 'multi-customer note rows have suitable height');

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, '차수피벗');
const styledBuffer = XLSXStyled.write(workbook, { type: 'buffer', bookType: 'xlsx' });
const roundTripped = XLSXStyled.read(
  styledBuffer,
  { type: 'buffer', cellStyles: true },
).Sheets.차수피벗;
assert.equal(roundTripped.D4.v, 3, 'quantity remains numeric through XLSX roundtrip');
assert.equal(roundTripped.D6.f, 'SUM(D4:D5)', 'quantity total remains a formula through XLSX roundtrip');
assert.equal(roundTripped.J4.t, 's', 'formula-looking note is stored as text');
assert.equal(roundTripped.J4.v, '호텔A: ADD 3\n호텔B: =SUM(A1:A2)');
const stylesXml = await (await JSZip.loadAsync(styledBuffer)).file('xl/styles.xml').async('string');
assert.match(stylesXml, /<alignment[^>]*wrapText="(?:1|true)"/, 'styled writer preserves note wrapping in the XLSX style table');
assert.equal(roundTripped.Q4.v, '호텔B: CANCEL 2');

const emptySheet = buildWeekPivotSheet(XLSX, { weeks: ['29-01'], custKeys: [10] });
assert.equal(emptySheet.D4.f, undefined, 'empty exports do not create a self-referential SUM');
console.log('weekPivotSheet tests passed');

import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseArrivalCostWorkbook } from '../lib/arrivalCostExcel.js';
import { arrivalDriveCandidate, scopeArrivalDriveRows } from '../lib/arrivalDrivePolicy.js';

const fileName = '태국 덴파레 원가 자료 - EXCEL 2026 (38-1) (1).xlsx';
const book = XLSX.utils.book_new();
function addSheet(name, week, cost = 9033.76279932948) {
  const aoa = [
    [null, 'Thailand 원가자료'], [], [], [],
    [null, '차수', week],
    [null, '환율', 1400], [], [], [], [], [], [], [],
    [null, 'Company', 'Color Grade', null, null, '수량', 'FOB', '도착원가(송이)', '단당 수량', '도착원가(단)'],
    [null, 'Super Fresh', 'Den. Big White (화이트) L', null, null, 100, 0.35, cost / 10, 10, cost],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet['!ref'] = 'A1:XFC242'; // source's formatting-only trailing range
  XLSX.utils.book_append_sheet(book, sheet, name);
}
addSheet('37', '.37-1', 8268.54144993437);
addSheet('38', '.38-1');
addSheet('36', ''); // never infer 38-1 for a historical numbered sheet
addSheet('Plantilla', ''); // template must not acquire filename fallback
addSheet('38-2', '.38-1', 9000); // explicit sheet identifier stays authoritative
const input = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
const options = { fileName, orderYear: '2026' };
const parsed = parseArrivalCostWorkbook(input, options);
assert.equal(parsed.rows.length, 4);
assert.deepEqual(parsed.rows.map(r => r.orderWeek), ['37-1', '38-1', '', '38-2']);
assert.ok(parsed.rows.every(r => r.sourceRow === 15), 'physical Excel row numbers survive blank rows');
assert.deepEqual(parsed.skippedSheets.map(s => s.sheetName), ['Plantilla']);
const source = arrivalDriveCandidate({ id: 'thai', filename: fileName, sha: 'fixture', mtime: '2026-09-18T06:44:00Z' }, '2026');
const scoped = scopeArrivalDriveRows(parsed, source);
assert.equal(scoped.rows.length, 1);
assert.equal(scoped.rows[0].sheetName, '38');
assert.equal(scoped.rows[0].sourceArrivalCostKRW, 9033.76279932948);
assert.equal(scoped.rows[0].quantity, 100);
assert.equal(scoped.rows[0].exchangeRate, 1400);
assert.throws(() => scopeArrivalDriveRows(parseArrivalCostWorkbook(input, { ...options, orderYear: '2025' }), source), /연도/);
assert.throws(() => scopeArrivalDriveRows({ ...parsed, rows: parsed.rows.filter(r => r.sheetName === '37') }, source), /파일명 38-1.*시트 인식 37-1/);
assert.throws(() => scopeArrivalDriveRows({ ...parsed, rows: [] }, source), /차수 미인식/);

for (const [name, header, filename, expected] of [
  ['Sheet1', '', fileName, '38-1'],
  ['Sheet1', '차수: .38-01', '태국.xlsx', '38-1'],
  ['Sheet1', '2026-09-18', '태국.xlsx', ''],
  ['Sheet1', '2026.09-18', '태국.xlsx', ''],
  ['Sheet1', 'ABC38-1', '태국.xlsx', ''],
  ['Sheet1', '38-100', '태국.xlsx', ''],
]) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Thailand', header], ['품목명', '수량', '도착원가(단)'], ['Den. White L', 1, 100],
  ]), name);
  const result = parseArrivalCostWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { fileName: filename, orderYear: '2026' });
  assert.equal(result.rows[0].orderWeek, expected, `${header} / ${filename}`);
}
console.log('Thai week parser: dotted cells, parenthesized filename, historical/template exclusion, original prices/rows and cross-year guards passed');

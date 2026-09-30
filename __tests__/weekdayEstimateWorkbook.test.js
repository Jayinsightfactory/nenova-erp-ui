import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { parseWeekdayEstimateWorkbook } from '../lib/weekdayEstimateWorkbook.js';

const ws = XLSX.utils.aoa_to_sheet([
  ['2026년 9월 출고 계획'],
  ['카네\n이션', '색상', '', '', '', '(20일) 일요일 출고 예정', '', '', '(27일) 일요일 출고 예정'],
  ['', 'Moon Light', '', '', '', 12, '', '', 8],
  ['', '문자 확인', '', '', '', '2+14단', '', '', 3],
  ['', '합계', '', '', '', { t: 'n', f: 'SUM(F3:F4)', v: 12 }, '', '', ''],
]);
ws['!merges'] = [XLSX.utils.decode_range('A2:A5')];
const workbook = { SheetNames: ['현장'], Sheets: { 현장: ws } };
const parsed = parseWeekdayEstimateWorkbook(workbook, { fileName: 'sample.xlsx' });
const sheet = parsed.sheets[0];

assert.equal(parsed.safety.erpWritten, false);
assert.equal(parsed.safety.persisted, false);
assert.deepEqual(sheet.merges, ['A2:A5']);
assert.equal(sheet.sectionMarkers[0].value, '카네이션');
assert.equal(sheet.rows.at(-1).section, '카네이션', 'last worksheet row retains its section');
const moon = sheet.rows.find((row) => row.label === 'Moon Light');
assert.ok(moon, '품목 원본행 보존');
assert.equal(moon.cells.find((cell) => cell.address === 'F3').numericCandidate, 12);
assert.equal(moon.cells.find((cell) => cell.address === 'F3').headerRole, 'date-quantity-candidate');
assert.equal(moon.cells.find((cell) => cell.address === 'I3').numericCandidate, 8);
const textQuantity = sheet.rows.find((row) => row.label === '문자 확인').cells.find((cell) => cell.address === 'F4');
assert.equal(textQuantity.kind, 'text-review');
assert.equal(textQuantity.numericCandidate, null);
const formula = sheet.rows.find((row) => row.label === '합계').cells.find((cell) => cell.address === 'F5');
assert.equal(formula.kind, 'formula-review');
assert.equal(formula.numericCandidate, null);
console.log('weekdayEstimateWorkbook tests passed');

const mixed = XLSX.utils.aoa_to_sheet([
 ['2026년 출고'],
 ['알스트로메리아','색상','','','','(20일) 일요일 출고 예정'],
 ['알스트로메리아','Fifi','','','',4,'','','','','','','','','','','','','','','','','','','수요일 사용'],
]);
const mixedParsed=parseWeekdayEstimateWorkbook({SheetNames:['혼합'],Sheets:{혼합:mixed}});
const fifi=mixedParsed.sheets[0].rows.find(x=>x.row===3);
assert.equal(fifi.label,'Fifi','section marker and product can share a row');
assert.equal(fifi.isHeaderRow,false,'usage memo must not hide a product row');
assert.equal(fifi.cells.find(x=>x.address==='F3').numericCandidate,4);

import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { inferArrivalYearEvidence, parseArrivalCostWorkbook } from '../lib/arrivalCostExcel.js';
import { validateArrivalImportYear } from '../lib/arrivalImportPolicy.js';

function parse({ fileName = '40-1 NL 원가자료.xlsx', orderYear = '2026', sheet = '40-1', header = 'NL 원가자료' } = {}) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    [header], ['품목명', '수량', '도착원가(단)'], ['Wax White', 2, 2025],
  ]), sheet);
  book.Props = { CreatedDate: new Date('2025-01-01'), ModifiedDate: new Date('2026-10-01') };
  return parseArrivalCostWorkbook(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { fileName, orderYear }).rows[0];
}

const unverified = parse();
assert.equal(unverified.orderYear, '2026');
assert.equal(unverified.yearEvidence.status, 'unverified', 'file mtime/template props and numeric price 2025 do not establish year');
assert.equal(parse({ orderYear: '' }).orderYear, '', 'missing explicit/caller year must not default to current calendar year');
for (const year of ['2025', '2026']) {
  const row = parse({ fileName: `${year}년 40-1 NL 원가자료.xlsx`, orderYear: year });
  assert.equal(row.orderYear, year);
  assert.equal(row.yearEvidence.status, 'verified');
  assert.equal(row.sourceArrivalCostKRW, 2025);
  assert.equal(row.quantity, 2);
}
const internalOld = parse({ header: 'NL 2025년 원가자료' });
assert.equal(internalOld.orderYear, '');
assert.equal(internalOld.yearEvidence.status, 'conflict');
assert.deepEqual(internalOld.yearEvidence.sheetYears, ['2025']);
assert.equal(parse({ fileName: '2026년 40-1 NL 원가자료.xlsx', header: '2025년 자료' }).yearEvidence.status, 'conflict');
assert.equal(parse({ header: '2025년 / 2026년 통합자료' }).yearEvidence.status, 'conflict');
assert.equal(parse({ fileName: '2025년 40-1 NL 원가자료.xlsx' }).yearEvidence.status, 'conflict');
assert.equal(inferArrivalYearEvidence({ headerValues: [new Date('2025-10-01T00:00:00Z')], orderYear: '2026' }).status, 'conflict');
assert.equal(parse({ header: new Date('2025-10-01T00:00:00Z') }).yearEvidence.status, 'conflict', 'real Excel date cells are independent internal year evidence');
assert.equal(inferArrivalYearEvidence({ headerValues: [2025, '20250'], orderYear: '2026' }).status, 'unverified');
for (const sheet of ['34-2B CLOUD', '34-2A CLOUD', '34-2B', '34-2 CLOUD']) {
  const row = parse({ fileName: '2026년 CHINA 중국 원가자료 (40-1차).xlsx', sheet });
  assert.equal(row.orderWeek, '34-2', `${sheet} cannot inherit 40-1`);
  assert.equal(row.yearEvidence.status, 'verified');
  assert.equal(JSON.parse(row.rawJson).meta.orderYear, '2026');
}
console.log('Arrival source years: 2025/2026 separation, conflicting/internal years, missing evidence and letter-suffix sheet weeks passed');

// Actual incident: September's NL workbook retained an undated December sheet.
for (const selectedYear of ['2025', '2026']) {
  const oldSheet = parse({ fileName: '37-2 NL 원가자료 (2).xlsx', sheet: '52-2', orderYear: selectedYear });
  assert.equal(oldSheet.orderYear, '');
  assert.equal(oldSheet.yearEvidence.status, 'conflict');
  assert.throws(() => validateArrivalImportYear({ rows: [oldSheet] }, selectedYear), /52-2.*연도/);
  assert.throws(() => validateArrivalImportYear({ rows: [], rejectedRows: [oldSheet] }, selectedYear), /52-2.*연도/);
  for (const sheet of ['36-2', '37-2']) {
    const valid = parse({ fileName: '37-2 NL 원가자료.xlsx', sheet, orderYear: selectedYear });
    assert.equal(validateArrivalImportYear({ rows: [valid] }, selectedYear), selectedYear);
  }
}
for (const sheet of ['52-02', '52-2A', '47-1']) {
  assert.equal(parse({ fileName: '37-2 NL 원가자료.xlsx', sheet }).yearEvidence.status, 'conflict');
}
assert.equal(parse({ fileName: '37-2 NL 원가자료.xlsx', sheet: '52-2', header: '2026년 NL 원가자료' }).yearEvidence.status, 'verified');
assert.equal(parse({ fileName: '37-2 NL 원가자료.xlsx', sheet: '52-2', header: '2025년 NL 원가자료' }).yearEvidence.status, 'conflict');
assert.equal(parse({ fileName: 'NL 원가자료.xlsx', sheet: '52-2' }).yearEvidence.status, 'unverified', 'no filename week must not invent chronology');
console.log('Undated rolling workbook 52-2 cannot inherit the selected year from 37-2; explicit years and normal current/prior sheets preserved');

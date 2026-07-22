import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import {
  normalizeParentWeek,
  previousParentScope,
  normalizeDeductionRow,
} from '../lib/salesDefectDeductionCore.js';
import {
  parseQuantityCell,
  parseSalesDefectWorkbook,
  buildSalesDefectWorkbook,
} from '../lib/salesDefectDeductionExcel.js';

assert.equal(normalizeParentWeek('29-02'), 29);
assert.equal(normalizeParentWeek('29'), 29);
assert.deepEqual(previousParentScope(2026, 29), { year: 2026, week: 28 });
assert.deepEqual(previousParentScope(2026, 1), { year: 2025, week: 52 });
assert.deepEqual(parseQuantityCell('1,250단'), { quantity: 1250, unit: '단', raw: '1,250단' });
assert.deepEqual(parseQuantityCell('5대'), { quantity: 5, unit: '스팀(대)', raw: '5대' });
assert.equal(normalizeDeductionRow({ quantity: '-5', customerName: 'A' }).quantity, 5);

const templatePath = 'data/sales-defect-deduction-template.xlsx';
assert.ok(fs.existsSync(templatePath), '원본 불량 차감 양식이 있어야 한다.');
const source = await parseSalesDefectWorkbook(fs.readFileSync(templatePath));
assert.equal(source.sheetName, '30차');
assert.equal(source.title.year, '2026');
assert.equal(source.title.week, '29');
assert.equal(source.rows[0].customerName, '광주천사');
assert.equal(source.rows[0].quantity, 5);

const buffer = await buildSalesDefectWorkbook([
  {
    customerName: '테스트거래처', productName: '카네이션', colorName: '카오리',
    quantity: 5, sourceUnit: '단', creditApplied: true, farmName: '테스트농장', note: '메모',
  },
], { year: 2026, week: 29, managerName: '테스트담당자' });
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
assert.equal(wb.worksheets[0].name, '29차');
assert.equal(String(wb.worksheets[0].getCell('D2').value).includes('( 29 )'), true);
assert.equal(wb.worksheets[0].getCell('B6').value, '테스트거래처');
assert.equal(wb.worksheets[0].getCell('G6').value, '5단');
assert.equal(wb.worksheets[0].getCell('H6').value, '✓');

console.log('sales defect deduction tests passed');

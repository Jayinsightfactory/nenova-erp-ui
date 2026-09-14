import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildPivotModel, EXE_FIELDS } from '../lib/pivotExeModel.js';
import { buildPivotExeWorkbook } from '../lib/pivotExeExport.js';

const layout = { row: ['ProdName'], column: ['OrderYear'], filter: EXE_FIELDS.map(field => field.id).filter(id => !['ProdName', 'OrderYear', 'Quantity'].includes(id)), data: ['Quantity'] };
const model = buildPivotModel([
  { ProdName: '=formula-looking', OrderYear: 2025, Quantity: 1.25 },
  { ProdName: '=formula-looking', OrderYear: 2026, Quantity: 2.5 },
], { layout, showGrandTotals: false, showRowTotals: false, showColumnTotals: false });
const buffer = await buildPivotExeWorkbook(model, { decimalPlaces: 2 });
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(buffer);
const worksheet = workbook.getWorksheet('EXE 피벗');
assert.ok(worksheet, 'one visible pivot worksheet is exported');
assert.match(String(worksheet.getCell('B1').value), /주문년도: 2025/, 'Excel preserves the complete visible column hierarchy');
assert.equal(worksheet.getCell('A2').value, "'=formula-looking", 'formula-looking native text is stored safely as text');
assert.equal(typeof worksheet.getCell('B2').value, 'number', 'aggregate cells round-trip as numeric cells');
assert.equal(worksheet.getCell('B2').value, 1.25);
assert.equal(worksheet.getCell('B2').numFmt, '#,##0.00', 'visible decimal precision has an Excel number format');
console.log('pivotExeExport tests passed');

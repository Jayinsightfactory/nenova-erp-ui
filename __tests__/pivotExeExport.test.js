import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildPivotModel, EXE_FIELDS, pivotCellKey } from '../lib/pivotExeModel.js';
import { buildPivotExeWorkbook } from '../lib/pivotExeExport.js';
import { buildPivotExePresentation, getPivotExeDataColumnId } from '../lib/pivotExePresentation.js';

const layout = { row: ['ProdName'], column: ['OrderYear'], filter: EXE_FIELDS.map(field => field.id).filter(id => !['ProdName', 'OrderYear', 'Quantity'].includes(id)), data: ['Quantity'] };
const model = buildPivotModel([
  { ProdName: '=formula-looking', OrderYear: 2025, Quantity: 1.25 },
  { ProdName: '=formula-looking', OrderYear: 2026, Quantity: 2.5 },
], { layout, showGrandTotals: false, showRowTotals: false, showColumnTotals: false });
const widths = { ProdName: 220, __data: 111, [getPivotExeDataColumnId(model.columnAxis[0],model.measures[0])]: 137 };
const buffer = await buildPivotExeWorkbook(model, { decimalPlaces: 2, columnWidths: widths, rowHeight: 28 });
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.load(buffer);
const worksheet = workbook.getWorksheet('EXE 피벗');
assert.ok(worksheet, 'one visible pivot worksheet is exported');
assert.equal(worksheet.getCell('B1').value, '2025', 'Excel keeps compact axis labels without repeating the field name');
assert.equal(worksheet.getCell('A3').value, "'=formula-looking", 'formula-looking native text is stored safely as text');
assert.equal(typeof worksheet.getCell('B3').value, 'number', 'aggregate cells round-trip as numeric cells');
assert.equal(worksheet.getCell('B3').value, 1.25);
assert.equal(worksheet.getCell('B3').numFmt, '#,##0.00', 'visible decimal precision has an Excel number format');
assert.equal(worksheet.getColumn(2).width, 19.57, 'individual data width overrides the shared numeric default in the workbook');
assert.equal(worksheet.getRow(3).height, 21, 'CSS row height is shared as Excel points');
const grouped = buildPivotModel([
  {CounName:'콜롬비아',FlowerName:'수국',ProdName:'White',OrderYear:2025,OrderWeek:'37-01',Quantity:1.2345},
  {CounName:'콜롬비아',FlowerName:'수국',ProdName:'Blue',OrderYear:2026,OrderWeek:'37-01',Quantity:0},
  {CounName:'콜롬비아',FlowerName:'수국',ProdName:'White',OrderYear:2026,OrderWeek:'37-01',Quantity:2.3456},
], {layout:{row:['CounName','FlowerName','ProdName'],column:['OrderYear','OrderWeek'],data:['Quantity']}});
const structure = buildPivotExePresentation(grouped);
for (const decimalPlaces of [0,2]) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildPivotExeWorkbook(grouped,{decimalPlaces,blankZero:false}));
  const sheet = book.worksheets[0];
  for (const [r, axis] of grouped.rowAxis.entries()) for (const [c, column] of structure.dataColumns.entries()) {
    const raw = grouped.cellMap[pivotCellKey(axis.key,column.column.key)]?.values?.[column.measure.key];
    const cell = sheet.getCell(structure.headerRows.length+r+1,structure.rowFields.length+c+1);
    assert.equal(cell.value, raw ?? '', 'all visible totals and data stay exact through merged XLSX');
    if (typeof raw === 'number') assert.equal(cell.numFmt,decimalPlaces===0?'#,##0':'#,##0.00');
  }
  assert.ok(sheet.model.merges.some(range => /^A\d+:A\d+$/.test(range)), 'row group merges survive XLSX roundtrip');
  assert.equal(sheet.views[0].ySplit,structure.headerRows.length,'all header levels freeze together');
}
const empty = buildPivotModel([], {layout});
const emptyBook = new ExcelJS.Workbook();
await emptyBook.xlsx.load(await buildPivotExeWorkbook(empty));
assert.equal(emptyBook.worksheets[0].rowCount,buildPivotExePresentation(empty).headerRows.length,'empty filtered screen does not export a synthetic grand-total body row');
const sparseLarge = buildPivotModel(Array.from({length:501},(_,i)=>({ProdName:`P${i}`,CustName:`C${i}`,Quantity:1})),{layout:{row:['ProdName'],column:['CustName'],data:['Quantity']},showRowTotals:false,showColumnTotals:false,showGrandTotals:false});
await assert.rejects(buildPivotExeWorkbook(sparseLarge),error=>error.code==='PIVOT_RENDER_CELL_LIMIT','export must refuse giant cross products before creating Excel cells');
console.log('pivotExeExport tests passed');

// ExcelJS export for the EXE pivot.  It writes only the final visible pivot model.
import ExcelJS from 'exceljs';
import { pivotModelToAoA } from './pivotExeModel.js';

const FORMULA_PREFIX = /^[=+\-@]/;
const safeText = value => typeof value === 'string' && FORMULA_PREFIX.test(value) ? `'${value}` : value;

function numberFormat(decimalPlaces) {
  const places = Number.isInteger(decimalPlaces) && decimalPlaces >= 0 ? decimalPlaces : 2;
  return places === 0 ? '#,##0' : `#,##0.${'0'.repeat(places)}`;
}

/** Adds one worksheet from a final buildPivotModel result. */
export function addPivotExeWorksheet(workbook, model, { sheetName = 'EXE 피벗', decimalPlaces = 2, blankZero = false } = {}) {
  if (!workbook?.addWorksheet) throw new Error('An ExcelJS workbook is required');
  if (!model || !Array.isArray(model.rowAxis) || !Array.isArray(model.columnAxis)) throw new Error('A buildPivotModel result is required');
  const worksheet = workbook.addWorksheet(String(sheetName).slice(0, 31) || 'EXE 피벗');
  const aoa = pivotModelToAoA(model, { blankZero });
  const numericColumns = new Set();
  const rowFieldCount = model.layout.row.length;
  const measureCount = model.measures.length;
  for (let column = 0; column < model.columnAxis.length; column += 1) {
    for (let measure = 0; measure < measureCount; measure += 1) numericColumns.add(rowFieldCount + column * measureCount + measure + 1);
  }
  aoa.forEach((values, rowIndex) => {
    const row = worksheet.getRow(rowIndex + 1);
    values.forEach((value, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      cell.value = typeof value === 'number' && Number.isFinite(value) ? value : safeText(value);
      if (rowIndex === 0) {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EFF7' } };
        cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
      } else if (numericColumns.has(columnIndex + 1) && typeof cell.value === 'number') {
        cell.numFmt = numberFormat(decimalPlaces);
      }
      if (rowIndex > 0 && model.rowAxis[rowIndex - 1]?.isTotal) cell.font = { bold: true };
    });
  });
  worksheet.views = [{ state: 'frozen', ySplit: 1, xSplit: rowFieldCount }];
  worksheet.autoFilter = aoa[0]?.length ? { from: { row: 1, column: 1 }, to: { row: 1, column: aoa[0].length } } : undefined;
  worksheet.columns.forEach((column, index) => {
    const headerWidth = String(aoa[0]?.[index] ?? '').length;
    const bodyWidth = aoa.slice(1).reduce((maximum, row) => Math.max(maximum, String(row[index] ?? '').length), 0);
    column.width = Math.min(Math.max(index < rowFieldCount ? 10 : 12, headerWidth + 2, bodyWidth + 2), 255);
  });
  return worksheet;
}

/** Returns ExcelJS's native writeBuffer result (Buffer in Node, ArrayBuffer in browsers). */
export async function buildPivotExeWorkbook(model, options = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'nenovaweb';
  workbook.created = new Date();
  addPivotExeWorksheet(workbook, model, options);
  return workbook.xlsx.writeBuffer();
}

export const buildPivotWorkbook = buildPivotExeWorkbook;
export const exportPivotExeXlsx = buildPivotExeWorkbook;

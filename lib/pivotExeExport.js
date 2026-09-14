// ExcelJS export for the EXE pivot.  It writes only the final visible pivot model.
import ExcelJS from 'exceljs';
import { assertPivotRenderLimit, pivotCellKey } from './pivotExeModel.js';
import {
  buildPivotExePresentation,
  pivotExeExcelColumnWidth,
  pivotExeExcelRowHeight,
} from './pivotExePresentation.js';

const FORMULA_PREFIX = /^[=+\-@]/;
const safeText = value => typeof value === 'string' && FORMULA_PREFIX.test(value) ? `'${value}` : value;

function numberFormat(decimalPlaces) {
  const places = Number.isInteger(decimalPlaces) && decimalPlaces >= 0 ? decimalPlaces : 2;
  return places === 0 ? '#,##0' : `#,##0.${'0'.repeat(places)}`;
}

/** Adds one worksheet from a final buildPivotModel result. */
export function addPivotExeWorksheet(workbook, model, {
  sheetName = 'EXE 피벗', decimalPlaces = 2, blankZero = false,
  columnWidths = {}, rowHeight,
} = {}) {
  if (!workbook?.addWorksheet) throw new Error('An ExcelJS workbook is required');
  if (!model || !Array.isArray(model.rowAxis) || !Array.isArray(model.columnAxis)) throw new Error('A buildPivotModel result is required');
  assertPivotRenderLimit(model);
  const worksheet = workbook.addWorksheet(String(sheetName).slice(0, 31) || 'EXE 피벗');
  const presentation = buildPivotExePresentation(model, { widths: columnWidths, rowHeight });
  const rowFieldCount = presentation.rowFields.length;
  const headerRows = presentation.headerRows.length;
  const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EFF7' } };
  const border = { style: 'thin', color: { argb: 'FFAAB8C8' } };
  const applyHeader = (cell) => {
    cell.font = { bold: true };
    cell.fill = fill;
    cell.border = { top: border, left: border, bottom: border, right: border };
    cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
  };
  presentation.rowWidths.forEach((field, index) => {
    const cell = worksheet.getCell(1, index + 1);
    cell.value = safeText(field.label);
    applyHeader(cell);
    if (headerRows > 1) worksheet.mergeCells(1, index + 1, headerRows, index + 1);
  });
  presentation.headerRows.forEach((cells, level) => cells.forEach((header) => {
    const startColumn = rowFieldCount + header.columnStart + 1;
    const cell = worksheet.getCell(level + 1, startColumn);
    cell.value = safeText(header.label);
    applyHeader(cell);
    if (header.columnSpan > 1) worksheet.mergeCells(level + 1, startColumn, level + 1, startColumn + header.columnSpan - 1);
  }));
  const visibleRows = model.filteredRowCount === 0 ? [] : model.rowAxis;
  visibleRows.forEach((axis, rowIndex) => {
    const worksheetRow = worksheet.getRow(headerRows + rowIndex + 1);
    worksheetRow.height = pivotExeExcelRowHeight(presentation.rowHeight);
    presentation.rowHeaderCells[rowIndex].forEach((header, fieldIndex) => {
      if (!header || header.hidden) return;
      const cell = worksheetRow.getCell(fieldIndex + 1);
      cell.value = safeText(header.label);
      cell.border = { top: border, left: border, bottom: border, right: border };
      if (axis.isTotal) cell.font = { bold: true };
      if (header.rowSpan > 1) worksheet.mergeCells(headerRows + rowIndex + 1, fieldIndex + 1, headerRows + rowIndex + header.rowSpan, fieldIndex + 1);
    });
    presentation.dataColumns.forEach(({ column, measure }, dataIndex) => {
      const cell = worksheetRow.getCell(rowFieldCount + dataIndex + 1);
      const value = model.cellMap?.[pivotCellKey(axis.key, column.key)]?.values?.[measure.key];
      cell.value = typeof value === 'number' && Number.isFinite(value) ? value : safeText(value ?? '');
      cell.border = { top: border, left: border, bottom: border, right: border };
      cell.alignment = { horizontal: 'right', vertical: 'center' };
      if (typeof cell.value === 'number') cell.numFmt = numberFormat(decimalPlaces);
      if (axis.isTotal) cell.font = { bold: true };
      if (blankZero && value === 0) cell.value = '';
    });
  });
  for (let index = 1; index <= headerRows; index += 1) worksheet.getRow(index).height = pivotExeExcelRowHeight(presentation.rowHeight);
  [...presentation.rowWidths, ...presentation.dataColumns].forEach((column, index) => {
    worksheet.getColumn(index + 1).width = pivotExeExcelColumnWidth(column.width);
  });
  worksheet.views = [{ state: 'frozen', ySplit: headerRows, xSplit: rowFieldCount }];
  const endColumn = rowFieldCount + presentation.dataColumns.length;
  worksheet.autoFilter = endColumn ? { from: { row: headerRows, column: 1 }, to: { row: headerRows + visibleRows.length, column: endColumn } } : undefined;
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

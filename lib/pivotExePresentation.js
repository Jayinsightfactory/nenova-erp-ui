// Shared, read-only presentation layout for the EXE pivot grid and its WYSIWYG workbook.
// It intentionally works only from buildPivotModel's visible axes: it never filters,
// re-aggregates, rounds, or otherwise changes the original numeric values.
import { EXE_FIELDS, pivotAxisKey } from './pivotExeModel.js';
import { sha256 } from '@noble/hashes/sha2';

const FIELD_BY_ID = new Map(EXE_FIELDS.map((field) => [field.id, field]));

export const PIVOT_EXE_DEFAULT_WIDTHS = Object.freeze({
  CounName: 90,
  FlowerName: 90,
  ProdName: 220,
  __data: 96,
});

export const PIVOT_EXE_DEFAULT_ROW_HEIGHT = 24;

const bounded = (value, fallback, minimum, maximum) => {
  if (value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

export function pivotExeFieldLabel(id) {
  return FIELD_BY_ID.get(id)?.label || String(id || '');
}

export function pivotExeValueLabel(value) {
  if (value === null) return '(null)';
  if (value === undefined) return '(undefined)';
  if (value === '') return '(빈값)';
  return String(value);
}

/** Keeps persisted CSS-pixel widths usable by both the browser table and workbook. */
export function getPivotExeColumnWidth(id, widths = {}) {
  const configured = widths && Object.prototype.hasOwnProperty.call(widths, id) ? widths[id] : undefined;
  if (configured !== undefined) return bounded(configured, 96, 48, 640);
  if (Object.prototype.hasOwnProperty.call(PIVOT_EXE_DEFAULT_WIDTHS, id)) return PIVOT_EXE_DEFAULT_WIDTHS[id];
  return bounded(widths?.__data, PIVOT_EXE_DEFAULT_WIDTHS.__data, 48, 640);
}

export function getPivotExeDataColumnId(column, measure) {
  // Stable width identity without embedding customer/AWB/year values in persisted preferences.
  const digest = Array.from(sha256(String(column?.key ?? '')), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `col-${digest}-${measure?.key}`;
}

export function getPivotExeDataWidth(column, measure, widths = {}) {
  return getPivotExeColumnWidth(getPivotExeDataColumnId(column, measure), widths);
}

export function getPivotExeRowHeight(rowHeight) {
  return bounded(rowHeight, PIVOT_EXE_DEFAULT_ROW_HEIGHT, 18, 48);
}

/** Group controls stay available when subtotal rows/columns are hidden. */
export function getPivotExeGroupKeys(model, kind) {
  const fields = model?.layout?.[kind] || [];
  const axes = kind === 'row' ? model?.rowAxis : model?.columnAxis;
  const keys = new Set();
  for (const axis of axes || []) {
    if (axis.isGrandTotal) continue;
    for (let length = 1; length <= axis.path.length && length < fields.length; length += 1) {
      keys.add(pivotAxisKey(kind, axis.path.slice(0, length)));
    }
  }
  return keys;
}

export function pivotExeExcelColumnWidth(cssPixels) {
  // Excel stores column widths in character units; 7px is its practical default glyph width.
  return Math.max(7, Math.round((getPivotExeColumnWidth('__data', { __data: cssPixels }) / 7) * 100) / 100);
}

export function pivotExeExcelRowHeight(cssPixels) {
  // CSS pixels are converted to points for Excel's row-height unit.
  return Math.round(getPivotExeRowHeight(cssPixels) * 0.75 * 100) / 100;
}

export function formatPivotExeNumber(value, decimals = 2, zeroVisible = false) {
  if (value === null || value === undefined || (value === 0 && !zeroVisible)) return '';
  const fractionDigits = bounded(decimals, 2, 0, 6);
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString('ko-KR', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })
    : String(value);
}

function columnPathLabel(axis, fieldIds, level) {
  if (axis?.isGrandTotal) return { label: level === 0 ? '총계' : '', title: '총계' };
  const value = axis?.path?.[level];
  if (value === undefined) return { label: '', title: '' };
  const suffix = axis.isTotal && level === axis.path.length - 1 ? ' 합계' : '';
  const label = `${pivotExeValueLabel(value)}${suffix}`;
  return { label, title: `${pivotExeFieldLabel(fieldIds[level])}: ${label}` };
}

function samePrefix(left, right, level) {
  if (Boolean(left?.isGrandTotal) !== Boolean(right?.isGrandTotal)) return false;
  if (left?.isGrandTotal) return true;
  for (let index = 0; index <= level; index += 1) {
    if (left?.path?.[index] !== right?.path?.[index]) return false;
  }
  // A subtotal is distinct only at the level it terminates.  At a parent level its
  // same-path children and that parent's total remain one visual group.
  const leftTerminatesHere = Boolean(left?.isTotal && left?.path?.length - 1 === level);
  const rightTerminatesHere = Boolean(right?.isTotal && right?.path?.length - 1 === level);
  return leftTerminatesHere === rightTerminatesHere;
}

function buildColumnHeaders(dataColumns, columnFields) {
  const rows = [];
  for (let level = 0; level < Math.max(1, columnFields.length); level += 1) {
    const cells = [];
    let index = 0;
    while (index < dataColumns.length) {
      const first = dataColumns[index];
      let end = index + 1;
      while (end < dataColumns.length && samePrefix(first.column, dataColumns[end].column, level)) end += 1;
      cells.push({
        ...columnPathLabel(first.column, columnFields, level),
        columnStart: index,
        columnSpan: end - index,
        column: first.column,
        axisKey: first.column?.isGrandTotal ? null : pivotAxisKey('column', first.column?.path?.slice(0, level + 1) || []),
        canToggle: !first.column?.isGrandTotal && (level < columnFields.length - 1 || Boolean(first.column?.collapsed)),
        level,
      });
      index = end;
    }
    rows.push(cells);
  }
  rows.push(dataColumns.map((item, columnStart) => ({
    label: pivotExeFieldLabel(item.measure.field),
    title: pivotExeFieldLabel(item.measure.field),
    columnStart,
    columnSpan: 1,
    column: item.column,
    measure: item.measure,
    axisKey: null,
    canToggle: false,
    level: rows.length,
  })));
  return rows;
}

function rowLabel(axis, fieldIndex) {
  if (axis?.isGrandTotal) return fieldIndex === 0 ? '총계' : '';
  const value = axis?.path?.[fieldIndex];
  if (value === undefined) return '';
  return `${pivotExeValueLabel(value)}${axis.isTotal && fieldIndex === axis.path.length - 1 ? ' 합계' : ''}`;
}

/**
 * Returns vertical row-header merges.  Subtotal/grand-total rows are hard boundaries, so a
 * country or flower label can never bleed into its following subtotal row.
 */
export function buildPivotExeRowHeaderCells(rowAxis = [], rowFields = []) {
  const cells = Array.from({ length: rowAxis.length }, () => Array(rowFields.length).fill(null));
  for (let fieldIndex = 0; fieldIndex < rowFields.length; fieldIndex += 1) {
    let rowIndex = 0;
    while (rowIndex < rowAxis.length) {
      const axis = rowAxis[rowIndex];
      const label = rowLabel(axis, fieldIndex);
      const mergeable = Boolean(label) && !axis?.isTotal && !axis?.isGrandTotal;
      let end = rowIndex + 1;
      if (mergeable) {
        while (end < rowAxis.length) {
          const candidate = rowAxis[end];
          if (candidate?.isTotal || candidate?.isGrandTotal || rowLabel(candidate, fieldIndex) !== label) break;
          let sameAncestors = true;
          for (let prefix = 0; prefix < fieldIndex; prefix += 1) {
            if (axis?.path?.[prefix] !== candidate?.path?.[prefix]) sameAncestors = false;
          }
          if (!sameAncestors) break;
          end += 1;
        }
      }
      cells[rowIndex][fieldIndex] = { label, rowSpan: mergeable ? end - rowIndex : 1, axis, fieldIndex };
      for (let covered = rowIndex + 1; covered < end; covered += 1) cells[covered][fieldIndex] = { hidden: true };
      rowIndex = end;
    }
  }
  return cells;
}

/** Builds the exact shared visible structure for the browser grid and XLSX exporter. */
export function buildPivotExePresentation(model, { widths = {}, rowHeight } = {}) {
  const rowFields = model?.layout?.row || [];
  const columnFields = model?.layout?.column || [];
  const measures = model?.measures || [];
  const dataColumns = (model?.columnAxis || []).flatMap((column) => measures.map((measure) => ({
    id: getPivotExeDataColumnId(column, measure), column, measure,
    width: getPivotExeDataWidth(column, measure, widths),
  })));
  return {
    rowFields,
    columnFields,
    measures,
    rowHeight: getPivotExeRowHeight(rowHeight),
    rowWidths: rowFields.map((id) => ({ id, width: getPivotExeColumnWidth(id, widths), label: pivotExeFieldLabel(id) })),
    dataColumns,
    headerRows: buildColumnHeaders(dataColumns, columnFields),
    rowHeaderCells: buildPivotExeRowHeaderCells(model?.rowAxis || [], rowFields),
  };
}

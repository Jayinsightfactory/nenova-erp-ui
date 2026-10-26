import { dutchDataStart, dutchCustomerHeader } from './dutchMatrixLayout.js';
export function parseDutchSheetQuantity(value) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const quantity = Number(text);
  if (!Number.isFinite(quantity)) return { ok: false, reason: 'not-finite' };
  if (quantity < 0) return { ok: false, reason: 'negative' };
  return { ok: true, quantity };
}

export const DUTCH_QUANTITY_HISTORY_LIMIT = 100;

export function normalizeDutchQuantityHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-DUTCH_QUANTITY_HISTORY_LIMIT).flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const from = item.from == null ? null : Number(item.from);
    const to = Number(item.to);
    const changedAt = String(item.changedAt || '');
    if ((from !== null && (!Number.isFinite(from) || from < 0 || from > 1e9)) || !Number.isFinite(to) || to < 0 || to > 1e9 || changedAt.length > 40 || !changedAt || !Number.isFinite(Date.parse(changedAt))) return [];
    return [{ from, to, changedAt }];
  });
}

export function appendDutchQuantityHistory(history, from, to, changedAt = new Date().toISOString()) {
  const previous = normalizeDutchQuantityHistory(history);
  const next = { from: from == null ? null : Number(from), to: Number(to), changedAt: String(changedAt) };
  return normalizeDutchQuantityHistory([...previous, next]);
}

const cellText = (sheet, XLSX, row, column) => String(sheet?.[XLSX.utils.encode_cell({ r: row, c: column })]?.v ?? '').trim();

/**
 * Derive order/customer totals and projected remaining from the edited draft.
 * Inbound and manual stock remain source values, never ERP write quantities.
 * The returned values are display/export overlays and do not mutate the source sheet.
 */
export function buildDutchQuantitySummaryValues(XLSX, sheet, sheetName, entries, matrixScope = {}) {
  const ref = matrixScope.range || (sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null);
  if (!ref || !sheet) return new Map();
  let orderStart = matrixScope.summaryStart;
  if (!Number.isInteger(orderStart)) {
    orderStart = ref.e.c + 1;
    for (let column = 1; column <= ref.e.c; column += 1) {
      if (cellText(sheet, XLSX, 2, column) === '주문') { orderStart = column; break; }
    }
  }
  const sheetEntries = (entries || []).filter(entry => !entry.added && entry.sheetName === sheetName
    && Number.isInteger(entry.sourceRow) && Number.isInteger(entry.sourceColumn)
    && entry.sourceRow >= 3 && entry.sourceColumn < orderStart
    && Number.isFinite(Number(entry.quantity)) && Number(entry.quantity) >= 0);
  if (orderStart > ref.e.c) return new Map();

  const customerStart = sheetEntries.some(entry => entry.layoutVersion === 3) || /^(칼라|컬러|색상)$/.test(cellText(sheet, XLSX, 2, 2)) ? 3 : 2;
  const orderColumns = [];
  for (let column = orderStart; column <= ref.e.c; column += 1) {
    if (cellText(sheet, XLSX, 2, column) === '주문') orderColumns.push(column);
  }
  const totalRows = [];
  for (let row = 3; row <= ref.e.r; row += 1) {
    if (Array.from({ length: customerStart }, (_, offset) => cellText(sheet, XLSX, row, offset)).includes('합계')) totalRows.push(row);
  }
  const totalRowSet = new Set(totalRows);
  const values = new Map();
  const valueKey = (row, column) => XLSX.utils.encode_cell({ r: row, c: column });
  const customerColumns = [];
  for (let column = customerStart; column < orderStart; column += 1) {
    if (!['', '품목', '품목명', '칼라'].includes(cellText(sheet, XLSX, 2, column))) customerColumns.push(column);
  }
  const overrides = new Map(sheetEntries.map(entry => [valueKey(entry.sourceRow, entry.sourceColumn), Number(entry.quantity)]));
  const numeric = (r, c) => {
    const key = valueKey(r, c), n = Number(overrides.has(key) ? overrides.get(key) : sheet[key]?.v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const columnsNamed = label => Array.from({ length: ref.e.c - orderStart + 1 }, (_, i) => orderStart + i).filter(c => cellText(sheet, XLSX, 2, c) === label);
  const incomingColumns = columnsNamed('입고'), stockColumns = columnsNamed('재고'), remainingColumns = columnsNamed('잔량');
  const productRows = [];
  for (let row = dutchDataStart(sheet); row <= ref.e.r; row += 1) {
    if (totalRowSet.has(row) || !cellText(sheet, XLSX, row, 0)) continue;
    productRows.push(row);
    const sum = customerColumns.reduce((total, c) => total + numeric(row, c), 0);
    for (const column of orderColumns) values.set(valueKey(row, column), sum);
    if (incomingColumns.length) {
      // Repeated summary columns are duplicates, not additional inbound stock.
      const remain = numeric(row, incomingColumns[0]) + (stockColumns.length ? numeric(row, stockColumns[0]) : 0) - sum;
      for (const column of remainingColumns) values.set(valueKey(row, column), Math.round(remain * 1e9) / 1e9);
    }
  }
  let previousTotalRow = dutchDataStart(sheet) - 1;
  for (const totalRow of totalRows) {
    const blockRows = productRows.filter(row => row > previousTotalRow && row < totalRow);
    for (const column of customerColumns) {
      values.set(valueKey(totalRow, column), blockRows.reduce((total, row) => total + numeric(row, column), 0));
    }
    for (const column of [...orderColumns, ...remainingColumns]) {
      if (blockRows.some(row => values.has(valueKey(row, column)))) values.set(valueKey(totalRow, column), blockRows.reduce((total, row) => total + (values.get(valueKey(row, column)) ?? 0), 0));
    }
    previousTotalRow = totalRow;
  }
  return values;
}

const cellValue = (sheet, XLSX, row, column) => String(sheet?.[XLSX.utils.encode_cell({ r: row, c: column })]?.v ?? '').trim();

export function createDutchBlankCellEntry(XLSX, sheet, sheetName, row, column, layoutVersion, matrixScope = {}) {
  const range = matrixScope.range || (sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null);
  if (!range || row < dutchDataStart(sheet) || column < (layoutVersion === 3 ? 3 : 2) || column > range.e.c) return null;

  let summaryStart = matrixScope.summaryStart;
  if (!Number.isInteger(summaryStart)) {
    summaryStart = range.e.c + 1;
    for (let col = 1; col <= range.e.c; col += 1) {
      if (cellValue(sheet, XLSX, 2, col) === '주문') { summaryStart = col; break; }
    }
  }
  if (column >= summaryStart) return null;

  const product = cellValue(sheet, XLSX, row, 0);
  const color = cellValue(sheet, XLSX, row, 1);
  const customer = dutchCustomerHeader(XLSX, sheet, column);
  if (!product || product === '합계' || color === '합계' || !customer || ['칼라','품목명','품목'].includes(customer)) return null;

  const cellAddress = XLSX.utils.encode_cell({ r: row, c: column });
  const cell = sheet[cellAddress];
  // Existing formulas or labels are never converted into editable quantity cells.
  if (cell?.f) return null;
  if (cell?.v !== undefined && cell?.v !== null && String(cell.v).trim() !== '') {
    const existingValue = Number(cell.v);
    if (!Number.isFinite(existingValue) || existingValue !== 0) return null;
  }

  const threeLabels = layoutVersion === 3;
  return {
    id: `${sheetName}!${cellAddress}`,
    added: false,
    sourceCellDraft: true,
    sheetName,
    cellAddress,
    product,
    color,
    sourceFlower: product,
    sourceItem: color,
    sourceColor: threeLabels ? cellValue(sheet, XLSX, row, 2) : '',
    customer,
    sourceCustomer: customer,
    sourceRow: row,
    sourceColumn: column,
    layoutVersion,
    quantity: 0,
    unit: '',
  };
}

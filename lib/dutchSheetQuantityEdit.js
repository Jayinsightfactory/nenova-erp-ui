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
 * Derive only order/customer quantity summaries from the edited matrix draft.
 * Inbound, stock, and other Pivot summaries are intentionally left untouched.
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
  if (!sheetEntries.length || orderStart > ref.e.c) return new Map();

  const customerStart = sheetEntries.some(entry => entry.layoutVersion === 3) ? 3 : 2;
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
  const rowsWithOrders = new Set(sheetEntries.map(entry => entry.sourceRow));
  for (let row = 3; row <= ref.e.r; row += 1) {
    if (totalRowSet.has(row)) continue;
    if (!rowsWithOrders.has(row) && !orderColumns.some(column => Number(sheet[valueKey(row, column)]?.v) > 0)) continue;
    const sum = sheetEntries.filter(entry => entry.sourceRow === row).reduce((total, entry) => total + Number(entry.quantity), 0);
    for (const column of orderColumns) if (!sheet[valueKey(row, column)]?.f) values.set(valueKey(row, column), sum);
  }

  const customerColumns = [];
  for (let column = customerStart; column < orderStart; column += 1) {
    if (cellText(sheet, XLSX, 2, column)) customerColumns.push(column);
  }
  let previousTotalRow = 2;
  for (const totalRow of totalRows) {
    const blockEntries = sheetEntries.filter(entry => entry.sourceRow > previousTotalRow && entry.sourceRow < totalRow);
    for (const column of customerColumns) {
      const existingTotal = sheet[valueKey(totalRow, column)]?.v;
      const columnEntries = blockEntries.filter(entry => entry.sourceColumn === column);
      if (!columnEntries.length && !(Number.isFinite(Number(existingTotal)) && Number(existingTotal) > 0)) continue;
      if (!sheet[valueKey(totalRow, column)]?.f) values.set(valueKey(totalRow, column), columnEntries.reduce((total, entry) => total + Number(entry.quantity), 0));
    }
    if (blockEntries.length || orderColumns.some(column => Number(sheet[valueKey(totalRow, column)]?.v) > 0)) {
      const sum = blockEntries.reduce((total, entry) => total + Number(entry.quantity), 0);
      for (const column of orderColumns) if (!sheet[valueKey(totalRow, column)]?.f) values.set(valueKey(totalRow, column), sum);
    }
    previousTotalRow = totalRow;
  }
  return values;
}

const cellValue = (sheet, XLSX, row, column) => String(sheet?.[XLSX.utils.encode_cell({ r: row, c: column })]?.v ?? '').trim();

export function createDutchBlankCellEntry(XLSX, sheet, sheetName, row, column, layoutVersion, matrixScope = {}) {
  const range = matrixScope.range || (sheet?.['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null);
  if (!range || row < 3 || column < (layoutVersion === 3 ? 3 : 2) || column > range.e.c) return null;

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
  const customer = cellValue(sheet, XLSX, 2, column);
  if (!product || product === '합계' || color === '합계' || !customer || customer === '칼라') return null;

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

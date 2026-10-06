export function parseDutchSheetQuantity(value) {
  const text = String(value ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  const quantity = Number(text);
  if (!Number.isFinite(quantity)) return { ok: false, reason: 'not-finite' };
  if (quantity < 0) return { ok: false, reason: 'negative' };
  return { ok: true, quantity };
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

// Deterministic, review-only reader for the legacy six-column China invoice.
// This module never converts source quantities into ERP Box/Bunch/Steam units.

export const CHINA_LEGACY_SOURCE_FORMAT = 'china_legacy_invoice_xlsx';
export const CHINA_LEGACY_REVIEW_STATUS = 'LEGACY_CN_REVIEW_REQUIRED';

const MAX_ROWS = 10000;
const MAX_COLUMNS = 64;
const MAX_CELLS = 250000;
const text = value => value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
const compact = value => text(value).toLowerCase().replace(/[\s_/().：:\-]+/g, '');
const close = (a, b) => Math.abs(a - b) <= 0.01;
const fail = message => { throw new Error('중국 인보이스를 확인해 주세요: ' + message); };

export function isLegacyChinaInvoiceSheetName(name) {
  return /^(?:invoice|invoice\s*日报表)$/i.test(text(name));
}

function checkedRange(XLSX, ws, sheetName) {
  if (!ws?.['!ref']) fail(`${sheetName}: missing worksheet range`);
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  if (rows > MAX_ROWS || columns > MAX_COLUMNS || rows * columns > MAX_CELLS) {
    fail(`${sheetName}: worksheet range too large`);
  }
  return range;
}

function isLegacySizedRange(XLSX, ws) {
  if (!ws?.['!ref']) return false;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  return rows <= MAX_ROWS && columns <= MAX_COLUMNS && rows * columns <= MAX_CELLS;
}

function rowsOf(XLSX, ws, sheetName) {
  checkedRange(XLSX, ws, sheetName);
  return XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null, raw: true, blankrows: true, range: 0,
  });
}

function isLegacyHeaderRow(row) {
  if (!Array.isArray(row)) return false;
  const cells = Array.from({ length: 6 }, (_, index) => compact(row[index]));
  return /^品名$/.test(cells[0])
    && (cells[1] === '英文名' || cells[1] === 'englishname')
    && cells[2].includes('数量') && cells[2].includes('qty')
    && cells[3].includes('单价') && cells[3].includes('price')
    && cells[4].includes('金额') && cells[4].includes('amount')
    && cells[5].includes('规格') && /(?:bupcs|pcsbu)/.test(cells[5]);
}

function headerRows(rows) {
  const hits = [];
  for (let index = 0; index < Math.min(rows.length, 50); index++) {
    if (isLegacyHeaderRow(rows[index])) hits.push(index);
  }
  return hits;
}

export function findLegacyChinaInvoiceCandidates(XLSX, workbook) {
  if (!XLSX?.utils || !workbook?.SheetNames || !workbook?.Sheets) fail('XLSX workbook is required');
  const candidates = [];
  for (const sheetName of workbook.SheetNames) {
    if (!isLegacyChinaInvoiceSheetName(sheetName)) continue;
    const ws = workbook.Sheets[sheetName];
    // Detection must not narrow the existing modern parser's accepted range.
    // Oversized sheets are simply not classified as this bounded legacy format.
    if (!isLegacySizedRange(XLSX, ws)) continue;
    const rows = rowsOf(XLSX, ws, sheetName);
    const headers = headerRows(rows);
    if (headers.length) candidates.push({ sheetName, headerRows: headers });
  }
  return candidates;
}

function safeValue(value, label) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value ?? null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  fail(`${label}: unsupported cell value`);
}

function cellEvidence(ws, address) {
  const cell = ws[address];
  if (!cell) return { address, value: null, formula: null, cached_value: null };
  const value = safeValue(cell.v, address);
  const formula = cell.f == null ? null : String(cell.f);
  return { address, value, formula, cached_value: formula ? value : null };
}

function rowEvidence(XLSX, ws, rowIndex, range) {
  const cells = [];
  for (let column = range.s.c; column <= range.e.c; column++) {
    cells.push(cellEvidence(ws, XLSX.utils.encode_cell({ r: rowIndex, c: column })));
  }
  return { source_row: rowIndex + 1, cells };
}

function meaningfulRow(row) {
  return row.some(value => value != null && text(value) !== '');
}

function nullableNumber(value, label, { signed = false } = {}) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value === 'boolean') fail(`invalid numeric ${label}`);
  const raw = text(value);
  if (typeof value !== 'number' && !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) {
    fail(`invalid numeric ${label}`);
  }
  const number = typeof value === 'number' ? value : Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(number) || (!signed && number < 0)) fail(`invalid numeric ${label}`);
  return number;
}

function numericCell(ws, address, label, options) {
  const evidence = cellEvidence(ws, address);
  if (evidence.formula && evidence.value == null) fail(`${label}: formula has no cached value`);
  return { value: nullableNumber(evidence.value, label, options), evidence };
}

function uniqueMatch(entries, label) {
  if (entries.length !== 1) fail(`missing or ambiguous ${label}`);
  return entries[0];
}

function dateMetadata(rows, headerIndex) {
  const matches = [];
  for (let row = 0; row < headerIndex; row++) {
    for (let column = 0; column < (rows[row]?.length || 0); column++) {
      const raw = text(rows[row][column]);
      const match = raw.match(/\bDATE\s*[:：]?\s*(\d{4})-(\d{1,2})-(\d{1,2})\b/i);
      if (match) matches.push({ raw, row, column, parts: match.slice(1).map(Number) });
    }
  }
  const found = uniqueMatch(matches, 'legacy invoice DATE');
  const [year, month, day] = found.parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail('invalid legacy invoice DATE');
  }
  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    raw: found.raw,
    row: found.row,
    column: found.column,
  };
}

function invoiceNumberMetadata(rows, headerIndex) {
  const matches = [];
  for (let row = 0; row < headerIndex; row++) {
    for (let column = 0; column < (rows[row]?.length || 0); column++) {
      const raw = text(rows[row][column]);
      const match = raw.match(/\bINVOICE\s*NO\.?\s*[:：]?\s*(.+)$/i);
      if (match?.[1]?.trim()) matches.push({ value: match[1].trim(), raw, row, column });
    }
  }
  return uniqueMatch(matches, 'legacy invoice number');
}

function supplierMetadata(rows, headerIndex, XLSX) {
  const recipientRows = [];
  for (let row = 0; row < headerIndex; row++) {
    if ((rows[row] || []).some(value => /^TO\s*[:：]/i.test(text(value)))) recipientRows.push(row);
  }
  const recipientRow = uniqueMatch(recipientRows, 'legacy invoice supplier boundary');
  const cells = [];
  for (let row = 0; row < recipientRow; row++) {
    for (let column = 0; column < (rows[row]?.length || 0); column++) {
      const value = text(rows[row][column]);
      if (!value || /(?:TEL|电话|FAX|传真)\s*[（(:：]/i.test(value)) continue;
      cells.push({ address: XLSX.utils.encode_cell({ r: row, c: column }), value });
    }
  }
  if (!cells.length) fail('missing legacy invoice supplier area');
  return { value: cells.map(cell => cell.value).join(' / '), cells };
}

function explicitCurrency(rows) {
  const currencies = new Set();
  for (const row of rows) for (const value of row || []) {
    const matches = text(value).toUpperCase().match(/\b(?:CNY|RMB|USD|EUR|KRW|JPY)\b/g) || [];
    for (const match of matches) currencies.add(match === 'RMB' ? 'CNY' : match);
  }
  if (currencies.size > 1) fail('ambiguous legacy invoice currency');
  return currencies.size === 1 ? [...currencies][0] : null;
}

function formulasOf(XLSX, ws, range) {
  const formulas = [];
  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let column = range.s.c; column <= range.e.c; column++) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      const evidence = cellEvidence(ws, address);
      if (evidence.formula) formulas.push(evidence);
    }
  }
  return formulas;
}

function parseProductRows(XLSX, ws, rows, sheetName, headerIndex, subtotalIndex) {
  const products = [];
  for (let rowIndex = headerIndex + 1; rowIndex < subtotalIndex; rowIndex++) {
    const row = rows[rowIndex] || [];
    if (!meaningfulRow(row)) continue;
    const nameZh = text(row[0]);
    const nameEn = text(row[1]);
    if (!nameZh && !nameEn) fail(`${sheetName}!row ${rowIndex + 1}: product names are missing`);
    const quantity = numericCell(ws, `C${rowIndex + 1}`, `row ${rowIndex + 1} raw quantity`);
    const unitPrice = numericCell(ws, `D${rowIndex + 1}`, `row ${rowIndex + 1} unit price`);
    const amount = numericCell(ws, `E${rowIndex + 1}`, `row ${rowIndex + 1} printed amount`);
    const unitSpec = row[5] == null || text(row[5]) === '' ? null : String(row[5]).trim();
    const complete = quantity.value !== null && unitPrice.value !== null && amount.value !== null;
    const calculated = quantity.value !== null && unitPrice.value !== null
      ? Math.round((quantity.value * unitPrice.value + Number.EPSILON) * 100) / 100 : null;
    if (complete && !close(calculated, amount.value)) fail(`row ${rowIndex + 1} quantity/amount mismatch`);
    products.push({
      description: nameEn || nameZh,
      source_description: nameEn || nameZh,
      source_format: CHINA_LEGACY_SOURCE_FORMAT,
      source_sheet: sheetName,
      source_row: rowIndex + 1,
      name_zh: nameZh || null,
      name_en: nameEn || null,
      raw_qty: quantity.value,
      source_unit_spec: unitSpec,
      unitPrice: unitPrice.value,
      t_price: amount.value,
      printed_amount: amount.value,
      independently_calculated_amount: calculated,
      amount_matches: complete ? true : null,
      unit_review_required: true,
      reviewed: false,
      pcs: null,
      total_bunch: null,
      total_stems: null,
      box_quantity: null,
      bunch_quantity: null,
      stem_quantity: null,
      source_cells: {
        name_zh: cellEvidence(ws, `A${rowIndex + 1}`),
        name_en: cellEvidence(ws, `B${rowIndex + 1}`),
        raw_qty: quantity.evidence,
        unitPrice: unitPrice.evidence,
        t_price: amount.evidence,
        source_unit_spec: cellEvidence(ws, `F${rowIndex + 1}`),
      },
    });
  }
  if (!products.length) fail('missing legacy invoice products');
  return products;
}

function parseFeeRows(ws, rows, sheetName, subtotalIndex, grandIndex) {
  const fees = [];
  for (let rowIndex = subtotalIndex + 1; rowIndex < grandIndex; rowIndex++) {
    const row = rows[rowIndex] || [];
    if (!meaningfulRow(row)) continue;
    const labelZh = text(row[0]);
    const labelEn = text(row[1]);
    if (!labelZh && !labelEn) fail(`${sheetName}!row ${rowIndex + 1}: fee label is missing`);
    const quantity = numericCell(ws, `C${rowIndex + 1}`, `fee row ${rowIndex + 1} quantity`);
    const unitPrice = numericCell(ws, `D${rowIndex + 1}`, `fee row ${rowIndex + 1} unit price`, { signed: true });
    const amount = numericCell(ws, `E${rowIndex + 1}`, `fee row ${rowIndex + 1} amount`, { signed: true });
    const complete = quantity.value !== null && unitPrice.value !== null && amount.value !== null;
    const calculated = quantity.value !== null && unitPrice.value !== null
      ? Math.round((quantity.value * unitPrice.value + Number.EPSILON) * 100) / 100 : null;
    if (complete && !close(calculated, amount.value)) fail(`fee row ${rowIndex + 1} quantity/amount mismatch`);
    fees.push({
      description: labelEn || labelZh,
      raw_label: [labelZh, labelEn].filter(Boolean).join(' / '),
      label_zh: labelZh || null,
      label_en: labelEn || null,
      raw_qty: quantity.value,
      unitPrice: unitPrice.value,
      amount: amount.value,
      independently_calculated_amount: calculated,
      amount_matches: complete ? true : null,
      source_row: rowIndex + 1,
      source_cells: {
        label_zh: cellEvidence(ws, `A${rowIndex + 1}`),
        label_en: cellEvidence(ws, `B${rowIndex + 1}`),
        raw_qty: quantity.evidence,
        unitPrice: unitPrice.evidence,
        amount: amount.evidence,
        note: cellEvidence(ws, `F${rowIndex + 1}`),
      },
    });
  }
  return fees;
}

function completeSum(rows, fields, valueFactory) {
  if (rows.some(row => fields.some(field => row[field] === null))) return null;
  return rows.reduce((total, row) => total + valueFactory(row), 0);
}

function comparisonSheet(XLSX, workbook, sheetName) {
  const ws = workbook.Sheets[sheetName];
  const range = checkedRange(XLSX, ws, sheetName);
  const rows = rowsOf(XLSX, ws, sheetName);
  const formulas = formulasOf(XLSX, ws, range);
  const aggregate = formulas.filter(cell => /\bSUM(?:PRODUCT)?\s*\(/i.test(cell.formula));
  return {
    sheet_name: sheetName,
    range: ws['!ref'],
    rows: rows.map((_, rowIndex) => rowEvidence(XLSX, ws, rowIndex, range)),
    formula_cells: formulas,
    cached_totals: aggregate,
    aggregate_cached_values: aggregate.map(cell => cell.cached_value),
    authority: 'COMPARISON_ONLY',
    revision: null,
  };
}

function comparisonStatus(sheets) {
  if (sheets.length < 2) return 'COMPARISON_ONLY';
  const signatures = sheets.map(sheet => JSON.stringify(
    sheet.aggregate_cached_values.filter(value => value !== null).sort((a, b) => Number(a) - Number(b)),
  ));
  return new Set(signatures).size > 1 ? 'CL_CONFLICT_REVIEW_REQUIRED' : 'COMPARISON_ONLY';
}

/** Returns a parsePackingResponse-compatible content envelope. The input workbook is not mutated. */
export function parseChinaLegacyInvoiceWorkbook(XLSX, workbook) {
  const candidates = findLegacyChinaInvoiceCandidates(XLSX, workbook);
  if (candidates.length !== 1) fail('exactly one legacy six-column Invoice worksheet is required');
  const namedSheets = workbook.SheetNames.filter(isLegacyChinaInvoiceSheetName);
  if (namedSheets.length !== 1 || candidates[0].headerRows.length !== 1) {
    fail('ambiguous legacy Invoice worksheets or headers');
  }

  const { sheetName } = candidates[0];
  const headerIndex = candidates[0].headerRows[0];
  const ws = workbook.Sheets[sheetName];
  const range = checkedRange(XLSX, ws, sheetName);
  const rows = rowsOf(XLSX, ws, sheetName);
  const subtotalRows = rows.map((row, index) => ({ row, index }))
    .filter(({ row, index }) => index > headerIndex && row.some(value => /Total\s*Flower\s*amounts/i.test(text(value))));
  const subtotalIndex = uniqueMatch(subtotalRows, 'legacy flower subtotal').index;
  const grandRows = rows.map((row, index) => ({ row, index }))
    .filter(({ row, index }) => index > subtotalIndex && row.some(value => /总计\s*Total\s*amounts/i.test(text(value))));
  const grandIndex = uniqueMatch(grandRows, 'legacy invoice grand total').index;

  const date = dateMetadata(rows, headerIndex);
  const invoiceNumber = invoiceNumberMetadata(rows, headerIndex);
  const supplier = supplierMetadata(rows, headerIndex, XLSX);
  const currency = explicitCurrency(rows);
  const products = parseProductRows(XLSX, ws, rows, sheetName, headerIndex, subtotalIndex);
  const fees = parseFeeRows(ws, rows, sheetName, subtotalIndex, grandIndex);

  const printedProductQty = numericCell(ws, `C${subtotalIndex + 1}`, 'flower subtotal quantity');
  const printedProductAmount = numericCell(ws, `E${subtotalIndex + 1}`, 'flower subtotal amount');
  const printedGrandTotal = numericCell(ws, `E${grandIndex + 1}`, 'invoice grand total', { signed: true });
  const productQtySum = completeSum(products, ['raw_qty'], row => row.raw_qty);
  const productAmountSum = completeSum(products, ['raw_qty', 'unitPrice'], row => row.raw_qty * row.unitPrice);
  const feeAmountSum = fees.length ? completeSum(fees, ['raw_qty', 'unitPrice'], row => row.raw_qty * row.unitPrice) : 0;
  if (productQtySum !== null && printedProductQty.value !== null && !close(productQtySum, printedProductQty.value)) {
    fail('legacy product quantity subtotal mismatch');
  }
  if (productAmountSum !== null && printedProductAmount.value !== null && !close(productAmountSum, printedProductAmount.value)) {
    fail('legacy product amount subtotal mismatch');
  }
  const independentGrandTotal = productAmountSum !== null && feeAmountSum !== null
    ? productAmountSum + feeAmountSum : null;
  if (independentGrandTotal !== null && printedGrandTotal.value !== null
    && !close(independentGrandTotal, printedGrandTotal.value)) {
    fail('legacy invoice grand total mismatch');
  }

  const packingComparisons = workbook.SheetNames
    .filter(name => /packing/i.test(name) && name !== sheetName)
    .map(name => comparisonSheet(XLSX, workbook, name));
  const clStatus = comparisonStatus(packingComparisons);
  const arithmeticVerified = products.every(row => row.amount_matches === true)
    && fees.every(row => row.amount_matches === true)
    && productQtySum !== null && productAmountSum !== null && feeAmountSum !== null
    && printedProductQty.value !== null && printedProductAmount.value !== null && printedGrandTotal.value !== null
    && close(productQtySum, printedProductQty.value)
    && close(productAmountSum, printedProductAmount.value)
    && close(independentGrandTotal, printedGrandTotal.value);
  const reviewStates = [CHINA_LEGACY_REVIEW_STATUS, 'UNIT_REVIEW_REQUIRED'];
  if (currency === null) reviewStates.push('CURRENCY_REVIEW_REQUIRED');
  if (!arithmeticVerified) reviewStates.push('AMOUNT_REVIEW_REQUIRED');
  if (clStatus === 'CL_CONFLICT_REVIEW_REQUIRED') reviewStates.push(clStatus);

  const physicalText = rows.slice(grandIndex + 1, grandIndex + 11).flat()
    .map(text).find(value => /Grand\s*Total/i.test(value)) || null;
  const invoice = {
    invoice: invoiceNumber.value,
    date: date.date,
    raw_date: date.date,
    date_raw: date.raw,
    date_kind: 'invoice',
    date_order: 'YMD',
    date_evidence: { raw: date.raw, normalized: date.date,
      address: XLSX.utils.encode_cell({ r: date.row, c: date.column }) },
    supplier: supplier.value,
    supplier_evidence: supplier.cells,
    awb: '',
    currency,
    source_format: CHINA_LEGACY_SOURCE_FORMAT,
    source_sheet: sheetName,
    review_required: true,
    review_status: CHINA_LEGACY_REVIEW_STATUS,
    review_states: reviewStates,
    unit_review_required: true,
    arithmetic_verified: arithmeticVerified,
    products,
    additional_costs: fees,
    freight: feeAmountSum,
    item_subtotal: productAmountSum,
    invoice_total: printedGrandTotal.value,
    total_value: printedGrandTotal.value,
    total_boxes: null,
    total_bunches: null,
    total_stems: null,
    independent_totals: {
      products: {
        raw_qty_sum: productQtySum,
        calculated_amount_sum: productAmountSum,
        printed_raw_qty: printedProductQty.value,
        printed_amount: printedProductAmount.value,
        quantity_matches: productQtySum !== null && printedProductQty.value !== null
          ? close(productQtySum, printedProductQty.value) : null,
        amount_matches: productAmountSum !== null && printedProductAmount.value !== null
          ? close(productAmountSum, printedProductAmount.value) : null,
        source_cells: { raw_qty: printedProductQty.evidence, amount: printedProductAmount.evidence },
      },
      fees: { calculated_amount_sum: feeAmountSum },
      grand: {
        calculated_amount: independentGrandTotal,
        printed_amount: printedGrandTotal.value,
        amount_matches: independentGrandTotal !== null && printedGrandTotal.value !== null
          ? close(independentGrandTotal, printedGrandTotal.value) : null,
        source_cell: printedGrandTotal.evidence,
      },
    },
    printed_physical_text_reference_only: physicalText,
    packing_comparison_status: clStatus,
    packing_comparisons: packingComparisons,
    formula_cells: formulasOf(XLSX, ws, range),
    original_rows: rows.map((_, rowIndex) => rowEvidence(XLSX, ws, rowIndex, range)),
  };
  return { content: [{ type: 'text', text: JSON.stringify({ invoices: [invoice] }) }] };
}

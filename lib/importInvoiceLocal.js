import { positionedRows, parsePrintedDate } from './importAwbFields.js';

// Intentionally allowlisted: Holex's EUR invoice with positioned eight-column
// products, order subtotals, CBS units and numbered pages. Unknown layouts fail.
const euro = s => /^(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : NaN;
const integer = s => /^(?:\d{1,3}(?:[.,]\d{3})+|\d+)$/.test(s) ? Number(s.replace(/[.,]/g, '')) : NaN;
const cents = n => Math.round(n * 100);
const join = items => items.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();

/** Diagnostic variant: { result: invoices JSON | null, reason: string | null }. */
export function inspectInvoiceLocal(input, { country = 'NL' } = {}) {
  const fail = reason => ({ result: null, reason });
  if (country !== 'NL') return fail('UNSUPPORTED_COUNTRY');
  if (!input || typeof input !== 'object') return fail('INVALID_INPUT');
  const pages = Array.isArray(input.pages) && input.pages.length ? input.pages : [input];
  if (pages.some(p => !p || typeof p !== 'object')) return fail('INVALID_PAGE_INPUT');
  const allRows = pages.map(p => positionedRows(p.items));
  if (allRows.some(rows => !rows.length)) return fail('SCANNED_OR_POSITIONED_ITEMS_MISSING');
  const pageText = allRows.map(rows => rows.map(r => r.text).join('\n'));
  if (pageText.some(t => !/HOLEX FLOWER B\.V\./i.test(t))) return fail('UNKNOWN_LAYOUT');
  let invoiceId = null;
  for (let i = 0; i < pages.length; i++) {
    const footers = [...pageText[i].matchAll(/\b(\d+)\s*-\s*[^\n]*?\bPage\s+(\d+)\s+of\s+(\d+)\b/gi)];
    if (footers.length !== 1) return fail('PAGE_NUMBER_MISSING_OR_AMBIGUOUS');
    const m = footers[0];
    if (Number(m[2]) !== i + 1 || Number(m[3]) !== pages.length) return fail('MISSING_DUPLICATE_OR_REORDERED_PAGE');
    if (invoiceId && invoiceId !== m[1]) return fail('MULTIPLE_INVOICES_UNSUPPORTED');
    invoiceId = m[1];
  }
  const rows = allRows.flat();
  const meta = label => {
    const found = rows.filter(r => r.items.some(i => i.str === label));
    if (found.length !== 1) return null;
    const item = found[0].items.find(i => i.str === label);
    return join(found[0].items.filter(i => i.x > item.x + item.width + 2));
  };
  if (meta('Invoicenumber') !== invoiceId || meta('Currency') !== 'EUR') return fail('HEADER_MISSING_OR_CONFLICTING');
  const invoiceDate = parsePrintedDate(meta('Date'));
  if (!invoiceDate) return fail('INVALID_INVOICE_DATE');
  const arrivalRows = allRows[0].filter(r => r.items.some(i => i.str === 'Arrivaldate') && r.items.some(i => i.str === 'Airwaybillnumber'));
  if (arrivalRows.length !== 1) return fail('SHIPMENT_HEADER_MISSING');
  const shipmentHeader = arrivalRows[0];
  const shipmentValue = allRows[0].find(r => r.y < shipmentHeader.y && shipmentHeader.y - r.y <= 20);
  if (!shipmentValue) return fail('SHIPMENT_VALUES_MISSING');
  const arrivalX = shipmentHeader.items.find(i => i.str === 'Arrivaldate').x;
  const awbX = shipmentHeader.items.find(i => i.str === 'Airwaybillnumber').x;
  const rawDate = join(shipmentValue.items.filter(i => i.x >= arrivalX - 2));
  const date = parsePrintedDate(rawDate);
  const awb = join(shipmentValue.items.filter(i => i.x >= awbX - 2 && i.x < arrivalX - 2));
  if (!date || !/^\d{3}-\d{4}-?\d{4}$/.test(awb)) return fail('INVALID_ARRIVAL_DATE_OR_AWB');

  let columns = null, current = null, lastLine = null;
  let productCents = 0, totalStems = 0, freightCents = 0, handlingCents = 0;
  let grand = null, cbsUnits = null, inCbs = false, cbsColumns = null;
  let freightSeen = false, handlingSeen = false;
  const orders = new Set(), lines = [];
  const labels = ['Boxes', 'Packing', 'Box', 'Amount', 'Org', 'Item', 'Price', 'Total'];
  for (let p = 0; p < allRows.length; p++) {
    for (const row of allRows[p]) {
      if (/\bPage\s+\d+\s+of\s+\d+\b/.test(row.text)) continue;
      const order = row.text.match(/^Order\s+(\d+)\s*-\s*(CL\s*[A-Z0-9]+)$/);
      if (order) {
        if (current || orders.has(order[1]) || grand !== null) return fail('ORDER_NOT_CLOSED_OR_DUPLICATE');
        current = { id: order[1], cl: order[2].replace(/\s/g, ''), amount: 0, count: 0 };
        orders.add(current.id); lastLine = null; continue;
      }
      if (labels.every(label => row.items.some(i => i.str === label))) {
        if (labels.some(label => row.items.filter(i => i.str === label).length !== 1)) return fail('AMBIGUOUS_COLUMN_LAYOUT');
        const next = Object.fromEntries(labels.map(l => [l, row.items.find(i => i.str === l).x]));
        if (!labels.every((l, i) => i === 0 || next[l] > next[labels[i - 1]])) return fail('UNKNOWN_COLUMN_LAYOUT');
        if (columns && labels.some(l => Math.abs(next[l] - columns[l]) > 2)) return fail('INCONSISTENT_COLUMNS');
        columns = next; lastLine = null; continue;
      }
      const subtotal = row.text.match(/^Subtotal Order\s+(\d+)\s+(.+)$/);
      if (subtotal) {
        const amount = euro(subtotal[2]);
        if (!current || current.id !== subtotal[1] || !current.count || !Number.isFinite(amount) || current.amount !== cents(amount)) return fail('ORDER_SUBTOTAL_MISMATCH');
        current = null; lastLine = null; continue;
      }
      if (/^Total \(EUR\)\b/.test(row.text) || row.items.some(i => i.str === 'Total (EUR)')) {
        if (grand !== null || current) return fail('GRAND_TOTAL_DUPLICATE_OR_ORDER_OPEN');
        const n = euro(join(row.items.filter(i => i.str !== 'Total (EUR)')));
        if (!Number.isFinite(n)) return fail('INVALID_GRAND_TOTAL');
        grand = cents(n); lastLine = null; continue;
      }
      if (row.text === 'CBS') { inCbs = true; lastLine = null; continue; }
      if (row.text === 'Weight & Colli') { inCbs = false; continue; }
      if (inCbs) {
        if (['Name', 'Number', 'Countrycode', 'Units', 'Total', 'Weight'].every(l => row.items.some(i => i.str === l))) {
          if (['Name', 'Number', 'Countrycode', 'Units', 'Total', 'Weight'].some(l => row.items.filter(i => i.str === l).length !== 1)) return fail('CBS_TOTAL_AMBIGUOUS');
          cbsColumns = Object.fromEntries(row.items.map(i => [i.str, i]));
        } else if (/^Total\s/.test(row.text)) {
          if (!cbsColumns || cbsUnits !== null) return fail('CBS_TOTAL_AMBIGUOUS');
          // CBS totals are right-aligned: their left edge can sit left of the
          // Units heading. Assign by item center and neighboring column centers.
          const center = label => cbsColumns[label].x + cbsColumns[label].width / 2;
          const left = (center('Countrycode') + center('Units')) / 2;
          const right = (center('Units') + center('Total')) / 2;
          const values = row.items.filter(i => i.x + i.width / 2 >= left && i.x + i.width / 2 < right);
          if (values.length !== 1) return fail('CBS_UNITS_MISSING');
          cbsUnits = integer(values[0].str);
        }
        continue;
      }
      if (!columns) continue;
      const descriptionItems = row.items.filter(i => i.x >= columns.Item - 2 && i.x < columns.Price - 20);
      const amountItems = row.items.filter(i => i.x >= columns.Amount - 2 && i.x < columns.Org - 40);
      const priceItems = row.items.filter(i => i.x >= columns.Price - 20 && i.x < columns.Total - 24);
      const totalItems = row.items.filter(i => i.x >= columns.Total - 24);
      const description = join(descriptionItems);
      const hasStems = row.items.some(i => /^\([\d.,]+ st\)$/.test(i.str));
      const productHint = hasStems || row.items.some(i => /^\d+\.\d+\.\d+-\d+$/.test(i.str));
      if (productHint) {
        if (!current || grand !== null || amountItems.length !== 1 || priceItems.length !== 1 || totalItems.length !== 1 || !description) return fail('MALFORMED_PRODUCT_ROW');
        const stems = integer(amountItems[0].str), price = euro(priceItems[0].str), amount = euro(totalItems[0].str);
        const stemChecks = row.items.filter(i => /^\([\d.,]+ st\)$/.test(i.str));
        if (stemChecks.length !== 1 || integer(stemChecks[0].str.slice(1, -4)) !== stems || !Number.isSafeInteger(stems) || stems <= 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(amount) || stems * cents(price) !== cents(amount)) return fail('LINE_AMOUNT_OR_STEMS_MISMATCH');
        const line = { cl: current.cl, description, stems, price };
        lines.push(line); lastLine = { line, y: row.y, page: p };
        current.count++; current.amount += cents(amount); productCents += cents(amount); totalStems += stems;
        continue;
      }
      if (/^(Vracht\b|Handling$)/i.test(description)) {
        if (current || grand !== null || amountItems.length !== 1 || amountItems[0].str !== '1' || priceItems.length !== 1 || totalItems.length !== 1) return fail('MALFORMED_CHARGE');
        const price = euro(priceItems[0].str), amount = euro(totalItems[0].str);
        if (!Number.isFinite(amount) || !Number.isFinite(price) || cents(price) !== cents(amount)) return fail('CHARGE_AMOUNT_MISMATCH');
        if (/^Vracht\b/i.test(description)) {
          if (freightSeen) return fail('DUPLICATE_FREIGHT'); freightSeen = true; freightCents = cents(amount);
        } else {
          if (handlingSeen) return fail('DUPLICATE_HANDLING'); handlingSeen = true; handlingCents = cents(amount);
        }
        lastLine = null; continue;
      }
      // Only a nearby description-column continuation may extend a product.
      if (current && descriptionItems.length && row.items.length === descriptionItems.length) {
        if (!lastLine || lastLine.page !== p || lastLine.y - row.y > 12 || lastLine.y <= row.y) return fail('AMBIGUOUS_DESCRIPTION_CONTINUATION');
        lastLine.line.description += ' ' + description; lastLine.y = row.y; continue;
      }
      // Never ignore an unidentified monetary line in the product/charge region.
      if (grand === null && (current || orders.size) && (priceItems.some(i => Number.isFinite(euro(i.str))) || totalItems.some(i => Number.isFinite(euro(i.str))))) return fail('UNKNOWN_MONETARY_ROW');
    }
  }
  if (!lines.length || current || !columns) return fail('NO_COMPLETE_PRODUCT_TABLE');
  if (grand === null || !Number.isSafeInteger(cbsUnits) || cbsUnits !== totalStems) return fail('MISSING_OR_MISMATCHED_INDEPENDENT_TOTALS');
  if (productCents + freightCents + handlingCents !== grand) return fail('GRAND_TOTAL_MISMATCH');
  const weight = label => {
    const s = meta(label);
    return s && /^(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2} kg$/.test(s) ? Number(s.slice(0, -3).replace(/,/g, '')) : NaN;
  };
  const volWeight = weight('Volume Weight'), grossWeight = weight('Gross Weight'), colli = integer(meta('Total colli') || '');
  if (![volWeight, grossWeight, colli].every(n => Number.isFinite(n) && n > 0)) return fail('WEIGHT_OR_COLLI_MISSING');
  return { result: { invoices: [{ invoice: invoiceId, supplier: 'Holex', awb, date,
    raw_date: rawDate, date_kind: 'arrival', date_order: /^\d{4}[/-]/.test(rawDate) ? 'YMD' : 'DMY', currency: 'EUR',
    vol_weight: volWeight, gross_weight: grossWeight, total_colli: colli,
    freight: freightCents / 100, handling: handlingCents / 100, total_value: grand / 100, lines }] }, reason: null };
}

/** Same invoices schema as importPackingPrompt; never returns partial success. */
export function parseInvoiceLocal(input, options = {}) {
  const { result, reason } = inspectInvoiceLocal(input, options);
  if (!result && typeof options.onReject === 'function') options.onReject(reason);
  return result;
}

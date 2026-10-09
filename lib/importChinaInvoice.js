import {
  findLegacyChinaInvoiceCandidates,
  isLegacyChinaInvoiceSheetName,
  parseChinaLegacyInvoiceWorkbook,
} from './importChinaLegacyInvoice.js';

// Deterministic, browser-safe reader. No image extraction, AI, network or writes.
export const CHINA_INVOICE_MAX_BYTES = 50 * 1024 * 1024;

const text = value => value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
const header = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const close = (a, b) => Math.abs(a - b) <= 0.01;
const sum = (rows, key) => rows.reduce((n, row) => n + row[key], 0);
const fail = message => { throw new Error('중국 인보이스를 확인해 주세요: ' + message); };

function number(value, label, { signed = false, integer = false } = {}) {
  const s = text(value);
  if (typeof value !== 'number' && !/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s)) {
    fail('invalid numeric ' + label);
  }
  const n = typeof value === 'number' ? value : Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n) || (!signed && n < 0) || (integer && !Number.isSafeInteger(n))) {
    fail('invalid numeric ' + label);
  }
  return n;
}

const PRODUCT_HEADERS = {
  name: 'englishitemname', length: 'stemlength', specification: 'specification',
  boxes: 'order', bunches: 'totalofflowermaterial', price: 'unitpricecnybhpcs',
  stems: 'stems', amount: 'amountcny',
};
function columns(row, definitions) {
  const out = {};
  for (const [field, label] of Object.entries(definitions)) {
    const hits = row.map((v, i) => header(v).startsWith(label) ? i : -1).filter(i => i >= 0);
    if (hits.length !== 1) return null;
    out[field] = hits[0];
  }
  return out;
}

// Do not turn 60-65cm (or two grades separated by /) into a guessed 60cm.
export function chinaStemLength(value) {
  const raw = text(value).toUpperCase().replace(/[–—~～]/g, '-');
  const grades = [...new Set(raw.split('/').map(part => part.trim()))];
  const ranges = grades.map(part => part.match(/^(\d{2,3})(?:\s*CM)?\s*-\s*(\d{2,3})\s*(?:CM)?$/));
  if (ranges.length === 1 && ranges[0] && Number(ranges[0][1]) <= Number(ranges[0][2])) {
    const min = Number(ranges[0][1]), max = Number(ranges[0][2]);
    return { raw: text(value), key: min === max ? `${min}CM` : `${min}-${max}CM`,
      exact: min === max ? min : null, uncertain: min !== max };
  }
  const exact = grades.length === 1 && grades[0].match(/^(\d{2,3})\s*(?:CM)?$/);
  if (exact) return { raw: text(value), key: `${Number(exact[1])}CM`, exact: Number(exact[1]), uncertain: false };
  return { raw: text(value), key: raw || 'UNKNOWN', exact: null, uncertain: true };
}

// The UI persists aliasKey(description), so the visible review description and
// resolver cache must share this identity (not just an internal composite key).
export function chinaInvoiceDescription(description, family, stemLength) {
  const name = text(description).replace(/\s*\[(?:family|length):[^\]]*\]/gi, '').trim();
  return `${name} [family:${text(family).toUpperCase() || 'UNKNOWN'}] [length:${chinaStemLength(stemLength).key}]`;
}

function printedDate(value, XLSX, date1904) {
  let d, m, y;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF?.parse_date_code(value, { date1904 });
    if (parsed) ({ d, m, y } = parsed);
  } else {
    const s = text(value);
    const dmy = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dmy) [d, m, y] = dmy.slice(1).map(Number);
    else if (iso) [y, m, d] = iso.slice(1).map(Number);
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (!y || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) fail('invalid DATE (day/month/year)');
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function metadata(rows, XLSX, date1904) {
  const find = regex => {
    const values = [];
    for (const row of rows) for (let c = 0; c < row.length; c++) {
      const match = text(row[c]).match(regex);
      if (match) values.push(match[1]?.trim() || row.slice(c + 1).find(v => text(v)));
    }
    if (values.length !== 1 || !text(values[0])) fail('missing or ambiguous invoice metadata');
    return values[0];
  };
  const invoice = text(find(/\bINVOICE\s*(?:NO\.?|NUMBER)\s*[:：.]?\s*(.*)$/i));
  const dateSourceRaw = text(find(/\bDATE\s*[:：]?\s*(.*)$/i));
  const date = printedDate(dateSourceRaw, XLSX, date1904);
  // Only the supplier area before invoice/date metadata, never the TO recipient.
  const companyCells = rows.slice(0, 5).flat().filter(v => /HUBFRESH|MELODY|CLOUDLAND|YUNYAN|SUPPLY CHAIN|CO[.,\s]*LTD/i.test(text(v)));
  if (companyCells.length !== 1) fail('missing or ambiguous supplier');
  const supplier = String(companyCells[0]).split(/[\r\n]+/).map(text).find(v => /HUBFRESH|MELODY|CLOUDLAND|YUNYAN|CO[.,\s]*LTD/i.test(v));
  if (!supplier) fail('missing supplier');
  // raw_date is the already deterministically parsed ISO value. Preserve the
  // printed text separately so metadata validation never has to guess an order.
  return { invoice, date, raw_date: date, date_source_raw: dateSourceRaw,
    date_kind: 'invoice', date_order: 'YMD', supplier };
}

function parseSheet(XLSX, ws, sheetName, date1904) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  if (range.e.r > 100000 || range.e.c > 255) fail('worksheet range too large');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, blankrows: true, range: 0 });
  const hits = rows.slice(0, 50).map((row, i) => ({ i, cols: columns(row, PRODUCT_HEADERS) })).filter(hit => hit.cols);
  if (hits.length !== 1) fail('missing or ambiguous product headers');
  const { i: h, cols: c } = hits[0];
  const meta = metadata(rows.slice(0, h), XLSX, date1904);
  const optional = label => rows[h].findIndex(v => header(v).startsWith(label));
  const categoryColumn = optional('category'), chineseColumn = optional('chinesename');
  const cartonColumn = optional('ctnno');
  const products = [];
  let subtotalRow = -1;
  for (let r = h + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some(v => text(v))) continue;
    const name = text(row[c.name]);
    if (!name) { subtotalRow = r; break; }
    const n = field => number(row[c[field]], `${sheetName}!row ${r + 1} ${field}`, { integer: ['boxes', 'bunches', 'stems'].includes(field) });
    const pcs = n('boxes'), total_bunch = n('bunches'), total_stems = n('stems');
    const u_price = n('price'), t_price = n('amount');
    if (pcs <= 0 || total_bunch <= 0 || !close(total_bunch * u_price, t_price)) fail(`row ${r + 1} quantity/amount mismatch`);
    const category = text(row[categoryColumn]);
    const family = /多头玫瑰/.test(category) || /스프레이\s*장미|spray[ -]?rose/i.test(name) ? 'SPRAY_ROSE'
      : /玫瑰/.test(category) || /장미|\brose\b/i.test(name) ? 'ROSE'
        : /多头康乃馨/.test(category) || /스프레이\s*카네이션/i.test(name) ? 'SPRAY_CARN'
          : /康乃馨/.test(category) || /카네이션/i.test(name) ? 'CARNATION' : null;
    const length = chinaStemLength(row[c.length]);
    products.push({ description: chinaInvoiceDescription(name, family, row[c.length]),
      source_description: name, source_format: 'china_invoice_xlsx', source_row: r + 1,
      source_sheet: sheetName, category, chinese_name: text(row[chineseColumn]), family,
      stem_length: text(row[c.length]), length, specification: text(row[c.specification]),
      carton_no: text(row[cartonColumn]), pcs, total_bunch, total_stems,
      // These ratios come from exact source totals, not a specification range.
      bunch_st: total_stems / total_bunch, steam_box: total_stems / pcs, u_price, t_price });
  }
  if (!products.length || subtotalRow < 0) fail('missing products or independent subtotal');
  const subtotal = rows[subtotalRow];
  for (const [field, key] of [['boxes', 'pcs'], ['bunches', 'total_bunch'], ['stems', 'total_stems'], ['amount', 't_price']]) {
    if (!close(number(subtotal[c[field]], `subtotal ${field}`), sum(products, key))) fail('product subtotal mismatch: ' + field);
  }
  const itemSubtotal = sum(products, 't_price');
  const costs = [];
  let feeColumns = null, declaredFees = null, repeatedFlowers = false, invoiceTotal = null;
  for (let r = subtotalRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some(v => text(v))) continue;
    const label = row.map(text).join(' ');
    const nextCols = columns(row, { name: 'chargeitems', qty: 'qty', price: 'unitprice', amount: 'cny' });
    if (nextCols) {
      if (feeColumns) fail('duplicate charge headers');
      feeColumns = nextCols; continue;
    }
    if (/Total\s+additional\s+charges|附加费用合计/i.test(label)) {
      if (!feeColumns || declaredFees !== null) fail('ambiguous charge total');
      declaredFees = number(row[feeColumns.amount], 'charge total', { signed: true }); continue;
    }
    if (/^(?:GRAND\s+TOTAL|INVOICE\s+TOTAL|TOTAL\s*(?:\(CNY\))?\s*$|总金额)/i.test(text(row.find(v => text(v))))) {
      if (invoiceTotal !== null) fail('duplicate invoice total');
      const values = row.filter(v => text(v) && (typeof v === 'number' || /^-?[\d,.]+$/.test(text(v))));
      if (values.length !== 1) fail('ambiguous invoice total');
      invoiceTotal = number(values[0], 'invoice total', { signed: true }); continue;
    }
    if (feeColumns && text(row[feeColumns.name])) {
      if (declaredFees !== null) fail('charge after charge total');
      const name = text(row[feeColumns.name]);
      const amount = number(row[feeColumns.amount], `charge row ${r + 1} amount`, { signed: true });
      const quantity = number(row[feeColumns.qty], `charge row ${r + 1} quantity`);
      const unit_price = number(row[feeColumns.price], `charge row ${r + 1} price`, { signed: true });
      if (!close(quantity * unit_price, amount)) fail('charge line amount mismatch');
      if (/花材金额|flower\s*(?:material\s*)?(?:amount|total)|flowers?\s*subtotal/i.test(name)) {
        if (repeatedFlowers || !close(amount, itemSubtotal)) fail('duplicate or mismatched repeated flower amount');
        repeatedFlowers = true;
      } else costs.push({ description: name, quantity, unit_price, amount, source_row: r + 1 });
      continue;
    }
    // Section headings are allowed; unexplained monetary rows are not dropped.
    if (row.some(v => typeof v === 'number')) fail(`unrecognized monetary row ${r + 1}`);
  }
  const costTotal = sum(costs, 'amount');
  if (feeColumns && (declaredFees === null || !close(declaredFees, costTotal + (repeatedFlowers ? itemSubtotal : 0)))) fail('charge subtotal mismatch');
  const computedTotal = itemSubtotal + costTotal;
  if (invoiceTotal !== null && !close(invoiceTotal, computedTotal)) fail('invoice grand total mismatch');
  invoiceTotal ??= repeatedFlowers ? declaredFees : computedTotal;
  return { ...meta, awb: '', currency: 'CNY', source_format: 'china_invoice_xlsx',
    source_sheet: sheetName, products, additional_costs: costs, freight: costTotal,
    item_subtotal: itemSubtotal, invoice_total: invoiceTotal, total_value: invoiceTotal,
    total_boxes: sum(products, 'pcs'), total_bunches: sum(products, 'total_bunch'),
    total_stems: sum(products, 'total_stems') };
}

/** parsePackingResponse-compatible content envelope; throws on unsafe input. */
export function parseChinaInvoiceWorkbook(XLSX, base64) {
  if (!XLSX?.read || !XLSX?.utils) fail('XLSX reader is required');
  if (typeof base64 !== 'string' || !base64.length) fail('missing base64 workbook');
  // Bound before decoding/reading (also works in a browser without Buffer).
  if (base64.length > Math.ceil(CHINA_INVOICE_MAX_BYTES / 3) * 4) fail('workbook exceeds 50MiB');
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) fail('invalid base64 workbook');
  const bytes = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes > CHINA_INVOICE_MAX_BYTES) fail('workbook exceeds 50MiB');
  // SheetJS's JS base64 path repeatedly concatenates the entire 33MB binary
  // string (including embedded images). Decode native, bounded chunks instead.
  const decoded = new Uint8Array(bytes);
  const chunkSize = 65536; // divisible by four: chunks cannot split a quartet
  let offset = 0;
  for (let i = 0; i < base64.length; i += chunkSize) {
    const chunk = globalThis.atob(base64.slice(i, i + chunkSize));
    for (let j = 0; j < chunk.length; j++) decoded[offset++] = chunk.charCodeAt(j);
  }
  let wb = XLSX.read(decoded, { type: 'array', cellDates: false, cellFormula: false });
  const legacyCandidates = findLegacyChinaInvoiceCandidates(XLSX, wb);
  if (legacyCandidates.length > 1) fail('ambiguous legacy Invoice worksheets');
  if (legacyCandidates.length === 1) {
    if (wb.SheetNames.filter(isLegacyChinaInvoiceSheetName).length !== 1) {
      fail('ambiguous legacy Invoice worksheets');
    }
    // Re-read only legacy files with formulas enabled so source formula text and
    // cached values can be preserved. The modern parser keeps its prior options.
    wb = XLSX.read(decoded, { type: 'array', cellDates: false, cellFormula: true });
    return parseChinaLegacyInvoiceWorkbook(XLSX, wb);
  }
  const sheetNames = wb.SheetNames.filter(name => /^invoice$/i.test(name.trim()));
  if (sheetNames.length !== 1) fail('exactly one INVOICE worksheet is required');
  const name = sheetNames[0];
  const invoice = parseSheet(XLSX, wb.Sheets[name], name, Boolean(wb.Workbook?.WBProps?.date1904));
  return { content: [{ type: 'text', text: JSON.stringify({ invoices: [invoice] }) }] };
}

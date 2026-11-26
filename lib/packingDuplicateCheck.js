// Pure read-only duplicate detection & partition helpers for packing upload and receipt guards.
// Never mutates ERP state; strictly enforces cross-year isolation (OrderYear / InputDate year).
import { detectCOFarm } from './importPacking.js';
import { invoiceSupplierKey, isNzBloomSupplierMatch } from './invoiceReceiptAutoFill.js';

const text = value => String(value ?? '').normalize('NFKC').trim();

/**
 * Canonical invoice identifier for duplicate comparison:
 * - NFKC + uppercase + strip whitespace/hyphens/dots/underscores ("FK 2936" -> "FK2936", "FE 852" -> "FE852")
 * - Pure numeric invoices strip leading zeros ("0642" -> "642", "001077907" -> "1077907")
 *   because Excel / nenova.exe numeric cells drop leading zeros on upload (e.g. WK 8266 "642" vs PDF "0642").
 * - Alphanumeric prefixes are preserved so "FK 2936" (Construnorte) never collides with "2936" (Florentina).
 */
export function canonicalInvoiceNo(value) {
  const cleaned = text(value).toUpperCase().replace(/[\s\-._/]+/g, '');
  if (!cleaned) return '';
  if (/^\d+$/.test(cleaned)) {
    return cleaned.replace(/^0+(?=\d)/, '');
  }
  return cleaned;
}

export function samePackingSupplier(a, b, { country = '', farmMatches = null } = {}) {
  const left = text(a);
  const right = text(b);
  if (!left || !right) return false;
  if (left.toUpperCase() === right.toUpperCase()) return true;

  const keyA = invoiceSupplierKey(left);
  const keyB = invoiceSupplierKey(right);
  if (keyA && keyB && keyA === keyB) return true;

  const upperCountry = text(country).toUpperCase();
  if (upperCountry === 'NZ' || upperCountry === '뉴질랜드') {
    if (isNzBloomSupplierMatch(left, right) || isNzBloomSupplierMatch(right, left)) return true;
  }

  if (!upperCountry || upperCountry === 'CO' || upperCountry === '콜롬비아') {
    const farmA = detectCOFarm(left, farmMatches);
    const farmB = detectCOFarm(right, farmMatches);
    if (farmA?.abbr && farmA.abbr !== 'UNK' && farmA.abbr === farmB?.abbr) return true;
  }
  return false;
}

export function isMatchingDuplicateWarehouseRow(row, { farmName = '', supplier = '', invoiceNo = '', country = '', farmMatches = null } = {}) {
  const targetInv = canonicalInvoiceNo(invoiceNo);
  if (!targetInv) return false;
  // Backwards-compatibility: legacy unit-test mocks may omit InvoiceNo/FarmName when pre-filtered by SQL.
  const hasRowInvoice = row && Object.prototype.hasOwnProperty.call(row, 'InvoiceNo') && row.InvoiceNo != null;
  if (hasRowInvoice && canonicalInvoiceNo(row.InvoiceNo) !== targetInv) return false;

  const hasRowFarm = row && Object.prototype.hasOwnProperty.call(row, 'FarmName') && row.FarmName != null;
  if (hasRowFarm) {
    const candidates = [farmName, supplier].map(text).filter(Boolean);
    if (candidates.length > 0 && !candidates.some(name => samePackingSupplier(row.FarmName, name, { country, farmMatches }))) {
      return false;
    }
  }
  return true;
}

function rowYear(row) {
  const orderYear = text(row?.OrderYear);
  if (/^20\d{2}$/.test(orderYear)) return orderYear;
  const inputYear = text(row?.InputDate).slice(0, 4);
  return /^20\d{2}$/.test(inputYear) ? inputYear : '';
}

function normalizeWeek(value) {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(text(value));
  if (!match) return '';
  return `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

/**
 * Match extracted invoices against active WarehouseMaster rows within the SAME year scope.
 * Prior-year rows (e.g. 2025 / 48-02) never falsely block current-year (2026 / 48-02) invoices.
 */
export function matchExistingWarehouseReceipts(invoices = [], warehouseRows = [], { country = '', orderYear = '', orderWeek = '', farmMatches = null } = {}) {
  const targetYear = /^20\d{2}$/.test(text(orderYear)) ? text(orderYear) : '';
  const targetWeek = normalizeWeek(orderWeek);
  const activeRows = (Array.isArray(warehouseRows) ? warehouseRows : []).filter(row => {
    if (!row || row.isDeleted === 1 || row.isDeleted === true) return false;
    const yr = rowYear(row);
    if (targetYear && yr && yr !== targetYear) return false;
    return Boolean(canonicalInvoiceNo(row.InvoiceNo));
  });

  const matches = [];
  const matchesByIndex = {};

  (Array.isArray(invoices) ? invoices : []).forEach((item, listIndex) => {
    const index = Number.isInteger(item?.index) ? item.index : listIndex;
    const invNo = text(item?.invoice ?? item?.invoiceNo);
    const supplier = text(item?.supplier ?? item?.farmName);
    const invCanonical = canonicalInvoiceNo(invNo);
    if (!invCanonical || !supplier) return;

    const invDateYear = /^20\d{2}/.test(text(item?.date)) ? text(item.date).slice(0, 4) : '';
    const effectiveYear = targetYear || invDateYear;

    const candidates = activeRows.filter(row => {
      const yr = rowYear(row);
      if (effectiveYear && yr && yr !== effectiveYear) return false;
      if (canonicalInvoiceNo(row.InvoiceNo) !== invCanonical) return false;
      return samePackingSupplier(row.FarmName, supplier, { country, farmMatches });
    });
    if (!candidates.length) return;

    // Prefer exact OrderYear + OrderWeek match, then highest WarehouseKey (most recent active receipt).
    const sorted = [...candidates].sort((a, b) => {
      const aExactWeek = targetWeek && normalizeWeek(a.OrderWeek) === targetWeek ? 1 : 0;
      const bExactWeek = targetWeek && normalizeWeek(b.OrderWeek) === targetWeek ? 1 : 0;
      if (aExactWeek !== bExactWeek) return bExactWeek - aExactWeek;
      return Number(b.WarehouseKey || 0) - Number(a.WarehouseKey || 0);
    });
    const best = sorted[0];
    const exactWeek = Boolean(targetWeek && normalizeWeek(best.OrderWeek) === targetWeek);
    const match = {
      index,
      warehouseKey: Number(best.WarehouseKey),
      orderYear: text(best.OrderYear),
      orderWeek: text(best.OrderWeek),
      farmName: text(best.FarmName),
      invoiceNo: text(best.InvoiceNo),
      extractedInvoiceNo: invNo,
      extractedSupplier: supplier,
      awb: text(best.OrderNo ?? best.AWB),
      inputDate: text(best.InputDate).slice(0, 10),
      fileName: text(best.FileName),
      matchReason: exactWeek ? 'SAME_WEEK_INVOICE' : 'SAME_YEAR_INVOICE',
    };
    matches.push(match);
    matchesByIndex[index] = match;
  });

  return { matches, matchesByIndex };
}

/**
 * Partition extracted invoices into active (included in matching/export/receipt) vs excluded duplicates.
 */
export function partitionPackingInvoicesByDuplicates(invoices = [], excludedIndexes = new Set()) {
  const excludedSet = excludedIndexes instanceof Set ? excludedIndexes : new Set(excludedIndexes || []);
  const activeInvoices = [];
  const activeOriginalIndexes = [];
  const excludedInvoices = [];

  (Array.isArray(invoices) ? invoices : []).forEach((invoice, index) => {
    if (excludedSet.has(index)) {
      excludedInvoices.push({ index, invoice });
    } else {
      activeInvoices.push(invoice);
      activeOriginalIndexes.push(index);
    }
  });

  return { activeInvoices, activeOriginalIndexes, excludedInvoices };
}

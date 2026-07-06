/**
 * 출고분배 엑셀 검증 — 원본 xlsx 파싱 프로브 (DB 없음)
 * 사용: node scripts/probe-distribute-import-xlsx.mjs "path/to/file.xlsx" [customerNeedle]
 */
import XLSX from 'xlsx';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// Next/webpack alias 우회 — parseAllocationWorkbook 만 로드하기 어려우므로 xlsx 직접 + 동일 헬퍼 복제 최소화

const file = process.argv[2];
const custNeedle = (process.argv[3] || '친구5125').toLowerCase();
if (!file) {
  console.error('Usage: node scripts/probe-distribute-import-xlsx.mjs <xlsx> [customerNeedle]');
  process.exit(1);
}

const SUMMARY_LABELS = new Set(['주문', '입고', '재고', '잔량']);

function cellValue(sheet, row, col) {
  const addr = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
  return sheet[addr]?.v ?? '';
}

function productColumnStats(sheet, range, dataStartRow, productCol) {
  let count = 0;
  let latinCount = 0;
  for (let r = dataStartRow; r <= range.e.r + 1; r += 1) {
    const raw = String(cellValue(sheet, r, productCol) || '').trim();
    if (!raw || /합\s*계|total/i.test(raw) || /^\d{1,2}[-－]\d{1,2}/.test(raw)) continue;
    count += 1;
    if (/[a-z]/i.test(raw)) latinCount += 1;
  }
  const title = `${cellValue(sheet, 1, productCol)} ${cellValue(sheet, 2, productCol)}`.trim();
  const hasBlockTitle = /\d{2,4}[-－]?\d*|카네이션|장미|수국|알스트로|rose|carnation|hydrangea|alstro/i.test(title);
  const valid = latinCount >= 3 || count >= 15 || (hasBlockTitle && count >= 1);
  return { count, latinCount, valid, hasBlockTitle };
}

function detectCustomerColumns(sheet, range) {
  let headerRow = null;
  let summaryStart = null;
  for (let r = 1; r <= Math.min(12, range.e.r + 1); r += 1) {
    let summaryCount = 0;
    let firstSummaryCol = null;
    for (let c = 1; c <= range.e.c + 1; c += 1) {
      const label = String(cellValue(sheet, r, c) || '').trim();
      if (SUMMARY_LABELS.has(label)) {
        summaryCount += 1;
        if (!firstSummaryCol) firstSummaryCol = c;
      }
    }
    if (summaryCount >= 2) {
      headerRow = r;
      summaryStart = firstSummaryCol;
      break;
    }
  }
  if (!headerRow) headerRow = 3;
  if (!summaryStart) summaryStart = range.e.c + 2;

  const columns = [];
  for (let c = 1; c < summaryStart; c += 1) {
    const customer = String(cellValue(sheet, headerRow, c) || '').trim();
    if (/^칼라$|^컬러$/i.test(customer)) continue;
    if (!customer || SUMMARY_LABELS.has(customer)) continue;
    let productCol = null;
    for (let pc = c - 1; pc >= 1; pc -= 1) {
      const header = String(cellValue(sheet, headerRow, pc) || '').trim();
      if (header) continue;
      const sample = String(cellValue(sheet, headerRow + 1, pc) || '').trim();
      if (sample && productColumnStats(sheet, range, headerRow + 1, pc).valid) {
        productCol = pc;
        break;
      }
    }
    if (!productCol) continue;
    columns.push({ col: c, customer, productCol });
  }
  return { columns, headerRow, dataStartRow: headerRow + 1, summaryStart };
}

function detectProductRows(sheet, range, productCols, dataStartRow, sheetName) {
  const rowsByProductCol = new Map();
  for (const productCol of productCols) {
    const rows = new Set();
    for (let r = dataStartRow; r <= range.e.r + 1; r += 1) {
      const rawProduct = String(cellValue(sheet, r, productCol) || '').trim();
      if (!rawProduct || /합\s*계|total/i.test(rawProduct) || /^\d{1,2}[-－]\d{1,2}/.test(rawProduct)) continue;
      rows.add(r);
    }
    rowsByProductCol.set(productCol, rows);
  }
  return rowsByProductCol;
}

const wb = XLSX.readFile(file, { cellDates: false, cellNF: false, cellStyles: false });
console.log('File:', file);
console.log('Sheets:', wb.SheetNames.join(', '));

const allRows = [];
for (const sheetName of wb.SheetNames) {
  if (sheetName === '_keymap') continue;
  const sheet = wb.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const { columns, headerRow, dataStartRow, summaryStart } = detectCustomerColumns(sheet, range);
  const productCols = [...new Set(columns.map((cc) => cc.productCol))];
  const productRowsByCol = detectProductRows(sheet, range, productCols, dataStartRow, sheetName);

  console.log(`\n--- ${sheetName} ---`);
  console.log(`header R${headerRow}, data from R${dataStartRow}, summary from C${summaryStart}, customers: ${columns.length}, productCols: ${productCols.join(',')}`);

  const custHit = columns.filter((cc) => cc.customer.toLowerCase().includes(custNeedle.replace(/\s/g, '')) || custNeedle.includes(cc.customer.toLowerCase()));
  console.log(`Customer match "${custNeedle}":`, custHit.map((c) => `C${c.col}="${c.customer}" prodCol=C${c.productCol}`).join(' | ') || 'NONE');

  for (let r = dataStartRow; r <= range.e.r + 1; r += 1) {
    for (const cc of columns) {
      if (!productRowsByCol.get(cc.productCol)?.has(r)) continue;
      const rawProduct = String(cellValue(sheet, r, cc.productCol) || '').trim();
      const qty = Number(String(cellValue(sheet, r, cc.col) || '').replace(/,/g, '')) || 0;
      const rawCell = cellValue(sheet, r, cc.col);
      allRows.push({
        sheetName,
        rowNo: r,
        colNo: cc.col,
        customerLabel: cc.customer,
        productLabel: rawProduct,
        uploadQty: qty,
        rawCell,
        productCol: cc.productCol,
      });
    }
  }
}

console.log('\n=== Total parsed cells:', allRows.length);

const custRows = allRows.filter((r) => String(r.customerLabel).toLowerCase().includes('5125') || String(r.customerLabel).toLowerCase().includes(custNeedle));
console.log(`=== Rows for customer containing "${custNeedle}":`, custRows.length);

const prodNeedles = ['apple tea', 'caroline gold'];
for (const pn of prodNeedles) {
  const hits = custRows.filter((r) => String(r.productLabel).toLowerCase().includes(pn.split(' ')[0]) && String(r.productLabel).toLowerCase().includes(pn.split(' ')[1] || ''));
  console.log(`\n--- ${pn} x customer ---`);
  if (!hits.length) {
    const prodInSheet = allRows.filter((r) => String(r.productLabel).toLowerCase().replace(/\s+/g, ' ').includes(pn));
    console.log('  NOT FOUND for customer. Product exists in sheet for other customers:', prodInSheet.length, 'cells');
    const nonzero = prodInSheet.filter((r) => r.uploadQty !== 0);
    console.log('  Nonzero elsewhere:', nonzero.length);
    if (prodInSheet[0]) console.log('  Sample product label:', prodInSheet[0].productLabel, 'sheet', prodInSheet[0].sheetName, 'R' + prodInSheet[0].rowNo);
  }
  for (const h of hits) {
    console.log(`  R${h.rowNo}C${h.colNo} qty=${h.uploadQty} raw=${JSON.stringify(h.rawCell)} prod="${h.productLabel}" sheet=${h.sheetName}`);
  }
}

console.log('\n=== Customer row sample (first 15 products, qty!=0 only) ===');
for (const r of custRows.filter((x) => x.uploadQty !== 0).slice(0, 15)) {
  console.log(`  ${r.productLabel}: ${r.uploadQty}`);
}
console.log('... zero-qty cells for customer:', custRows.filter((x) => x.uploadQty === 0).length);

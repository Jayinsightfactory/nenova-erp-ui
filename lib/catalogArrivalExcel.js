// 카탈로그 — 도착원가 엑셀 파싱 + 품목 매칭

import XLSX from 'xlsx';

const HEADER_ALIASES = {
  prodKey: ['prodkey', '품목키', '품목 key', '품목키값'],
  prodCode: ['prodcode', '품목코드', '코드', '품번'],
  prodName: ['품목명', 'prodname', 'displayname', '카탈로그명', '품목', '품종', '품종명', '상품명'],
  arrivalCost: ['도착원가', 'arrivalcost', '도착 원가', 'displayarrivalkrw', '도착원가/단', '도착원가/송이', '도착원가/박스'],
  unit: ['단위', 'outunit', 'arrivalunit', '표시단위'],
};

function normHeader(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）/\\[\]:：·]/g, '');
}

function normName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function asNumber(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/[,₩원\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function detectColumns(headerRow) {
  const cols = {};
  headerRow.forEach((cell, idx) => {
    const h = normHeader(cell);
    if (!h) return;
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (cols[key] != null) continue;
      if (aliases.some(a => h === a || h.includes(a) || a.includes(h))) {
        cols[key] = idx;
      }
    }
  });
  return cols;
}

function findHeaderRow(aoa) {
  for (let r = 0; r < Math.min(aoa.length, 30); r += 1) {
    const row = aoa[r] || [];
    const cols = detectColumns(row);
    if (cols.arrivalCost != null && (cols.prodKey != null || cols.prodCode != null || cols.prodName != null)) {
      return { rowIndex: r, cols };
    }
  }
  return null;
}

function buildProductLookups(products) {
  const byKey = new Map();
  const byCode = new Map();
  const byName = new Map();
  for (const p of products) {
    byKey.set(Number(p.ProdKey), p);
    const code = String(p.ProdCode || '').trim().toLowerCase();
    if (code) byCode.set(code, p);
    for (const name of [p.DisplayName, p.ProdName]) {
      const n = normName(name);
      if (n && !byName.has(n)) byName.set(n, p);
    }
  }
  return { byKey, byCode, byName };
}

function matchProduct({ prodKey, prodCode, prodName }, lookups) {
  const pk = parseInt(prodKey, 10);
  if (pk > 0 && lookups.byKey.has(pk)) return lookups.byKey.get(pk);

  const code = String(prodCode || '').trim().toLowerCase();
  if (code && lookups.byCode.has(code)) return lookups.byCode.get(code);

  const name = normName(prodName);
  if (name && lookups.byName.has(name)) return lookups.byName.get(name);

  if (name) {
    for (const [k, p] of lookups.byName.entries()) {
      if (k.includes(name) || name.includes(k)) return p;
    }
  }
  return null;
}

/**
 * @param {Buffer|string} input — file buffer or path
 * @param {object[]} products — Product rows from DB
 */
export function parseCatalogArrivalExcel(input, products) {
  const workbook = typeof input === 'string'
    ? XLSX.readFile(input, { cellDates: false, cellNF: false, cellStyles: false })
    : XLSX.read(input, { type: 'buffer', cellDates: false, cellNF: false, cellStyles: false });

  let best = null;
  for (const sheetName of workbook.SheetNames) {
    const ws = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: null });
    const found = findHeaderRow(aoa);
    if (found) {
      best = { sheetName, aoa, ...found };
      break;
    }
  }
  if (!best) {
    throw new Error('엑셀에서 도착원가·품목 열을 찾을 수 없습니다. (품목키/품목명 + 도착원가)');
  }

  const lookups = buildProductLookups(products);
  const rows = [];
  const unmatched = [];
  const items = {};

  for (let r = best.rowIndex + 1; r < best.aoa.length; r += 1) {
    const row = best.aoa[r] || [];
    const arrivalCost = asNumber(row[best.cols.arrivalCost]);
    if (!(arrivalCost > 0)) continue;

    const raw = {
      prodKey: best.cols.prodKey != null ? row[best.cols.prodKey] : null,
      prodCode: best.cols.prodCode != null ? row[best.cols.prodCode] : null,
      prodName: best.cols.prodName != null ? row[best.cols.prodName] : null,
      arrivalCost,
      unit: best.cols.unit != null ? String(row[best.cols.unit] || '').trim() : '',
    };

    rows.push(raw);
    const prod = matchProduct(raw, lookups);
    if (!prod) {
      unmatched.push({ row: r + 1, ...raw });
      continue;
    }

    items[String(prod.ProdKey)] = {
      prodKey: prod.ProdKey,
      prodCode: prod.ProdCode,
      prodName: prod.DisplayName || prod.ProdName,
      arrivalCost,
      arrivalUnit: raw.unit || prod.OutUnit || '단',
    };
  }

  return {
    sheetName: best.sheetName,
    rowCount: rows.length,
    matchedCount: Object.keys(items).length,
    unmatchedCount: unmatched.length,
    items,
    unmatched: unmatched.slice(0, 50),
  };
}

/** 현재 도착원가 → 재업로드용 간단 xlsx */
export function buildArrivalTemplateWorkbook(productsWithCost) {
  const rows = [
    ['ProdKey', 'ProdCode', '품목명', '도착원가', '단위'],
  ];
  for (const p of productsWithCost) {
    if (!(Number(p.arrivalCost) > 0)) continue;
    rows.push([
      p.ProdKey,
      p.ProdCode || '',
      p.DisplayName || p.ProdName || '',
      Number(p.arrivalCost) || 0,
      p.arrivalUnit || p.OutUnit || '단',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '도착원가');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// lib/orderImportParse.js — 라움/네노바 발주 엑셀·표 파싱

const NAME_HEADERS = ['품명', '품목', '품목명', '품목명칭', 'item', 'itemname', 'name', 'product', 'productname', '품목/품명'];
const COLOR_HEADERS = ['칼라', '칼라', 'color', 'variety', '품종', '색상', 'varietyname'];
const UNIT_HEADERS = ['단위', 'unit', 'uom'];
const ORDER_QTY_HEADERS = ['발주수량', '발주'];
const REQUEST_QTY_HEADERS = ['요청수량', '요청'];
const QTY_HEADERS = ['수량', '계', 'qty', 'quantity', 'total', '합계', '주문수량', '수량합계'];

function normHeader(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

function cellMatchesName(cell) {
  const c = normHeader(cell);
  if (!c) return false;
  return NAME_HEADERS.some(h => c === h || c.includes(h) || (h.length >= 2 && c.includes(h)));
}

function cellMatchesColor(cell) {
  const c = normHeader(cell);
  if (!c) return false;
  return COLOR_HEADERS.some(h => c === h || c.includes(h));
}

function cellMatchesUnit(cell) {
  const c = normHeader(cell);
  if (!c) return false;
  return UNIT_HEADERS.some(h => c === h || c.includes(h));
}

function cellMatchesOrderQty(cell) {
  const c = normHeader(cell);
  if (!c) return false;
  return ORDER_QTY_HEADERS.some(h => c === h || c.includes(h));
}

function cellMatchesRequestQty(cell) {
  const c = normHeader(cell);
  if (!c) return false;
  return REQUEST_QTY_HEADERS.some(h => c === h || c.includes(h));
}

function cellMatchesQty(cell) {
  const c = normHeader(cell);
  if (!c) return false;
  if (cellMatchesRequestQty(cell)) return false;
  return QTY_HEADERS.some(h => c === h || c.includes(h)) || cellMatchesOrderQty(cell);
}

function maxColumnCount(rows) {
  let max = 0;
  for (const row of rows || []) {
    if (Array.isArray(row)) max = Math.max(max, row.length);
  }
  return max;
}

function inferQtyColumn(rows, headerRow, skipCols = []) {
  const start = headerRow + 1;
  const end = Math.min(rows.length, start + 30);
  const skip = new Set(skipCols.filter(i => i >= 0));
  const maxCol = maxColumnCount(rows);

  let bestCol = -1;
  let bestScore = 0;
  for (let col = 0; col < maxCol; col += 1) {
    if (skip.has(col)) continue;
    const headerCell = rows[headerRow]?.[col];
    if (cellMatchesRequestQty(headerCell)) continue;

    let numeric = 0;
    for (let i = start; i < end; i += 1) {
      const v = rows[i]?.[col];
      if (v == null || v === '') continue;
      const q = parseRaumOrderQty(v).qty ?? parseQty(v);
      if (q != null && q > 0) numeric += 1;
    }
    if (numeric > bestScore) {
      bestScore = numeric;
      bestCol = col;
    }
  }
  return bestScore >= 2 ? bestCol : -1;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i += 1) {
    const row = rows[i] || [];
    const nameCol = row.findIndex(cell => cellMatchesName(cell));
    if (nameCol < 0) continue;

    const colorCol = row.findIndex(cell => cellMatchesColor(cell));
    const unitCol = row.findIndex(cell => cellMatchesUnit(cell));
    const requestQtyCol = row.findIndex(cell => cellMatchesRequestQty(cell));

    let orderQtyCol = row.findIndex(cell => cellMatchesOrderQty(cell));
    let qtyCol = orderQtyCol >= 0 ? orderQtyCol : -1;

    if (qtyCol < 0) {
      qtyCol = row.findIndex((cell, idx) => cellMatchesQty(cell) && idx !== requestQtyCol);
    }
    if (qtyCol < 0) {
      qtyCol = inferQtyColumn(rows, i, [nameCol, colorCol, unitCol, requestQtyCol]);
    }
    if (qtyCol < 0) continue;

    const format = colorCol >= 0 ? 'raum' : 'simple';
    return {
      headerRow: i,
      nameCol,
      colorCol,
      unitCol,
      qtyCol,
      requestQtyCol,
      format,
    };
  }
  return null;
}

function isTitleOrMetaRow(inputName) {
  const name = String(inputName || '').trim();
  if (!name) return true;
  if (/^(합계|소계|total|subtotal)$/i.test(name)) return true;
  if (/^\d{1,2}\/\d{1,2}(\s|$)/.test(name) && !/(수국|장미|카네|호접|튤립|안개)/.test(name)) return true;
  if (/^(발주|입고)\s*(목록|표|내역)?$/i.test(name)) return true;
  if (/네노바.*(발주|입고|목록)/i.test(name) && !/(수국|장미|카네|호접|튤립|안개)/.test(name)) return true;
  if (/^no\.?$/i.test(name) || name === '번호') return true;
  if (/^예상잔량$/i.test(name) || name === '요청수량' || name === '발주수량') return true;
  if (/^\d+차/.test(name) || /출고\)/.test(name)) return true;
  return false;
}

function isCategoryOnlyName(name) {
  const n = String(name || '').trim();
  return /^(수국|장미|카네이션|호접|튤립|안개|알스트로|네덜란드|콜롬비아|중국|에콰도르)$/i.test(n);
}

export function parseQty(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).replace(/,/g, '').trim();
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** 라움 발주수량: "67박스(2010대)" → qty 67, unit 박스 */
export function parseRaumOrderQty(raw) {
  if (raw == null || raw === '') return { qty: null, unit: '', rawText: '' };
  const s = String(raw).replace(/,/g, '').trim();
  if (!s) return { qty: null, unit: '', rawText: '' };

  const boxMatch = s.match(/(\d+)\s*박스/i);
  if (boxMatch) {
    return { qty: Number(boxMatch[1]), unit: '박스', rawText: s };
  }

  const bunchOnly = s.match(/^(\d+)\s*단(?:\s*\(|$)/i) || s.match(/(\d+)\s*단/i);
  if (bunchOnly && !/박스/i.test(s)) {
    return { qty: Number(bunchOnly[1]), unit: '단', rawText: s };
  }

  const stemMatch = s.match(/(\d+)\s*(?:송이|stem|stems)/i);
  if (stemMatch) {
    return { qty: Number(stemMatch[1]), unit: '송이', rawText: s };
  }

  const daeMatch = s.match(/(\d+)\s*대/i);
  if (daeMatch && !/박스/i.test(s)) {
    return { qty: Number(daeMatch[1]), unit: '대', rawText: s };
  }

  const n = parseQty(s);
  let unit = '';
  if (/박스|box/i.test(s)) unit = '박스';
  else if (/단|bunch/i.test(s)) unit = '단';
  else if (/송이|stem/i.test(s)) unit = '송이';
  else if (/대/.test(s)) unit = '대';

  return { qty: n, unit, rawText: s };
}

function cleanName(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/\(콜\)/gi, '(콜)')
    .trim();
}

function parseRaumFormatRows(rows, header, sourceName, logs) {
  const out = [];
  let lastCategory = '';

  for (let i = header.headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const categoryCell = cleanName(row[header.nameCol]);
    const colorCell = cleanName(row[header.colorCol]);

    if (categoryCell && !isTitleOrMetaRow(categoryCell) && !isCategoryOnlyName(colorCell)) {
      if (!colorCell || isCategoryOnlyName(categoryCell)) {
        lastCategory = categoryCell;
      }
    }

    if (!colorCell || isTitleOrMetaRow(colorCell)) continue;

    let category = lastCategory;
    if (!category && categoryCell && isCategoryOnlyName(categoryCell)) {
      category = categoryCell;
      lastCategory = category;
    }
    if (!category) continue;

    const inputName = cleanName(`${category} ${colorCell}`);
    if (!inputName || isTitleOrMetaRow(inputName)) continue;

    const orderRaw = row[header.qtyCol];
    const { qty, unit, rawText } = parseRaumOrderQty(orderRaw);
    if (qty == null || qty <= 0) {
      if (rawText) logs.push(`행 ${i + 1}: 발주수량 없음 — ${inputName} (${rawText})`);
      continue;
    }

    const requestRaw = header.requestQtyCol >= 0 ? String(row[header.requestQtyCol] || '').trim() : '';
    out.push({
      rowNo: i + 1,
      inputName,
      unit: unit || (header.unitCol >= 0 ? String(row[header.unitCol] || '').trim() : ''),
      qty,
      rawUnit: unit,
      rawOrderQty: rawText,
      rawRequestQty: requestRaw,
      category,
      color: colorCell,
    });
  }

  logs.push(`${sourceName}: 라움형 ${out.length}건 (품명+칼라 → 품종, 발주수량)`);
  return out;
}

function parseSimpleFormatRows(rows, header, sourceName, logs) {
  const out = [];
  for (let i = header.headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const inputName = cleanName(row[header.nameCol]);
    const unit = header.unitCol >= 0 ? String(row[header.unitCol] || '').trim() : '';
    const orderParsed = parseRaumOrderQty(row[header.qtyCol]);
    const qty = orderParsed.qty ?? parseQty(row[header.qtyCol]);
    const resolvedUnit = orderParsed.unit || unit;

    if (!inputName || isTitleOrMetaRow(inputName)) continue;
    if (qty == null || qty <= 0) {
      logs.push(`행 ${i + 1}: 수량 없음 — ${inputName}`);
      continue;
    }
    out.push({
      rowNo: i + 1,
      inputName,
      unit: resolvedUnit,
      qty,
      rawUnit: resolvedUnit || unit,
    });
  }

  logs.push(`${sourceName}: ${out.length}건 파싱 (헤더 ${header.headerRow + 1}행)`);
  return out;
}

/**
 * @param {Array<Array>} rows — sheet_to_json header:1
 * @returns {{ rows: Array, logs: string[], header: object|null }}
 */
export function parseOrderImportSheetRows(rows, { sourceName = 'sheet' } = {}) {
  const logs = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { rows: [], logs: ['빈 시트'], header: null };
  }

  const header = findHeaderRow(rows);
  if (!header) {
    return { rows: [], logs: [`헤더 행을 찾지 못함 (${sourceName}) — 품명/수량 열 필요`], header: null };
  }

  const out = header.format === 'raum' && header.colorCol >= 0
    ? parseRaumFormatRows(rows, header, sourceName, logs)
    : parseSimpleFormatRows(rows, header, sourceName, logs);

  return { rows: out, logs, header };
}

/**
 * @param {import('xlsx').WorkBook} workbook
 */
export function parseOrderImportWorkbook(XLSX, workbook, { sourceName } = {}) {
  const names = workbook.SheetNames || [];
  if (!names.length) return { rows: [], logs: ['시트 없음'], sheetName: null };

  let best = { rows: [], logs: ['파싱 가능한 시트 없음'], sheetName: null, header: null };
  for (const sheetName of names) {
    const ws = workbook.Sheets[sheetName];
    if (!ws) continue;
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    const parsed = parseOrderImportSheetRows(raw, { sourceName: sourceName || sheetName });
    if (parsed.rows.length > best.rows.length) {
      best = { ...parsed, sheetName };
    }
  }
  if (best.rows.length === 0 && names.length === 1) {
    return { ...best, sheetName: names[0] };
  }
  if (best.rows.length > 0) {
    best.logs = [...best.logs, `시트 선택: ${best.sheetName}`];
  }
  return best;
}

/**
 * Vision/OCR JSON → rows
 * @param {Array<{inputName:string, unit?:string, qty:number}>} items
 */
export function normalizeVisionItems(items) {
  const rows = [];
  const logs = [];
  (items || []).forEach((it, idx) => {
    const category = cleanName(it.category || it.품명 || it.flower || '');
    const color = cleanName(it.color || it.칼라 || it.variety || '');
    let inputName = cleanName(it.inputName || it.name || it.품목 || '');
    if (!inputName && category && color) {
      inputName = cleanName(`${category} ${color}`);
    }
    const qtyRaw = it.orderQty ?? it.발주수량 ?? it.qty ?? it.quantity ?? it.수량;
    const orderParsed = parseRaumOrderQty(qtyRaw);
    const qty = orderParsed.qty ?? parseQty(qtyRaw);
    const unit = String(it.unit || it.단위 || orderParsed.unit || '').trim();
    if (!inputName) return;
    if (qty == null || qty <= 0) {
      logs.push(`항목 ${idx + 1}: 발주수량 없음 — ${inputName}`);
      return;
    }
    rows.push({ rowNo: idx + 1, inputName, unit, qty });
  });
  logs.push(`이미지 OCR: ${rows.length}건`);
  return { rows, logs };
}

export const VISION_PARSE_PROMPT = `이 이미지는 꽃 도매 발주 목록 표입니다 (라움 등 거래처).
표에서 각 품목 행을 추출해 JSON만 반환하세요.

형식:
{
  "items": [
    { "category": "수국", "color": "화이트", "inputName": "수국 화이트", "orderQty": "67박스(2010대)", "qty": 67, "unit": "박스" },
    ...
  ]
}

규칙:
- 품명(수국·장미 등) + 칼라(화이트·몬디알 화이트 등)를 합쳐 inputName 으로 (품종 품명)
- qty: **발주수량** 열 값 (요청수량 아님). "67박스(2010대)" → qty=67, unit=박스
- 발주수량이 비어 있으면 해당 행 제외
- unit: 발주수량에서 추출 (박스/단/대)
- 헤더·합계·빈 행 제외
- JSON만 출력, 설명 없음`;

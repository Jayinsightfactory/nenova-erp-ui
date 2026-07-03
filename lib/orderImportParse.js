// lib/orderImportParse.js — 라움/네노바 발주 엑셀·표 파싱

const NAME_HEADERS = ['품명', '품목', '품목명', '품목명칭', 'item', 'itemname', 'name', 'product', 'productname', '품목/품명'];
const UNIT_HEADERS = ['단위', 'unit', 'uom'];
const QTY_HEADERS = ['수량', '계', 'qty', 'quantity', 'total', '합계', '주문수량', '발주수량', '수량합계'];

function normHeader(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

function cellMatchesName(cell) {
  const c = normHeader(cell);
  if (!c) return false;
  return NAME_HEADERS.some(h => c === h || c.includes(h) || (h.length >= 2 && c.includes(h)));
}

function cellMatchesUnit(cell) {
  const c = normHeader(cell);
  if (!c) return false;
  return UNIT_HEADERS.some(h => c === h || c.includes(h));
}

function cellMatchesQty(cell) {
  const c = normHeader(cell);
  if (!c) return false;
  return QTY_HEADERS.some(h => c === h || c.includes(h));
}

function maxColumnCount(rows) {
  let max = 0;
  for (const row of rows || []) {
    if (Array.isArray(row)) max = Math.max(max, row.length);
  }
  return max;
}

function inferQtyColumn(rows, headerRow, nameCol, unitCol) {
  const start = headerRow + 1;
  const end = Math.min(rows.length, start + 25);
  const skip = new Set([nameCol, unitCol].filter(i => i >= 0));
  const maxCol = maxColumnCount(rows);

  let bestCol = -1;
  let bestScore = 0;
  for (let col = 0; col < maxCol; col += 1) {
    if (skip.has(col)) continue;
    let numeric = 0;
    let total = 0;
    for (let i = start; i < end; i += 1) {
      const v = rows[i]?.[col];
      if (v == null || v === '') continue;
      total += 1;
      const q = parseQty(v);
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

    const unitCol = row.findIndex(cell => cellMatchesUnit(cell));
    let qtyCol = row.findIndex(cell => cellMatchesQty(cell));
    if (qtyCol < 0) {
      qtyCol = inferQtyColumn(rows, i, nameCol, unitCol);
    }
    if (qtyCol < 0) continue;

    return { headerRow: i, nameCol, unitCol, qtyCol };
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
  return false;
}

function parseQty(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw);
  const s = String(raw).replace(/,/g, '').trim();
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function cleanName(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/\(콜\)/gi, '(콜)')
    .trim();
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

  const out = [];
  for (let i = header.headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const inputName = cleanName(row[header.nameCol]);
    const unit = header.unitCol >= 0 ? String(row[header.unitCol] || '').trim() : '';
    const qty = parseQty(row[header.qtyCol]);
    if (!inputName || isTitleOrMetaRow(inputName)) continue;
    if (qty == null || qty <= 0) {
      logs.push(`행 ${i + 1}: 수량 없음 — ${inputName}`);
      continue;
    }
    out.push({
      rowNo: i + 1,
      inputName,
      unit,
      qty,
    });
  }

  logs.push(`${sourceName}: ${out.length}건 파싱 (헤더 ${header.headerRow + 1}행)`);
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
    const inputName = cleanName(it.inputName || it.name || it.품목 || it.품명);
    const qty = parseQty(it.qty ?? it.quantity ?? it.수량 ?? it.계);
    const unit = String(it.unit || it.단위 || '').trim();
    if (!inputName) return;
    if (qty == null || qty <= 0) {
      logs.push(`항목 ${idx + 1}: 수량 없음 — ${inputName}`);
      return;
    }
    rows.push({ rowNo: idx + 1, inputName, unit, qty });
  });
  logs.push(`이미지 OCR: ${rows.length}건`);
  return { rows, logs };
}

export const VISION_PARSE_PROMPT = `이 이미지는 꽃 도매 발주 목록 표입니다.
표에서 각 품목 행을 추출해 JSON만 반환하세요.

형식:
{
  "items": [
    { "inputName": "수국 화이트(콜)", "unit": "대", "qty": 145 },
    ...
  ]
}

규칙:
- inputName: 품목/품명 열 텍스트 그대로 (No 열 제외)
- unit: 단위 열 (없으면 빈 문자열 — 단위 열이 보이지 않으면 비워두세요)
- qty: 수량/계 열 정수 (쉼표 제거)
- 헤더·합계·빈 행 제외
- JSON만 출력, 설명 없음`;

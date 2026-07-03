// lib/orderImportParse.js — 라움/네노바 발주 엑셀·표 파싱

const NAME_HEADERS = ['품명', '품목', 'item', 'name', 'product'];
const UNIT_HEADERS = ['단위', 'unit'];
const QTY_HEADERS = ['수량', '계', 'qty', 'quantity', 'total'];

function normHeader(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '');
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i] || [];
    const cells = row.map(normHeader);
    const hasName = cells.some(c => NAME_HEADERS.includes(c));
    const hasQty = cells.some(c => QTY_HEADERS.includes(c));
    if (hasName && hasQty) {
      const nameCol = cells.findIndex(c => NAME_HEADERS.includes(c));
      const unitCol = cells.findIndex(c => UNIT_HEADERS.includes(c));
      const qtyCol = cells.findIndex(c => QTY_HEADERS.includes(c));
      return { headerRow: i, nameCol, unitCol, qtyCol };
    }
  }
  return null;
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
    if (!inputName) continue;
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
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) return { rows: [], logs: ['시트 없음'], sheetName: null };
  const ws = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const parsed = parseOrderImportSheetRows(raw, { sourceName: sourceName || sheetName });
  return { ...parsed, sheetName };
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

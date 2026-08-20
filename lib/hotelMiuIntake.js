// 호텔+미우 통합게시판 주문입력 — 순수 정책.
// 공통 order-mappings 는 초기값으로만 읽고, 이 게시판에서 고친 매칭은 overlay 가 덮는다.
import { parseOrderImportSheetRows } from './orderImportParse.js';
import { mergeRegisterItems } from './orderImportMatch.js';
import { normalizeImportUnit, inferImportUnitFromName } from './orderImportUnits.js';
import { normalizeToken } from './parseMappings.js';
import { jamoSimilarity, scoreMatch } from './displayName.js';
import { buildRaumMatchName } from './raumPnlImage.js';

export const HOTEL_MIU_FAVORITE_PAGE = 'hotel-miu-board';
export const HOTEL_MIU_BATCH_DRAFT = 'DRAFT';
export const HOTEL_MIU_BATCH_REGISTERED = 'REGISTERED';

export function isDraftBatch(batch) {
  return String(batch?.status || batch?.Status || '').toUpperCase() === HOTEL_MIU_BATCH_DRAFT;
}

export function mergeAllBatchLines(batches = []) {
  return mergeRegisterItems((batches || []).flatMap((b) => b.lines || []));
}

export function batchLineTotal(lines = []) {
  return (lines || []).reduce((sum, line) => sum + Number(line.qty || 0), 0);
}

export const HOTEL_MIU_VISION_PROMPT = `이 이미지는 꽃 도매 발주 엑셀 표입니다.
각 데이터 행에서 품명·단위(있으면)·수량을 추출해 JSON만 반환하세요.

형식:
{ "items": [ { "inputName": "수국 화이트", "qty": 220, "unit": "대" } ] }

규칙:
- inputName: 품명+품종. 괄호 표기(수국(화이트))도 품종을 포함해 적는다.
- qty: 그 행의 주문 수량 숫자. 행 번호(1,2,3…)는 수량이 아니다.
- unit: 대/단/송이/박스 중 있으면 그대로. 없으면 빈 문자열.
- 헤더(품명/단위/수량)·합계·빈 행 제외.
- 글자가 흐릿해도 보이는 대로 적는다. JSON만 출력.`;

const UNIT_RE = /^(대|단|송이|박스|box|bunch|stem|stems)$/i;

export function mergeBoardMappings(globalMap = {}, boardMap = {}) {
  return { ...globalMap, ...boardMap };
}

export function overlayMappingRecord(inputName, prod, unit = '') {
  const token = normalizeToken(inputName);
  if (!token || !(prod?.ProdKey || prod?.prodKey)) return null;
  const prodKey = Number(prod.ProdKey || prod.prodKey);
  return {
    token,
    value: {
      prodKey,
      prodName: prod.ProdName || prod.prodName || '',
      displayName: prod.DisplayName || prod.displayName || prod.ProdName || prod.prodName || '',
      flowerName: prod.FlowerName || prod.flowerName || '',
      counName: prod.CounName || prod.counName || '',
      unit: normalizeImportUnit(unit) || '',
      auto: false,
      source: 'hotel-miu-board',
    },
  };
}

function splitCells(line) {
  const raw = String(line || '').trim();
  if (!raw) return [];
  if (raw.includes('\t')) return raw.split('\t').map((s) => s.trim()).filter(Boolean);
  if (raw.includes('|')) return raw.split('|').map((s) => s.trim()).filter(Boolean);
  return raw.split(/\s+/).filter(Boolean);
}

function parseLooseLines(lines) {
  const rows = [];
  const logs = [];
  (lines || []).forEach((line, idx) => {
    const text = String(line || '').trim();
    if (!text) return;
    if (/^(품명|품목|item)/i.test(text) && /수량|qty/i.test(text)) return;
    const parts = splitCells(text);
    if (parts.length >= 3 && /^\d+$/.test(parts[0]) && !UNIT_RE.test(parts[1])) parts.shift();
    let qtyIdx = -1;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const n = Number(String(parts[i]).replace(/,/g, ''));
      if (Number.isFinite(n) && n > 0) { qtyIdx = i; break; }
    }
    if (qtyIdx < 0) {
      logs.push(`행 ${idx + 1}: 수량 없음 — ${text}`);
      return;
    }
    const qty = Number(String(parts[qtyIdx]).replace(/,/g, ''));
    const nameParts = parts.slice(0, qtyIdx);
    let unit = '';
    if (nameParts.length && UNIT_RE.test(nameParts[nameParts.length - 1])) {
      unit = nameParts.pop();
    }
    const inputName = nameParts.join(' ').replace(/\s+/g, ' ').trim();
    if (!inputName) return;
    rows.push({
      rowNo: rows.length + 1,
      inputName,
      unit: normalizeImportUnit(unit) || inferImportUnitFromName(inputName),
      qty,
    });
  });
  logs.push(`텍스트 ${rows.length}건`);
  return { rows, logs };
}

export function parseHotelMiuText(text) {
  const lines = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const matrix = lines.map(splitCells);
  const sheet = parseOrderImportSheetRows(matrix, { sourceName: 'paste' });
  if (sheet.rows.length >= Math.max(1, Math.ceil(lines.length * 0.4))) {
    return {
      rows: sheet.rows.map((row) => ({
        ...row,
        unit: normalizeImportUnit(row.unit) || inferImportUnitFromName(row.inputName),
      })),
      logs: sheet.logs,
    };
  }
  return parseLooseLines(lines);
}

export function decorateIntakeRows(parsedRows) {
  return (parsedRows || []).map((row) => ({
    ...row,
    matchName: buildRaumMatchName(row.inputName),
    unit: normalizeImportUnit(row.unit) || inferImportUnitFromName(row.inputName),
  }));
}

export function mergeDraftLines(lines = []) {
  return mergeRegisterItems(lines);
}

export function batchQtyDelta(previousLines = [], nextLines = []) {
  const prev = mergeRegisterItems(previousLines);
  const next = mergeRegisterItems(nextLines);
  const keys = new Set([...prev.map((p) => Number(p.prodKey)), ...next.map((n) => Number(n.prodKey))]);
  const out = [];
  for (const prodKey of keys) {
    const a = prev.find((p) => Number(p.prodKey) === prodKey);
    const b = next.find((p) => Number(p.prodKey) === prodKey);
    const dq = Number(b?.qty || 0) - Number(a?.qty || 0);
    if (Math.abs(dq) < 0.0001) continue;
    out.push({
      prodKey,
      prodName: (b || a).prodName,
      displayName: (b || a).displayName,
      qty: dq,
      unit: (b || a).unit,
    });
  }
  return out;
}

export function rankJamoCandidates(query, products = [], limit = 8) {
  const q = String(query || '').trim();
  if (!q) return [];
  return (products || [])
    .map((prod) => {
      const score = scoreMatch(q, prod, '');
      const jamo = Math.max(
        jamoSimilarity(q, prod.DisplayName || prod.displayName || ''),
        jamoSimilarity(q, prod.ProdName || prod.prodName || ''),
        jamoSimilarity(q, prod.FlowerName || prod.flowerName || ''),
      );
      return { prod, score: score + jamo * 20 };
    })
    .filter((row) => row.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.prod);
}

export function nextBatchNo(existing = []) {
  const max = (existing || []).reduce((m, b) => Math.max(m, Number(b.BatchNo || b.batchNo || 0)), 0);
  return max + 1;
}

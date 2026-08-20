// 호텔+미우 통합게시판 주문입력 — 순수 정책.
// 공통 order-mappings 는 초기값으로만 읽고, 이 게시판에서 고친 매칭은 overlay 가 덮는다.
import { parseOrderImportSheetRows } from './orderImportParse.js';
import { mergeRegisterItems } from './orderImportMatch.js';
import { normalizeImportUnit, inferImportUnitFromName } from './orderImportUnits.js';
import { normalizeOrderUnit } from './orderUtils.js';
import { findMappingFuzzy, normalizeToken } from './parseMappings.js';
import { jamoSimilarity, scoreMatch } from './displayName.js';
import { buildRaumMatchName } from './raumPnlImage.js';

export const HOTEL_MIU_FAVORITE_PAGE = 'hotel-miu-board';
export const HOTEL_MIU_BATCH_DRAFT = 'DRAFT';
export const HOTEL_MIU_BATCH_REGISTERED = 'REGISTERED';
export const HOTEL_MIU_DEFAULT_VENDOR_LABELS = ['라움', '신라', '쵸이문', '미우'];
export const HOTEL_MIU_WEEK_UNTIL = '36-02';
export const HOTEL_MIU_VENDOR_ALIASES = {
  라움: ['트라움에스앤씨', '트라움', '라움'],
  신라: ['신라호텔', '신라'],
  쵸이문: ['쵸이문', '초이문', '최이문'],
  미우: ['미우'],
};

function compactName(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

export function pickHotelMiuCustomer(customers, label) {
  const aliases = HOTEL_MIU_VENDOR_ALIASES[label] || [label];
  let best = null;
  let bestScore = 0;
  for (const raw of customers || []) {
    const custKey = Number(raw.CustKey || raw.custKey);
    const custName = String(raw.CustName || raw.custName || '').trim();
    if (!custKey || !custName) continue;
    const name = compactName(custName);
    let score = 0;
    for (const alias of aliases) {
      const a = compactName(alias);
      if (!a) continue;
      if (name === a) score = Math.max(score, 100);
      else if (name.startsWith(a)) score = Math.max(score, 82);
      else if (name.includes(a)) score = Math.max(score, 70);
    }
    if (label === '미우' && !name.includes('미우')) score = 0;
    if (label === '신라' && name.includes('신라호텔')) score += 15;
    if (label === '라움' && (name.includes('트라움') || name.includes('라움'))) score += 8;
    if (score > bestScore) {
      bestScore = score;
      best = { label, custKey, custName };
    }
  }
  return bestScore >= 70 ? best : null;
}

export function resolveHotelMiuDefaultVendors(customers) {
  return HOTEL_MIU_DEFAULT_VENDOR_LABELS.map((label) => (
    pickHotelMiuCustomer(customers, label) || { label, custKey: null, custName: label, missing: true }
  ));
}

function parseHotelMiuWeek(value, fallbackYear) {
  const m = String(value || '').trim().match(/^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const year = m[1] ? Number(m[1]) : Number(fallbackYear);
  const week = Number(m[2]);
  const seq = Number(m[3]);
  if (!Number.isFinite(year) || year < 2020) return null;
  if (!Number.isFinite(week) || week < 1 || week > 52) return null;
  if (!Number.isFinite(seq) || seq < 1 || seq > 4) return null;
  return { year, week, seq, rank: year * 1000 + week * 10 + seq };
}

export function hotelMiuWeekOptions(currentWeek = '', untilWeek = '') {
  const start = parseHotelMiuWeek(currentWeek, new Date().getFullYear())
    || parseHotelMiuWeek('01-01', new Date().getFullYear());
  let year = start.year;
  let week = start.week;
  let seq = start.seq;
  const until = parseHotelMiuWeek(untilWeek, year);
  const useUntil = until && until.rank >= start.rank;
  const limit = useUntil ? 24 : 4;
  const out = [];
  for (let i = 0; i < limit; i += 1) {
    const ww = String(week).padStart(2, '0');
    const ss = String(seq).padStart(2, '0');
    out.push({
      year: String(year),
      week: `${ww}-${ss}`,
      label: `${ww}-${ss}`,
      isDefault: i === 0,
    });
    if (useUntil && year === until.year && week === until.week && seq === until.seq) break;
    seq += 1;
    if (seq > 4) { seq = 1; week += 1; }
    if (week > 52) { week = 1; year += 1; }
  }
  return out;
}

export function isDraftBatch(batch) {
  return String(batch?.status || batch?.Status || '').toUpperCase() === HOTEL_MIU_BATCH_DRAFT;
}

export function mergeAllBatchLines(batches = []) {
  return mergeRegisterItems((batches || []).flatMap((b) => b.lines || []));
}

export function batchLineTotal(lines = []) {
  return (lines || []).reduce((sum, line) => sum + Number(line.qty || 0), 0);
}

/** 주문등록 확인표: 품목별 합산 수량. */
export function registerPreviewTable(batches = []) {
  const list = (batches || []).filter((b) => (b.lines || []).length);
  const batchNos = list.map((b) => Number(b.batchNo || b.BatchNo || 0));
  const byKey = new Map();
  list.forEach((batch, idx) => {
    const no = batchNos[idx];
    mergeRegisterItems(batch.lines || []).forEach((line) => {
      const key = Number(line.prodKey);
      if (!byKey.has(key)) {
        byKey.set(key, {
          prodKey: key,
          prodName: line.displayName || line.prodName || '',
          unit: line.unit || '',
          byBatch: {},
          total: 0,
        });
      }
      const row = byKey.get(key);
      const qty = Number(line.qty || 0);
      row.byBatch[no] = Number(row.byBatch[no] || 0) + qty;
      row.total += qty;
    });
  });
  return { batchNos, rows: [...byKey.values()] };
}

export function boxFactorForUnit(unit, product = {}) {
  const u = normalizeOrderUnit(unit);
  const s1b = Number(product.SteamOf1Box || product.steamOf1Box || 0);
  const b1b = Number(product.BunchOf1Box || product.bunchOf1Box || 0);
  const s1bunch = Number(product.SteamOf1Bunch || product.steamOf1Bunch || 0);
  if (u === '송이') return s1b > 0 ? s1b : (b1b > 0 && s1bunch > 0 ? b1b * s1bunch : 0);
  if (u === '단') return b1b > 0 ? b1b : 0;
  return 0;
}

/** 합산 수량이 박스 단위로 떨어지지 않으면 반올림/반내림 대상. */
export function boxRoundHint(qty, unit, product = {}) {
  const total = Number(qty || 0);
  const perBox = boxFactorForUnit(unit, product);
  if (!(perBox > 1) || !(total > 0)) {
    return { needsRound: false, perBox: perBox || 0, remainder: 0, floorBoxes: 0, ceilBoxes: 0 };
  }
  const floorBoxes = Math.floor((total + 1e-9) / perBox);
  const remainder = Math.round((total - floorBoxes * perBox) * 1000) / 1000;
  const ceilBoxes = remainder > 0.0001 ? floorBoxes + 1 : floorBoxes;
  return {
    needsRound: remainder > 0.0001,
    perBox,
    remainder,
    floorBoxes,
    ceilBoxes,
  };
}

export function buildRegisterItems(preview, rounds = {}, productsByKey = {}) {
  const getProd = (key) => {
    if (productsByKey instanceof Map) return productsByKey.get(Number(key)) || {};
    return productsByKey[key] || productsByKey[Number(key)] || {};
  };
  return (preview?.rows || []).map((row) => {
    const hint = boxRoundHint(row.total, row.unit, getProd(row.prodKey));
    const round = rounds[row.prodKey] || rounds[String(row.prodKey)];
    if (hint.needsRound && (round === 'up' || round === 'down')) {
      const boxes = round === 'up' ? hint.ceilBoxes : hint.floorBoxes;
      if (boxes <= 0) return null;
      return {
        prodKey: row.prodKey,
        prodName: row.prodName,
        displayName: row.prodName,
        qty: boxes,
        unit: '박스',
      };
    }
    return {
      prodKey: row.prodKey,
      prodName: row.prodName,
      displayName: row.prodName,
      qty: row.total,
      unit: row.unit,
    };
  }).filter(Boolean);
}

function qtyLabel(qty, unit) {
  const n = Number(qty || 0);
  const shown = Number.isInteger(n) ? String(n) : String(n);
  return `${shown}${unit || ''}`;
}

function joinQtyParts(parts = []) {
  const byUnit = new Map();
  for (const p of parts) {
    const u = String(p.unit || '');
    byUnit.set(u, (byUnit.get(u) || 0) + Number(p.qty || 0));
  }
  return [...byUnit.entries()].map(([u, q]) => qtyLabel(q, u)).join(' + ');
}

/** 주문등록 직후 합산 원문 vs 실제 주문수량 스냅샷. */
export function buildRegisterHistory(preview, registerItems = [], rounds = {}) {
  const afterByKey = new Map();
  for (const it of registerItems || []) {
    afterByKey.set(Number(it.prodKey), it);
  }
  return (preview?.rows || []).map((row) => {
    const after = afterByKey.get(Number(row.prodKey));
    const round = rounds[row.prodKey] || rounds[String(row.prodKey)] || '';
    return {
      prodKey: Number(row.prodKey),
      prodName: row.prodName,
      beforeQty: Number(row.total || 0),
      beforeUnit: row.unit || '',
      afterQty: after ? Number(after.qty) : null,
      afterUnit: after ? (after.unit || '') : '',
      excluded: !after,
      round: round === 'up' || round === 'down' ? round : '',
    };
  });
}

export function parseRegisterSnapPayload(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const rows = Array.isArray(v) ? v : v?.rows;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function historyFromRegisteredBatches(batches = []) {
  const preview = registerPreviewTable((batches || []).filter((b) => !isDraftBatch(b)));
  if (!preview.rows.length) return [];
  return [{
    createdAt: null,
    inferred: true,
    rows: preview.rows.map((row) => ({
      prodKey: Number(row.prodKey),
      prodName: row.prodName,
      beforeQty: Number(row.total || 0),
      beforeUnit: row.unit || '',
      afterQty: Number(row.total || 0),
      afterUnit: row.unit || '',
      excluded: false,
      round: '',
    })),
  }];
}

export function summarizeRegisterHistory(snaps = []) {
  const byKey = new Map();
  for (const snap of snaps || []) {
    for (const row of snap.rows || []) {
      const key = Number(row.prodKey);
      if (!byKey.has(key)) {
        byKey.set(key, {
          prodKey: key,
          prodName: row.prodName || '',
          beforeParts: [],
          afterParts: [],
          rounds: new Set(),
          excluded: false,
        });
      }
      const acc = byKey.get(key);
      if (row.prodName) acc.prodName = row.prodName;
      acc.beforeParts.push({ qty: Number(row.beforeQty || 0), unit: row.beforeUnit || '' });
      if (row.excluded || row.afterQty == null) acc.excluded = true;
      else acc.afterParts.push({ qty: Number(row.afterQty), unit: row.afterUnit || '' });
      if (row.round === 'up' || row.round === 'down') acc.rounds.add(row.round);
    }
  }
  return [...byKey.values()].map((row) => {
    const rounds = [...row.rounds];
    let roundLabel = '원문';
    if (rounds.includes('up') && rounds.includes('down')) roundLabel = '반올림·반내림';
    else if (rounds.includes('up')) roundLabel = '반올림';
    else if (rounds.includes('down')) roundLabel = '반내림';
    return {
      prodKey: row.prodKey,
      prodName: row.prodName,
      beforeLabel: joinQtyParts(row.beforeParts),
      afterLabel: row.excluded && !row.afterParts.length ? '제외' : joinQtyParts(row.afterParts),
      roundLabel,
    };
  });
}

export function reapplyItemsFromSnaps(snaps = []) {
  const map = new Map();
  for (const snap of snaps || []) {
    for (const row of snap.rows || []) {
      if (row.excluded || !(Number(row.afterQty) > 0)) continue;
      const key = `${Number(row.prodKey)}|${row.afterUnit || ''}`;
      const prev = map.get(key);
      if (prev) prev.qty += Number(row.afterQty);
      else {
        map.set(key, {
          prodKey: Number(row.prodKey),
          prodName: row.prodName,
          displayName: row.prodName,
          qty: Number(row.afterQty),
          unit: row.afterUnit || '',
        });
      }
    }
  }
  return [...map.values()];
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

export function clipboardLooksLikeOrderText(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  return parseHotelMiuText(raw).rows.length >= 1;
}

export function decorateIntakeRows(parsedRows, { forImage = false } = {}) {
  return (parsedRows || []).map((row) => ({
    ...row,
    ...(forImage ? { matchName: buildRaumMatchName(row.inputName) } : {}),
    unit: normalizeImportUnit(row.unit) || inferImportUnitFromName(row.inputName),
  }));
}

/** 게시판에서 한 번 고른 품목은 공통/이미지 후보보다 우선한다. */
export function applyBoardOverlay(items, overlay, productByKey) {
  const map = overlay || {};
  if (!Object.keys(map).length) return items || [];
  return (items || []).map((it) => {
    const hit = findMappingFuzzy(it.inputName, map)
      || (it.matchName && it.matchName !== it.inputName ? findMappingFuzzy(it.matchName, map) : null);
    const prodKey = Number(hit?.value?.prodKey);
    if (!prodKey) return it;
    const prod = productByKey?.get?.(prodKey);
    return {
      ...it,
      prodKey,
      prodName: prod?.ProdName || hit.value.prodName || it.prodName,
      displayName: prod?.DisplayName || hit.value.displayName || it.displayName,
      flowerName: prod?.FlowerName || hit.value.flowerName || it.flowerName,
      counName: prod?.CounName || hit.value.counName || it.counName,
      fromMapping: true,
      mappingMatchType: hit.matchType,
      mappingMatchKey: hit.key,
    };
  });
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

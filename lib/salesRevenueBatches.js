// lib/salesRevenueBatches.js
// 영업매출관리 — 이카운트 read-only 조회 결과를 네노바웹 비교용 저장소에 보관.
//
// 절대 기준:
// - 이 저장소는 네노바웹 비교 전용이다. 이카운트 원본/주문/출고/재고 테이블을 건드리지 않는다.
// - 이카운트로의 쓰기/전송(push)은 여기서 절대 하지 않는다. (조회 결과 보관만)
// - 저장 위치는 data/sales-revenue-batches.json (런타임 파일, gitignore).
//
// 매핑 적용은 "조회 시점"이 아니라 "읽는 시점"에 동적으로 한다.
// → 사용자가 새 매핑을 확정 저장하면 이카운트 재호출 없이 다음 조회/요약부터 자동 반영된다.

import fs from 'fs';
import path from 'path';
import { BASE_CUSTOMERS, COMPARE_WEEKS, BUILT_IN_ALIASES } from './salesRevenueConfig';
import {
  loadSalesRevenueMappings,
  normalizeRevenueCustomerName,
} from './salesRevenueMappings';
import { loadCellSeed, loadCellOverrides, parseCellKey } from './salesRevenueCells';

const FILE = path.join(process.cwd(), 'data', 'sales-revenue-batches.json');

let _cache = null;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadStore(forceRefresh = false) {
  if (_cache && !forceRefresh) return _cache;
  try {
    ensureDir();
    _cache = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  } catch {
    _cache = {};
  }
  return _cache;
}

function writeStore(store) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2), 'utf8');
  _cache = store;
}

export function batchKeyOf(salesYear, orderWeek, channel) {
  return [
    String(salesYear || '').trim(),
    String(orderWeek || '').trim(),
    String(channel || '').trim(),
  ].join('::');
}

export function getBatch(salesYear, orderWeek, channel) {
  const store = loadStore();
  return store[batchKeyOf(salesYear, orderWeek, channel)] || null;
}

export function listBatches() {
  return Object.values(loadStore());
}

// 이카운트 조회 결과(정규화된 raw 행 배열)를 한 Batch로 저장한다.
export function saveBatch(meta, rawRows) {
  const store = loadStore(true);
  const key = batchKeyOf(meta.salesYear, meta.orderWeek, meta.channel);
  const raw = (rawRows || []).map((r, i) => ({
    rawKey: i + 1,
    ecountDateNo: r.ecountDateNo || '',
    ecountCustName: r.ecountCustName || '',
    productName: r.productName || '',
    quantity: Number(r.quantity || 0),
    unitPriceVatIncluded: Number(r.unitPriceVatIncluded || 0),
    supplyAmount: Number(r.supplyAmount || 0),
    vat: Number(r.vat || 0),
    totalAmount: Number(r.totalAmount || 0),
    remark: r.remark || '',
  }));

  store[key] = {
    batchKey: key,
    sourceType: meta.sourceType || 'ecount_api',
    salesYear: String(meta.salesYear || ''),
    orderWeek: String(meta.orderWeek || ''),
    channel: String(meta.channel || ''),
    dateFrom: meta.dateFrom || '',
    dateTo: meta.dateTo || '',
    fetchedBy: meta.fetchedBy || '',
    fetchedDtm: new Date().toISOString(),
    ecountEndpoint: meta.ecountEndpoint || '',
    ecountRequestHash: meta.ecountRequestHash || '',
    ecountResponseHash: meta.ecountResponseHash || '',
    apiStatus: meta.apiStatus || 'success',
    memo: meta.memo || '',
    rawCount: raw.length,
    rawTotal: raw.reduce((s, r) => s + r.totalAmount, 0),
    raw,
  };
  writeStore(store);
  return store[key];
}

// ── 매핑 적용 ───────────────────────────────────────────────
// 우선순위: 1) 사용자 확정 매핑  2) 내장 후보(BUILT_IN_ALIASES)  3) 원본 거래처명 그대로
let _builtInByToken = null;
function builtInByToken() {
  if (_builtInByToken) return _builtInByToken;
  _builtInByToken = {};
  for (const [ecountName, canonical] of Object.entries(BUILT_IN_ALIASES)) {
    const token = normalizeRevenueCustomerName(ecountName);
    if (token) _builtInByToken[token] = canonical;
  }
  return _builtInByToken;
}

export function resolveCanonical(ecountName, mappings) {
  const token = normalizeRevenueCustomerName(ecountName);
  const saved = mappings ? mappings[token] : null;
  if (saved?.canonicalName) {
    return {
      canonicalName: saved.canonicalName,
      mappingStatus: '확정',
      custKey: saved.custKey || null,
      custName: saved.custName || '',
      token,
    };
  }
  const builtIn = builtInByToken()[token] || BUILT_IN_ALIASES[ecountName];
  if (builtIn) {
    return { canonicalName: builtIn, mappingStatus: '후보', custKey: null, custName: '', token };
  }
  return { canonicalName: ecountName, mappingStatus: '미매칭', custKey: null, custName: '', token };
}

// 한 Batch의 raw 행에 매핑을 적용해 화면용 행으로 변환
export function viewBatchRaw(batch, mappings = null) {
  if (!batch) return { meta: null, raw: [], review: [], totals: emptyTotals() };
  const maps = mappings || loadSalesRevenueMappings();
  const raw = (batch.raw || []).map(r => {
    const m = resolveCanonical(r.ecountCustName, maps);
    return { ...r, canonicalName: m.canonicalName, mappingStatus: m.mappingStatus };
  });

  const totals = emptyTotals();
  for (const r of raw) {
    totals.rawTotal += r.totalAmount;
    if (r.mappingStatus === '미매칭') {
      totals.unmatchedAmount += r.totalAmount;
      totals.unmatchedCount += 1;
    } else if (r.mappingStatus === '후보') {
      totals.candidateAmount += r.totalAmount;
      totals.candidateCount += 1;
    } else {
      totals.matchedAmount += r.totalAmount;
      totals.matchedCount += 1;
    }
  }

  // 미매칭/후보 거래처명 단위로 묶어 검토 리스트 구성
  const reviewMap = new Map();
  for (const r of raw) {
    if (r.mappingStatus === '확정') continue;
    const k = r.ecountCustName;
    if (!reviewMap.has(k)) {
      reviewMap.set(k, {
        ecountName: r.ecountCustName,
        canonicalName: r.canonicalName,
        status: r.mappingStatus,
        amount: 0,
        products: new Set(),
      });
    }
    const item = reviewMap.get(k);
    item.amount += r.totalAmount;
    if (r.productName) item.products.add(r.productName);
  }
  const review = Array.from(reviewMap.values())
    .map(x => ({ ...x, products: Array.from(x.products) }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === '미매칭' ? -1 : 1;
      return b.amount - a.amount;
    });

  const meta = { ...batch };
  delete meta.raw;
  return { meta, raw, review, totals };
}

function emptyTotals() {
  return {
    rawTotal: 0,
    matchedAmount: 0,
    matchedCount: 0,
    candidateAmount: 0,
    candidateCount: 0,
    unmatchedAmount: 0,
    unmatchedCount: 0,
  };
}

// ── 비교표 요약 ─────────────────────────────────────────────
// 저장된 모든 Batch를 (통용명, 차수, 연도) 기준으로 합산해 매출비교표를 만든다.
// 표는 항상 BASE_CUSTOMERS 전체 행을 유지하고, 저장 데이터가 있는 업체만 금액이 채워진다.
export function buildSummary({ channel = null, mappings = null } = {}) {
  const maps = mappings || loadSalesRevenueMappings();
  const allCh = !channel || channel === '전체';
  const batches = listBatches().filter(b => allCh || b.channel === channel);

  // rows[canonical] = { weeks: { [week]: { [year]: {total, supply, vat, count, source, locked, conflict} } }, sourceNames:Set, status }
  const rows = new Map();
  const ensureRow = (canonical) => {
    if (!rows.has(canonical)) {
      rows.set(canonical, { canonicalName: canonical, weeks: {}, sourceNames: new Set(), status: '' });
    }
    return rows.get(canonical);
  };
  const ensureCell = (row, week, year) => {
    row.weeks[week] = row.weeks[week] || {};
    if (!row.weeks[week][year]) {
      row.weeks[week][year] = { total: 0, supply: 0, vat: 0, count: 0, source: null, locked: false, conflict: false };
    }
    return row.weeks[week][year];
  };
  // 기본 업체 행을 먼저 깐다.
  for (const name of BASE_CUSTOMERS) ensureRow(name);

  const totals = emptyTotals();
  const weeksSeen = new Set();
  const yearsSeen = new Set();

  // 1) ECOUNT 업로드 live 집계 (raw + 현재 매핑)
  for (const batch of batches) {
    const week = String(batch.orderWeek);
    const year = String(batch.salesYear);
    weeksSeen.add(week);
    yearsSeen.add(year);
    for (const r of batch.raw || []) {
      const m = resolveCanonical(r.ecountCustName, maps);
      const row = ensureRow(m.canonicalName);
      const cell = ensureCell(row, week, year);
      cell.total += r.totalAmount;
      cell.supply += r.supplyAmount;
      cell.vat += r.vat;
      cell.count += 1;
      cell.source = 'ecount';
      row.sourceNames.add(r.ecountCustName);

      if (m.mappingStatus === '미매칭') row.status = '미매칭';
      else if (m.mappingStatus === '후보' && row.status !== '미매칭') row.status = '후보';
      else if (m.mappingStatus === '확정' && !row.status) row.status = '확정';

      totals.rawTotal += r.totalAmount;
      if (m.mappingStatus === '미매칭') { totals.unmatchedAmount += r.totalAmount; totals.unmatchedCount += 1; }
      else if (m.mappingStatus === '후보') { totals.candidateAmount += r.totalAmount; totals.candidateCount += 1; }
      else { totals.matchedAmount += r.totalAmount; totals.matchedCount += 1; }
    }
  }

  // 2) 과거 시드 (매출비교.xlsx) — ECOUNT 값이 없는 칸만 채운다 (과거 데이터 영구 보존)
  const seed = loadCellSeed();
  for (const [key, amount] of Object.entries(seed)) {
    const { channel: ch, canonicalName, week, year } = parseCellKey(key);
    if (!allCh && ch !== channel) continue;
    const row = ensureRow(canonicalName);
    weeksSeen.add(week); yearsSeen.add(year);
    const existing = row.weeks[week]?.[year];
    if (existing && existing.source === 'ecount') continue; // ECOUNT 우선
    const cell = ensureCell(row, week, year);
    cell.total = amount;
    cell.source = 'history';
  }

  // 3) 수동 수정 override — 항상 우선(locked), ECOUNT가 덮지 못함
  const overrides = loadCellOverrides();
  for (const [key, ov] of Object.entries(overrides)) {
    const { channel: ch, canonicalName, week, year } = parseCellKey(key);
    if (!allCh && ch !== channel) continue;
    const row = ensureRow(canonicalName);
    weeksSeen.add(week); yearsSeen.add(year);
    const cell = ensureCell(row, week, year);
    if (cell.source === 'ecount' && cell.total !== ov.amount) cell.conflict = true;
    cell.total = ov.amount;
    cell.source = 'manual';
    cell.locked = true;
    cell.updatedBy = ov.updatedBy || '';
    cell.updatedAt = ov.updatedAt || '';
  }

  // 표시 차수: 데이터에 있는 차수 ∪ 기본 비교 차수, 숫자 오름차순
  const weeks = Array.from(new Set([...weeksSeen, ...COMPARE_WEEKS]))
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b));

  const baseSet = new Set(BASE_CUSTOMERS);
  const customers = Array.from(rows.values())
    .map(row => ({
      canonicalName: row.canonicalName,
      isBase: baseSet.has(row.canonicalName),
      weeks: row.weeks,
      sourceNames: Array.from(row.sourceNames),
      status: row.status,
    }))
    .sort((a, b) => {
      if (a.isBase !== b.isBase) return a.isBase ? -1 : 1;
      if (a.isBase) return BASE_CUSTOMERS.indexOf(a.canonicalName) - BASE_CUSTOMERS.indexOf(b.canonicalName);
      return a.canonicalName.localeCompare(b.canonicalName, 'ko');
    });

  return {
    channel: channel || '전체',
    weeks,
    availableYears: Array.from(yearsSeen).sort(),
    customers,
    totals,
    batchCount: batches.length,
  };
}

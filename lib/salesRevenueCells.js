// lib/salesRevenueCells.js
// 영업매출 비교표의 "셀 값" 저장소 — 과거 수기 데이터(매출비교.xlsx 시드) + 수동 수정값 + 수정 이력.
//
// 셀 키: `${channel}::${canonicalName}::${week}::${year}`
//
// 값 우선순위(비교표 표시): 수동수정(override, locked) > ECOUNT 업로드 집계(live) > 과거 시드(seed)
//   - 과거 데이터는 시드로 영구 보존되고, ECOUNT 업로드는 새 (연도·차수) 칸만 채운다.
//   - 사용자가 수정한 칸은 override(locked)로 보호되어 ECOUNT 집계가 덮지 않는다.
//   - 모든 수정은 이력(수정자/시각/이전→이후)에 남는다.
//
// 저장 파일:
//   - data/sales-revenue-history-seed.json   (커밋됨, 읽기전용 baseline)
//   - data/sales-revenue-cells.json          (런타임, 수동수정 override)
//   - data/sales-revenue-cell-history.json   (런타임, 수정 이력 로그)

import fs from 'fs';
import path from 'path';

const SEED_FILE = path.join(process.cwd(), 'data', 'sales-revenue-history-seed.json');
const OVERRIDE_FILE = path.join(process.cwd(), 'data', 'sales-revenue-cells.json');
const HISTORY_FILE = path.join(process.cwd(), 'data', 'sales-revenue-cell-history.json');

let _seed = null;
let _override = null;
let _history = null;

function ensureDir() {
  const dir = path.dirname(OVERRIDE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback;
  }
}

export function loadCellSeed() {
  if (_seed) return _seed;
  _seed = readJson(SEED_FILE, {});
  return _seed;
}

export function loadCellOverrides(force = false) {
  if (_override && !force) return _override;
  _override = readJson(OVERRIDE_FILE, {});
  return _override;
}

export function loadCellHistory(force = false) {
  if (_history && !force) return _history;
  _history = readJson(HISTORY_FILE, []);
  return _history;
}

export function cellKey(channel, canonicalName, week, year) {
  return `${channel}::${canonicalName}::${week}::${year}`;
}

export function parseCellKey(key) {
  const [channel, canonicalName, week, year] = String(key).split('::');
  return { channel, canonicalName, week, year };
}

// 사용자 수동 수정 — override(locked) 저장 + 이력 기록
export function editCell({ channel, canonicalName, week, year, amount, prev, by, note }) {
  if (!channel || !canonicalName || !week || !year) {
    return { saved: false, reason: 'missing-key' };
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt)) return { saved: false, reason: 'invalid-amount' };

  const key = cellKey(channel, canonicalName, String(week), String(year));
  const overrides = loadCellOverrides(true);
  const history = loadCellHistory(true);

  const prevAmount = prev !== undefined && prev !== null && prev !== ''
    ? Number(prev)
    : (overrides[key]?.amount ?? loadCellSeed()[key] ?? null);

  const at = new Date().toISOString();
  overrides[key] = {
    amount: amt,
    source: 'manual',
    locked: true,
    updatedBy: by || '',
    updatedAt: at,
    note: note || '',
  };

  history.unshift({
    key,
    channel,
    canonicalName,
    week: String(week),
    year: String(year),
    prev: prevAmount,
    next: amt,
    by: by || '',
    at,
    action: 'edit',
  });

  try {
    ensureDir();
    fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(overrides, null, 2), 'utf8');
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, 5000), null, 2), 'utf8');
    _override = overrides;
    _history = history;
    return { saved: true, key, cell: overrides[key] };
  } catch (e) {
    return { saved: false, reason: 'write-error', error: e.message };
  }
}

// 특정 셀의 수정 이력 (최신순)
export function listCellHistory(key) {
  return loadCellHistory().filter(h => h.key === key);
}

// 전체 수정 이력 (최신순, limit)
export function recentCellHistory(limit = 200) {
  return loadCellHistory().slice(0, limit);
}

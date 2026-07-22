// lib/orderImportUnits.js — 업로드 발주 품목명별 단위 학습 (엑셀 → 이미지 공유)

import fs from 'fs';
import path from 'path';
import { normalizeToken, findMappingFuzzy } from './parseMappings.js';
import { normalizeOrderUnit } from './orderUtils.js';

const FILE = path.join(process.cwd(), 'data', 'order-import-units.json');

let _cache = null;

function ensureDir() {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadImportUnits(forceRefresh = false) {
  if (_cache && !forceRefresh) return _cache;
  try {
    ensureDir();
    if (fs.existsSync(FILE)) {
      _cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } else {
      _cache = {};
    }
  } catch {
    _cache = {};
  }
  return _cache;
}

/** 라움/네노바 발주표 단위 → ERP 단위 */
export function normalizeImportUnit(unit) {
  const raw = String(unit || '').trim();
  if (!raw) return '';
  if (raw === '박스' || raw === '단' || raw === '송이') return raw;

  const lower = raw.toLowerCase();
  if (raw === '대') return '박스';
  if (/(stem|steam|stems|송이|스템|스팀|ea)/i.test(lower)) return '송이';
  if (/(bunch|bun|^단$)/i.test(lower) || raw === '단') return '단';
  if (/(box|박스|박)/i.test(lower)) return '박스';

  return normalizeOrderUnit(raw, '');
}

/** 엑셀에 단위 열이 없을 때 품목명 패턴으로 추론 */
export function inferImportUnitFromName(inputName) {
  const name = String(inputName || '').trim();
  if (!name) return '';

  if (/페탈|꽃잎/i.test(name)) return '송이';
  if (/^(수국|호접)\b|수국\s|호접\s/.test(name)) return '박스';
  if (/장미/i.test(name)) return '단';
  if (/알스트로/i.test(name)) return '단';
  if (/카네이션|튤립|안개|피오니|제임스/i.test(name)) return '단';

  return '';
}

export function findImportUnit(inputName, catalog) {
  if (!inputName) return null;
  const map = catalog || loadImportUnits();
  const key = normalizeToken(inputName);
  if (map[key]?.unit) {
    return { unit: normalizeImportUnit(map[key].unit), key, matchType: 'exact' };
  }

  const fuzzy = findMappingFuzzy(inputName, map);
  if (fuzzy?.value?.unit) {
    return {
      unit: normalizeImportUnit(fuzzy.value.unit),
      key: fuzzy.key,
      matchType: fuzzy.matchType || 'fuzzy',
    };
  }
  return null;
}

export function saveImportUnit(inputName, unit, { source = 'excel' } = {}) {
  const key = normalizeToken(inputName);
  const normalized = normalizeImportUnit(unit);
  if (!key || !normalized) return { saved: false, reason: 'empty' };

  const cache = loadImportUnits();
  cache[key] = {
    unit: normalized,
    inputName: String(inputName).trim(),
    source,
    savedAt: new Date().toISOString(),
  };
  _cache = cache;
  try {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
    return { saved: true, key, unit: normalized };
  } catch (e) {
    return { saved: false, reason: e.message };
  }
}

/** 엑셀 파싱 rows에서 품목명→단위 일괄 학습 */
export function learnUnitsFromRows(rows, { source = 'excel' } = {}) {
  const learned = [];
  for (const row of rows || []) {
    const unit = normalizeImportUnit(row.unit);
    if (!row.inputName || !unit) continue;
    const r = saveImportUnit(row.inputName, unit, { source });
    if (r.saved) learned.push({ inputName: row.inputName, unit: r.unit });
  }
  return learned;
}

/**
 * 업로드 주문 단위 결정
 * 우선순위: ① 업로드 원본 단위 ② 학습 catalog ③ mapping.unit ④ 품목명 추론 ⑤ ERP defaultUnit
 */
export function resolveImportUnit(prod, inputName, {
  sourceUnit = '',
  savedMappingUnit = '',
  unitCatalog = null,
  prodUnitMap = {},
} = {}) {
  const fromSource = normalizeImportUnit(sourceUnit);
  if (fromSource) {
    return { unit: fromSource, unitSource: 'upload', unitMatchType: 'explicit' };
  }

  const fromCatalog = findImportUnit(inputName, unitCatalog);
  if (fromCatalog?.unit) {
    return {
      unit: fromCatalog.unit,
      unitSource: 'catalog',
      unitMatchType: fromCatalog.matchType,
      unitCatalogKey: fromCatalog.key,
    };
  }

  const fromMapping = normalizeImportUnit(savedMappingUnit);
  if (fromMapping) {
    return { unit: fromMapping, unitSource: 'mapping', unitMatchType: 'saved' };
  }

  const inferred = inferImportUnitFromName(inputName);
  if (inferred) {
    return { unit: inferred, unitSource: 'inferred', unitMatchType: 'pattern' };
  }

  if (prod?.OutUnit) {
    return {
      unit: normalizeOrderUnit(prod.OutUnit, '박스'),
      unitSource: 'product',
      unitMatchType: 'outUnit',
    };
  }
  if (prod?.ProdKey && prodUnitMap[prod.ProdKey]) {
    return {
      unit: normalizeOrderUnit(prodUnitMap[prod.ProdKey], '박스'),
      unitSource: 'history',
      unitMatchType: 'orderHistory',
    };
  }

  return { unit: '박스', unitSource: 'default', unitMatchType: 'fallback' };
}

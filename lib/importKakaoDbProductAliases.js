import { canonicalImportCountry } from './importToolsDisplay.js';

export const KAKAO_DB_PRODUCT_ALIASES_KEY = 'kakao.db-product-aliases';
export const KAKAO_DB_PRODUCT_ALIASES_STORAGE_KEY = 'nenova.kakao-db-prod-aliases.v1';

const MAX_ALIASES = 5000;
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const clean = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function normalizeAliasCountry(rawCountry) {
  const s = clean(rawCountry);
  if (!s || s === '*' || s === '전체' || s === '미상' || s === '국가 미상' || s === '일반') return '';
  const canonical = canonicalImportCountry(s);
  return clean(canonical || s);
}

export function normalizeAliasProductKey(rawProduct) {
  const s = clean(rawProduct);
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/(\d{2,3})\s+cm\b/g, '$1cm')
    .replace(/\bsel(?:ect)?\.?\b/g, 'select')
    .replace(/\bstd\.?\b/g, 'standard')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildKakaoProductAliasId(country, product) {
  const prodKey = normalizeAliasProductKey(product);
  if (!prodKey) return '';
  const normCountry = normalizeAliasCountry(country);
  return `${normCountry || '*'}::${prodKey}`;
}

export function sanitizeKakaoProductAliasEntry(raw = {}, fallbackAliasId = '') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('품목 영문 매칭 항목 형식을 확인하세요.');
  }
  const product = clean(raw.product || '');
  const dbProdName = clean(raw.dbProdName || '');
  if (!product || product.length > 160 || CONTROL_CHAR_RE.test(product)) {
    throw fail('카톡 품목명을 확인하세요.');
  }
  if (!dbProdName || dbProdName.length > 200 || CONTROL_CHAR_RE.test(dbProdName)) {
    throw fail('지정할 DB 영문 품목명을 입력하세요.');
  }
  const country = normalizeAliasCountry(raw.country || '');
  if (country.length > 40 || CONTROL_CHAR_RE.test(country)) {
    throw fail('국가명을 확인하세요.');
  }
  const productKey = normalizeAliasProductKey(product);
  const aliasId = buildKakaoProductAliasId(country, product) || clean(fallbackAliasId);
  if (!productKey || !aliasId) {
    throw fail('품목 매칭 키를 생성할 수 없습니다.');
  }
  const rawKey = raw.dbProdKey;
  let dbProdKey = null;
  if (rawKey !== null && rawKey !== undefined && rawKey !== '') {
    const num = Number(rawKey);
    if (!Number.isSafeInteger(num) || num <= 0) {
      throw fail('DB 품목 번호(ProdKey) 형식을 확인하세요.');
    }
    dbProdKey = num;
  }
  const updatedAt = clean(raw.updatedAt) && Number.isFinite(Date.parse(raw.updatedAt))
    ? new Date(raw.updatedAt).toISOString()
    : new Date().toISOString();
  const updatedBy = clean(raw.updatedBy || '').slice(0, 80);
  const isCustom = Boolean(raw.isCustom || !dbProdKey);

  return {
    aliasId,
    country,
    product,
    productKey,
    dbProdName,
    dbProdKey,
    isCustom,
    updatedAt,
    ...(updatedBy ? { updatedBy } : {}),
  };
}

export function validateKakaoDbProductAliases(value) {
  if (value === null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('카톡 DB 품목 매칭 저장소 형식을 확인하세요.');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_ALIASES) {
    throw fail(`카톡 DB 품목 매칭은 최대 ${MAX_ALIASES}건까지 저장할 수 있습니다.`);
  }
  for (const [key, entry] of entries) {
    if (!key || key.length > 240 || CONTROL_CHAR_RE.test(key)) {
      throw fail('카톡 DB 품목 매칭 키 형식을 확인하세요.');
    }
    const sanitized = sanitizeKakaoProductAliasEntry(entry, key);
    if (sanitized.aliasId !== key) {
      throw fail('카톡 DB 품목 매칭 키와 항목 내용이 일치하지 않습니다.');
    }
  }
}

export function normalizeKakaoProductAliasMap(rawMap) {
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};
  const out = {};
  for (const [k, rawEntry] of Object.entries(rawMap)) {
    try {
      const sanitized = sanitizeKakaoProductAliasEntry(rawEntry, k);
      out[sanitized.aliasId] = sanitized;
    } catch {
      // Ignore malformed legacy/local entries gracefully during read normalization
    }
  }
  return out;
}

export function upsertKakaoProductAliasMap(currentMap, rawEntry) {
  const base = normalizeKakaoProductAliasMap(currentMap);
  const entry = sanitizeKakaoProductAliasEntry(rawEntry);
  return {
    ...base,
    [entry.aliasId]: entry,
  };
}

export function removeKakaoProductAliasMap(currentMap, { aliasId = '', country = '', product = '' } = {}) {
  const base = normalizeKakaoProductAliasMap(currentMap);
  const targetId = clean(aliasId) || buildKakaoProductAliasId(country, product);
  if (!targetId) return base;
  const next = { ...base };
  delete next[targetId];
  // If resetting for a specific country+product and a wildcard entry also exists for the exact same productKey, keep country-scoped behavior clean:
  const prodKey = normalizeAliasProductKey(product);
  if (!clean(aliasId) && !normalizeAliasCountry(country) && prodKey) {
    delete next[`*::${prodKey}`];
  }
  return next;
}

export function mergeKakaoProductAliasMaps(serverMap, localMap) {
  const serverNorm = normalizeKakaoProductAliasMap(serverMap);
  const localNorm = normalizeKakaoProductAliasMap(localMap);
  const merged = { ...serverNorm };
  let changed = false;
  for (const [aliasId, localEntry] of Object.entries(localNorm)) {
    const existing = merged[aliasId];
    if (!existing) {
      merged[aliasId] = localEntry;
      changed = true;
      continue;
    }
    const existingTime = Date.parse(existing.updatedAt || '') || 0;
    const localTime = Date.parse(localEntry.updatedAt || '') || 0;
    if (
      localTime > existingTime &&
      (existing.dbProdName !== localEntry.dbProdName || existing.dbProdKey !== localEntry.dbProdKey)
    ) {
      merged[aliasId] = localEntry;
      changed = true;
    }
  }
  return { merged, changed };
}

export function resolveKakaoProductAlias(aliasesMap, item = {}) {
  if (!aliasesMap || typeof aliasesMap !== 'object') return null;
  const product = clean(item.product || '');
  const prodKey = normalizeAliasProductKey(product);
  if (!prodKey) return null;
  const country = normalizeAliasCountry(item.country || '');

  if (country) {
    const exactHit = aliasesMap[`${country}::${prodKey}`];
    if (exactHit && clean(exactHit.dbProdName)) return exactHit;
  }
  const wildcardHit = aliasesMap[`*::${prodKey}`];
  if (wildcardHit && clean(wildcardHit.dbProdName)) return wildcardHit;

  if (!country) {
    const suffix = `::${prodKey}`;
    const matches = Object.entries(aliasesMap)
      .filter(([k, v]) => k.endsWith(suffix) && v && clean(v.dbProdName))
      .map(([, v]) => v);
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export function kakaoDbProductAliasChanges(before, after) {
  const prev = normalizeKakaoProductAliasMap(before);
  const next = normalizeKakaoProductAliasMap(after);
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const changes = [];
  for (const k of keys) {
    const a = prev[k];
    const b = next[k];
    if (!a && b) {
      changes.push({
        field: `${b.country || '공통'}:${b.product}`.slice(0, 80),
        from: null,
        to: b.dbProdName.slice(0, 80),
      });
    } else if (a && !b) {
      changes.push({
        field: `${a.country || '공통'}:${a.product}`.slice(0, 80),
        from: a.dbProdName.slice(0, 80),
        to: null,
      });
    } else if (a && b && (a.dbProdName !== b.dbProdName || a.dbProdKey !== b.dbProdKey)) {
      changes.push({
        field: `${b.country || '공통'}:${b.product}`.slice(0, 80),
        from: a.dbProdName.slice(0, 80),
        to: b.dbProdName.slice(0, 80),
      });
    }
    if (changes.length >= 25) break;
  }
  return changes;
}

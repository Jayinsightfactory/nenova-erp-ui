// lib/pasteLocalMapping.js
// 붙여넣기 매칭 보조 — parse-paste 가 못 잡은 항목을 저장된 매핑(서버 /api/orders/mappings,
//  customer-mappings)으로 재매칭하는 클라이언트 폴백. parse-paste.js 와 동일 거부 규칙을 적용한다.

export const FALLBACK_THRESHOLD = 5;

export function normalizePasteToken(inputName) {
  return (inputName || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\b(add|cancel|delete|box|bunch|stem|stems|cm|ea)\b/gi, ' ')
    .replace(/(추가|취소|삭제|출고|입고|변경사항|변경|오늘|일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, ' ')
    .replace(/\d+(\.\d+)?\s*(박스|단|송이|개|box|bunch|stem|stems|cm|ea)?/gi, ' ')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenParts(s) {
  return normalizePasteToken(s).split(/\s+/).filter(t => t.length >= 2);
}

// 품목 매핑 찾기 (정확 → compact → 토큰부분집합 fuzzy)
export function findLocalMapping(inputName, cache) {
  const exact = normalizePasteToken(inputName);
  if (cache && cache[exact]) return cache[exact];
  const compactExact = exact.replace(/\s+/g, '');
  for (const [key, value] of Object.entries(cache || {})) {
    const compactKey = normalizePasteToken(key).replace(/\s+/g, '');
    if (compactKey && compactKey === compactExact) return value;
  }
  const inputTokens = tokenParts(inputName);
  if (inputTokens.length === 0) return null;
  const hits = [];
  Object.entries(cache || {}).forEach(([key, value]) => {
    const keyTokens = tokenParts(key);
    if (keyTokens.length === 0) return;
    const allIn = inputTokens.every(t => keyTokens.some(k =>
      t === k || (t.length >= 4 && k.length >= 4 && (t.includes(k) || k.includes(t)))
    ));
    if (allIn) hits.push({ key, value, score: inputTokens.length / Math.max(inputTokens.length, keyTokens.length) });
  });
  hits.sort((a, b) => b.score - a.score);
  return hits[0]?.value || null;
}

/** findLocalMapping + 매칭된 cache 키 (legacy auto-fallback 판별용) */
export function findLocalMappingWithKey(inputName, cache) {
  const exact = normalizePasteToken(inputName);
  if (cache?.[exact]) return { key: exact, value: cache[exact] };
  const compactExact = exact.replace(/\s+/g, '');
  for (const [key, value] of Object.entries(cache || {})) {
    const compactKey = normalizePasteToken(key).replace(/\s+/g, '');
    if (compactKey && compactKey === compactExact) return { key, value };
  }
  const inputTokens = tokenParts(inputName);
  if (inputTokens.length === 0) return null;
  const hits = [];
  Object.entries(cache || {}).forEach(([key, value]) => {
    const keyTokens = tokenParts(key);
    if (keyTokens.length === 0) return;
    const allIn = inputTokens.every(t => keyTokens.some(k =>
      t === k || (t.length >= 4 && k.length >= 4 && (t.includes(k) || k.includes(t)))
    ));
    if (allIn) hits.push({ key, value, score: inputTokens.length / Math.max(inputTokens.length, keyTokens.length) });
  });
  hits.sort((a, b) => b.score - a.score);
  if (!hits[0]) return null;
  return { key: hits[0].key, value: hits[0].value };
}

export function mappingCountForProdKey(cache, prodKey, excludeKey = null) {
  let count = 0;
  for (const [k, v] of Object.entries(cache || {})) {
    if (excludeKey && k === excludeKey) continue;
    if (Number(v?.prodKey) === Number(prodKey)) count += 1;
  }
  return count;
}

export function isMixBoxName(prod) {
  const text = `${prod?.ProdName || ''} ${prod?.DisplayName || ''}`.toLowerCase();
  return /믹스\s*박스|mix\s*box|mixbox/.test(text);
}

export function inputWantsMixBox(inputName) {
  return /믹스\s*박스|믹스|mix\s*box|mixbox|mixed/i.test(String(inputName || ''));
}

export function isMixBoxMismatch(inputName, prod) {
  return isMixBoxName(prod) && !inputWantsMixBox(inputName);
}

export function isFreightOrChargeProduct(prod) {
  const text = `${prod?.ProdName || ''} ${prod?.DisplayName || ''}`.toLowerCase();
  return /운송료|운송비|항공료|항공비|freight|shipping|charge/.test(text);
}

export function inputWantsFreight(inputName) {
  return /운송료|운송비|항공료|항공비|freight|shipping|charge/i.test(String(inputName || ''));
}

export function isFreightMismatch(inputName, prod) {
  return isFreightOrChargeProduct(prod) && !inputWantsFreight(inputName);
}

/** parse-paste legacyFallbackMapping 과 동일: auto=true + prodKey 과다매핑 */
export function isLegacyAutoFallback(cache, mappingKey, hit) {
  if (!hit?.prodKey || hit.auto !== true) return false;
  return mappingCountForProdKey(cache, hit.prodKey, mappingKey) >= FALLBACK_THRESHOLD;
}

/**
 * 저장 매핑을 품목에 적용해도 되는지 — parse-paste 와 동일 기준
 * @returns {{ ok: boolean, hit?: object, mappingKey?: string }}
 */
export function resolveCachedProductMapping(inputName, cache, products, item = {}) {
  if (item.prodKey || item.ambiguousCountry || item.fallbackSuspect) {
    return { ok: false };
  }
  const found = findLocalMappingWithKey(inputName, cache);
  if (!found?.value?.prodKey) return { ok: false };
  const prod = (products || []).find(p => Number(p.ProdKey) === Number(found.value.prodKey))
    || (found.value.prodKey ? {
      ProdKey: found.value.prodKey,
      ProdName: found.value.prodName,
      DisplayName: found.value.displayName,
      CounName: found.value.counName,
      FlowerName: found.value.flowerName,
    } : null);
  if (!prod) return { ok: false };
  if (isMixBoxMismatch(inputName, prod)) return { ok: false };
  if (isFreightMismatch(inputName, prod)) return { ok: false };
  if (isLegacyAutoFallback(cache, found.key, found.value)) return { ok: false };
  return { ok: true, hit: found.value, mappingKey: found.key, prod };
}

/** 저장 매칭 hit (없으면 null) — 재분석 시 Claude prodKey 보다 우선 적용용 */
export function lookupSavedProductMapping(inputName, cache, products) {
  return resolveCachedProductMapping(inputName, cache, products, {
    prodKey: null,
    ambiguousCountry: false,
    fallbackSuspect: false,
  });
}

function customerToken(inputName) {
  return (inputName || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/(추가|취소|삭제|출고|입고|변경사항|변경|오늘|일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, ' ')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

// 거래처 매핑 찾기 (정규화 compact 일치 / 포함)
export function findCustomerLocalMapping(inputName, cache) {
  const key = customerToken(inputName);
  if (!key) return null;
  if (cache && cache[key]) return cache[key];
  for (const [k, v] of Object.entries(cache || {})) {
    const ck = customerToken(k);
    if (ck && (ck === key || ck.includes(key) || key.includes(ck))) return v;
  }
  return null;
}

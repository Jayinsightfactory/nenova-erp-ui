// 카탈로그 품목명 — DisplayName · 품명매칭(order-mappings) · suggestDisplayName

import { deriveCatalogNames, splitEngKor } from './catalogUtils.js';
import { suggestDisplayName } from './displayName.js';

/** 카탈로그 매칭 토큰 — order-mappings 키 */
export function buildCatalogMappingToken({ counName, flowerName, engName, prodName }, normalizeToken) {
  const norm = normalizeToken || ((s) => String(s || '').trim().toLowerCase());
  const parts = [counName, flowerName, engName].map(s => String(s || '').trim()).filter(Boolean);
  if (parts.length) return norm(parts.join(' '));
  return norm(prodName || '');
}

/** prodKey 역조회 — 카탈로그 저장(source=catalog) 우선 */
export function findCatalogMatchByProdKey(prodKey, mappings) {
  const pk = Number(prodKey);
  if (!pk) return null;
  let best = null;
  let bestScore = -1;
  for (const [key, val] of Object.entries(mappings || {})) {
    if (Number(val?.prodKey) !== pk) continue;
    const kor = String(val.displayName || '').trim();
    const eng = String(val.engName || '').trim();
    if (!kor && !eng) continue;
    let score = 0;
    if (val.source === 'catalog') score += 1000;
    if (kor) score += kor.length;
    if (eng) score += eng.length;
    score += String(val.savedAt || '').length * 0.001;
    if (score > bestScore) {
      bestScore = score;
      best = {
        key,
        engName: eng,
        korName: kor,
        displayName: kor,
        prodKey: pk,
        source: val.source || null,
        savedAt: val.savedAt || null,
      };
    }
  }
  return best;
}

/** order-mappings.json — prodKey 역조회 → 가장 구체적인 한글 입력명 */
export function findMappingKorNameByProdKey(prodKey, mappings) {
  const catalog = findCatalogMatchByProdKey(prodKey, mappings);
  if (catalog?.korName) return catalog.korName;

  const pk = Number(prodKey);
  if (!pk) return null;
  let best = null;
  let bestScore = -1;
  for (const [inputKey, val] of Object.entries(mappings || {})) {
    if (Number(val?.prodKey) !== pk) continue;
    const candidates = [val.displayName, inputKey].filter(Boolean);
    for (const raw of candidates) {
      const c = String(raw).trim();
      if (!/[가-힣]/.test(c)) continue;
      const score = c.length + (val.displayName === c ? 3 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }
  return best;
}

/**
 * 카탈로그용 영문/한글명 결정
 * 우선순위(한글): DisplayName 분리 → 품명매칭 → suggestDisplayName(ProdName)
 */
export function resolveCatalogProductNames(prod, mappingKorName = null, mappings = null) {
  const catalogMatch = findCatalogMatchByProdKey(prod?.ProdKey, mappings)
    || (prod?.catalogMatchKorName || prod?.catalogMatchEngName
      ? {
        engName: prod.catalogMatchEngName || '',
        korName: prod.catalogMatchKorName || '',
        source: 'catalog',
      }
      : null);

  if (catalogMatch && (catalogMatch.engName || catalogMatch.korName)) {
    const derived = deriveCatalogNames(prod || {});
    return {
      engName: String(catalogMatch.engName || derived.engName || '').trim(),
      korName: String(catalogMatch.korName || derived.korName || '').trim(),
      suggestedKor: String(suggestDisplayName(prod?.ProdName || '') || '').trim(),
      mappingKorName: catalogMatch.korName || mappingKorName || null,
      korSource: 'catalog',
    };
  }

  const derived = deriveCatalogNames(prod || {});
  const mappingKor = mappingKorName || prod?.mappingKorName || null;
  const suggestedKor = suggestDisplayName(prod?.ProdName || '');
  const fromDisplay = splitEngKor(prod?.DisplayName || '');

  let korName = derived.korName || fromDisplay.kor || mappingKor || suggestedKor || '';
  let korSource = 'none';
  if (derived.korName || fromDisplay.kor) korSource = 'display';
  else if (mappingKor) korSource = 'mapping';
  else if (suggestedKor) korSource = 'suggest';

  let engName = derived.engName || fromDisplay.eng || '';
  if (!engName) {
    const fromProd = splitEngKor(prod?.ProdName || '');
    engName = fromProd.eng || String(prod?.ProdName || '').replace(/^[A-Za-z]+\s+/, '').trim();
  }

  return {
    engName: String(engName || '').trim(),
    korName: String(korName || '').trim(),
    suggestedKor: String(suggestedKor || '').trim(),
    mappingKorName: mappingKor ? String(mappingKor).trim() : null,
    korSource,
  };
}

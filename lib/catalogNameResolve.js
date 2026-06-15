// 카탈로그 품목명 — DisplayName · 품명매칭(order-mappings) · suggestDisplayName

import { deriveCatalogNames, splitEngKor } from './catalogUtils.js';
import { suggestDisplayName } from './displayName.js';

/** order-mappings.json — prodKey 역조회 → 가장 구체적인 한글 입력명 */
export function findMappingKorNameByProdKey(prodKey, mappings) {
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
export function resolveCatalogProductNames(prod, mappingKorName = null) {
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

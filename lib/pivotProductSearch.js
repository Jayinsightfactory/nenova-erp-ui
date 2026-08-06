// 피벗 통계 품목 필터 검색 보조.
// 표시 열은 품종과 중복을 피하려고 색상/품목명만 보여주지만,
// 검색은 국가·품종·영문명·한글 표시명을 함께 사용해야 한다.

import { getEnglishOf, suggestDisplayName } from './displayName.js';

export function normalizePivotSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function addAlias(set, value) {
  const text = String(value || '').trim();
  if (!text) return;
  set.add(text);
  const compact = normalizePivotSearchText(text);
  if (compact) set.add(compact);
}

function englishAlias(value) {
  return getEnglishOf(String(value || '').trim()) || '';
}

/**
 * canonical prodName -> 검색어 별칭 집합.
 * 예: flower=수국, prodName=White => 수국화이트/수국 화이트/Hydrangea White 모두 검색.
 */
export function buildPivotProductSearchAliases(rows = []) {
  const aliases = {};
  for (const row of rows || []) {
    const canonical = String(row?.prodName || '').trim();
    if (!canonical) continue;
    const set = aliases[canonical] || new Set();
    const country = String(row?.country || '').trim();
    const flower = String(row?.flower || '').trim();
    const productDescr = String(row?.productDescr || '').trim();
    const flowerEn = englishAlias(flower);
    const countryEn = englishAlias(country);
    const display = suggestDisplayName(`${flower} ${canonical}`).trim();

    [canonical, productDescr, display,
      `${flower} ${canonical}`,
      `${country} ${flower} ${canonical}`,
      `${flowerEn} ${canonical}`,
      `${countryEn} ${flowerEn} ${canonical}`]
      .forEach(value => addAlias(set, value));
    aliases[canonical] = set;
  }
  return aliases;
}

export function pivotProductOptionMatches(option, query, aliases = {}) {
  const wanted = normalizePivotSearchText(query);
  if (!wanted) return true;
  const values = [option, ...(aliases[option] || [])];
  return values.some(value => normalizePivotSearchText(value).includes(wanted));
}


// 도착원가 화면 품목검색 — 붙여넣기 매칭데이터(order-mappings)로 ProdKey를 찾는다.
// 차수·국가는 검색 조건이 아니라 결과 표시 값이다. DB/파일 의존 없이 순수 함수만 둔다.

import { findMappingFuzzy, normalizeToken } from './parseMappings.js';

const DISPLAY_COUNTRY_ALIASES = [
  '콜롬비아', 'colombia', '중국', 'china', '네덜란드', 'netherlands', 'holland',
  '에콰도르', 'ecuador', '호주', 'australia', '태국', 'thailand', '베트남', 'vietnam',
];

export function compactArrivalSearchText(value) {
  return String(value ?? '').toLocaleLowerCase('ko-KR').replace(/[^\p{L}\p{N}]+/gu, '');
}

export function isArrivalDisplayToken(query) {
  const raw = String(query || '').trim();
  if (!raw) return false;
  if (/^\d{1,2}\s*[-/.]\s*0?[1-5]$/.test(raw)) return true;
  const compact = compactArrivalSearchText(raw);
  return DISPLAY_COUNTRY_ALIASES.some((name) => compactArrivalSearchText(name) === compact);
}

export function effectiveArrivalProductQuery(query) {
  const raw = String(query || '').trim();
  if (!raw || isArrivalDisplayToken(raw)) return '';
  return raw;
}

function aliasText(value = {}) {
  return [value.displayName, value.prodName, value.flowerName].filter(Boolean).join(' ');
}

const COLOR_SYNONYMS = [
  ['화이트', ['white']],
  ['레드', ['red']],
  ['핑크', ['pink']],
  ['블루', ['blue']],
  ['옐로우', ['yellow']],
  ['오렌지', ['orange']],
  ['퍼플', ['purple']],
  ['그린', ['green']],
  ['라벤더', ['lavender']],
  ['피치', ['peach']],
  ['크림', ['cream']],
];

export function arrivalQueryLikeTerms(query) {
  const raw = effectiveArrivalProductQuery(query);
  if (!raw) return [];
  const compact = compactArrivalSearchText(raw);
  const terms = new Set([raw]);
  for (const [ko, enList] of COLOR_SYNONYMS) {
    const koCompact = compactArrivalSearchText(ko);
    const hit = compact === koCompact
      || enList.some((en) => compact === compactArrivalSearchText(en));
    if (!hit) continue;
    terms.add(ko);
    enList.forEach((en) => terms.add(en));
  }
  return [...terms].slice(0, 8);
}

export function arrivalQueryCompactTerms(query) {
  return [...new Set(arrivalQueryLikeTerms(query).map(compactArrivalSearchText).filter((term) => term.length >= 2))];
}

function mappingHitsQuery(alias, value, compactTerms) {
  const haystack = compactArrivalSearchText([alias, aliasText(value)].join(' '));
  return compactTerms.some((term) => term.length >= 2 && haystack.includes(term));
}

export function findMappingProdKeysForQuery(query, mappings = {}) {
  const raw = effectiveArrivalProductQuery(query);
  if (!raw) return [];
  const keys = new Set();
  const fuzzy = findMappingFuzzy(raw, mappings);
  if (Number(fuzzy?.value?.prodKey)) keys.add(Number(fuzzy.value.prodKey));

  const compactTerms = arrivalQueryCompactTerms(raw);
  const wantedToken = normalizeToken(raw);
  if (!compactTerms.length) return [...keys];

  for (const [alias, value] of Object.entries(mappings || {})) {
    const prodKey = Number(value?.prodKey || 0);
    if (!prodKey) continue;
    const aliasToken = normalizeToken(alias);
    const hit = mappingHitsQuery(alias, value, compactTerms)
      || (wantedToken && aliasToken && aliasToken === wantedToken);
    if (hit) keys.add(prodKey);
  }
  return [...keys];
}

export function flowerNamesForProductMatch(query, mappings = {}) {
  const raw = effectiveArrivalProductQuery(query);
  if (!raw) return [];
  const compactTerms = arrivalQueryCompactTerms(raw);
  const wantedToken = normalizeToken(raw);
  const names = new Set();
  const fuzzy = findMappingFuzzy(raw, mappings);
  if (String(fuzzy?.value?.flowerName || '').trim()) names.add(String(fuzzy.value.flowerName).trim());
  for (const [alias, value] of Object.entries(mappings || {})) {
    const flowerName = String(value?.flowerName || '').trim();
    if (!flowerName) continue;
    const aliasToken = normalizeToken(alias);
    const hit = mappingHitsQuery(alias, value, compactTerms)
      || (wantedToken && aliasToken && aliasToken === wantedToken);
    if (hit) names.add(flowerName);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'ko'));
}

export function buildArrivalCostProductMatch(query, mappings = {}) {
  const raw = effectiveArrivalProductQuery(query);
  if (!raw) {
    return {
      raw: '',
      compact: '',
      prodKeys: [],
      useMappingKeys: false,
    };
  }
  const prodKeys = findMappingProdKeysForQuery(raw, mappings);
  return {
    raw,
    compact: compactArrivalSearchText(raw),
    prodKeys,
    useMappingKeys: prodKeys.length > 0,
  };
}

function productTextLikeSql(index) {
  return `(
      l.ProductNameRaw LIKE @product${index} OR p.ProdName LIKE @product${index} OR p.DisplayName LIKE @product${index}
      OR REPLACE(LOWER(ISNULL(l.ProductNameRaw,N'')),N' ',N'') LIKE @productCompact${index}
      OR REPLACE(LOWER(ISNULL(p.ProdName,N'')),N' ',N'') LIKE @productCompact${index}
      OR REPLACE(LOWER(ISNULL(p.DisplayName,N'')),N' ',N'') LIKE @productCompact${index}
      OR REPLACE(LOWER(ISNULL(l.FlowerNameRaw,N'')),N' ',N'') + REPLACE(LOWER(ISNULL(l.ProductNameRaw,N'')),N' ',N'') LIKE @productCompact${index}
      OR REPLACE(LOWER(ISNULL(p.FlowerName,N'')),N' ',N'') + REPLACE(LOWER(ISNULL(p.ProdName,N'')),N' ',N'') LIKE @productCompact${index}
    )`;
}

export function bindArrivalCostProductMatch(match, params, { sqlInt, sqlNVarChar } = {}) {
  const clauses = [];
  const likes = arrivalQueryLikeTerms(match.raw);
  const compacts = arrivalQueryCompactTerms(match.raw);
  likes.forEach((term, index) => {
    params[`product${index}`] = { type: sqlNVarChar, value: `%${String(term).slice(0, 300)}%` };
    params[`productCompact${index}`] = { type: sqlNVarChar, value: `%${compactArrivalSearchText(term).slice(0, 300)}%` };
  });
  if (likes.length) {
    params.product = params.product0;
    params.productCompact = params.productCompact0;
    clauses.push(`(${likes.map((_, index) => productTextLikeSql(index)).join(' OR ')})`);
  }
  const prodKeys = [...new Set((match.prodKeys || []).map(Number).filter((key) => key > 0))].slice(0, 400);
  if (prodKeys.length) {
    prodKeys.forEach((key, index) => {
      params[`mapPk${index}`] = { type: sqlInt, value: key };
    });
    const inList = prodKeys.map((_, index) => `@mapPk${index}`).join(', ');
    clauses.push(`l.ProdKey IN (${inList})`);
    clauses.push(`p.ProdKey IN (${inList})`);
  }
  return {
    sql: clauses.length ? `(${clauses.join(' OR ')})` : '',
    prodKeys,
    likes,
    compacts,
  };
}

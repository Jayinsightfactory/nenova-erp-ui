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

export function findMappingProdKeysForQuery(query, mappings = {}) {
  const raw = effectiveArrivalProductQuery(query);
  if (!raw) return [];
  const keys = new Set();
  const fuzzy = findMappingFuzzy(raw, mappings);
  if (Number(fuzzy?.value?.prodKey)) keys.add(Number(fuzzy.value.prodKey));

  const wanted = compactArrivalSearchText(raw);
  const wantedToken = normalizeToken(raw);
  if (!wanted) return [...keys];

  for (const [alias, value] of Object.entries(mappings || {})) {
    const prodKey = Number(value?.prodKey || 0);
    if (!prodKey) continue;
    const aliasCompact = compactArrivalSearchText(alias);
    const mappedCompact = compactArrivalSearchText(aliasText(value));
    const aliasToken = normalizeToken(alias);
    const hit = aliasCompact === wanted
      || mappedCompact === wanted
      || (wanted.length >= 2 && aliasCompact.includes(wanted))
      || (wanted.length >= 2 && mappedCompact.includes(wanted))
      || (wantedToken && aliasToken && aliasToken === wantedToken);
    if (hit) keys.add(prodKey);
  }
  return [...keys];
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

export function bindArrivalCostProductMatch(match, params, { sqlInt, sqlNVarChar } = {}) {
  const clauses = [];
  if (match.raw) {
    clauses.push(`(
      l.ProductNameRaw LIKE @product OR p.ProdName LIKE @product OR p.DisplayName LIKE @product
      OR REPLACE(LOWER(ISNULL(l.ProductNameRaw,N'')),N' ',N'') LIKE @productCompact
      OR REPLACE(LOWER(ISNULL(p.ProdName,N'')),N' ',N'') LIKE @productCompact
      OR REPLACE(LOWER(ISNULL(p.DisplayName,N'')),N' ',N'') LIKE @productCompact
      OR REPLACE(LOWER(ISNULL(l.FlowerNameRaw,N'')),N' ',N'') + REPLACE(LOWER(ISNULL(l.ProductNameRaw,N'')),N' ',N'') LIKE @productCompact
      OR REPLACE(LOWER(ISNULL(p.FlowerName,N'')),N' ',N'') + REPLACE(LOWER(ISNULL(p.ProdName,N'')),N' ',N'') LIKE @productCompact
    )`);
    params.product = { type: sqlNVarChar, value: `%${match.raw.slice(0, 300)}%` };
    params.productCompact = { type: sqlNVarChar, value: `%${match.compact.slice(0, 300)}%` };
  }
  const prodKeys = [...new Set((match.prodKeys || []).map(Number).filter((key) => key > 0))].slice(0, 80);
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
  };
}

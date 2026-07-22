// lib/orderImportMatch.js — 업로드 발주 품목 자동 매칭

import { scoreMatch, getDisplayName, suggestDisplayName } from './displayName.js';
import { findMappingFuzzy, detectFallbackProdKey, loadMappings } from './parseMappings.js';
import { normalizeOrderUnit } from './orderUtils.js';
import { resolveImportUnit } from './orderImportUnits.js';
import {
  filterRoseCandidatesByCountry,
  isChinaRoseProduct,
  wantsChinaRoseInput,
} from './parsePasteRoseCountry.js';

function isRoseProduct(prod) {
  const text = `${prod?.FlowerName || ''} ${prod?.ProdName || ''} ${prod?.DisplayName || ''}`;
  return /(장미|rose)/i.test(text);
}

function isMixBoxName(prod) {
  const text = `${prod?.ProdName || ''} ${prod?.DisplayName || ''}`.toLowerCase();
  return /믹스\s*박스|mix\s*box|mixbox/.test(text);
}

function inputWantsMixBox(inputName) {
  return /믹스\s*박스|믹스|mix\s*box|mixbox|mixed/i.test(String(inputName || ''));
}

function isMixBoxMismatch(inputName, prod) {
  return isMixBoxName(prod) && !inputWantsMixBox(inputName);
}

function isFreightOrChargeProduct(prod) {
  const text = `${prod?.ProdName || ''} ${prod?.DisplayName || ''}`.toLowerCase();
  return /운송료|운송비|항공료|항공비|freight|shipping|charge/.test(text);
}

function inputWantsFreight(inputName) {
  return /운송료|운송비|항공료|항공비|freight|shipping|charge/i.test(String(inputName || ''));
}

function isFreightMismatch(inputName, prod) {
  return isFreightOrChargeProduct(prod) && !inputWantsFreight(inputName);
}

function usageRank(usageByProdKey, prodKey) {
  if (!usageByProdKey) return { usageCount: 0, recentUsageCount: 0, usageRank: 0 };
  const raw = usageByProdKey instanceof Map
    ? usageByProdKey.get(Number(prodKey))
    : usageByProdKey[Number(prodKey)] || usageByProdKey[String(prodKey)];
  if (raw == null) return { usageCount: 0, recentUsageCount: 0, usageRank: 0 };
  if (typeof raw === 'number') return { usageCount: raw, recentUsageCount: 0, usageRank: raw };
  const usageCount = Number(raw.usageCount ?? raw.UsageCount ?? raw.total ?? 0) || 0;
  const recentUsageCount = Number(raw.recentUsageCount ?? raw.RecentUsageCount ?? raw.recent ?? 0) || 0;
  return {
    usageCount,
    recentUsageCount,
    usageRank: usageCount + recentUsageCount * 2,
  };
}

const COUNTRY_ALIASES = [
  ['콜롬비아', /콜롬비아|colombia|(?:^|\s)콜(?:\s|$)/i],
  ['중국', /중국|china|(?:^|\s)中(?:\s|$)/i],
  ['네덜란드', /네덜란드|netherlands|holland/i],
  ['에콰도르', /에콰도르|ecuador/i],
  ['에티오피아', /에티오피아|ethiopia/i],
  ['호주', /호주|australia/i],
  ['태국', /태국|thailand/i],
  ['베트남', /베트남|vietnam/i],
];

function explicitCountry(inputName) {
  const text = ` ${String(inputName || '').toLowerCase().replace(/\s+/g, ' ')} `;
  return COUNTRY_ALIASES.find(([, pattern]) => pattern.test(text))?.[0] || '';
}

function productCountryMatches(country, product) {
  const actual = String(product?.CounName || '').trim();
  return actual === country || COUNTRY_ALIASES.some(([name, pattern]) => name === country && pattern.test(` ${actual} `));
}

function inputFlowerFamily(inputName) {
  const text = String(inputName || '').toLowerCase();
  if (/장미|rose/.test(text)) return '장미';
  if (/카네이션|카네|carnation/.test(text)) return '카네이션';
  return '';
}

function countryPreference(inputName, product) {
  const requested = explicitCountry(inputName);
  if (requested) return productCountryMatches(requested, product) ? 45 : -45;
  const family = inputFlowerFamily(inputName);
  // 붙여넣기 주문등록의 운영 규칙과 동일하게, 국가가 없는 장미/카네이션은
  // 가장 많이 쓰는 콜롬비아 품목을 먼저 제시한다. 사용자가 중국/에콰도르를
  // 입력하면 위의 명시 국가 우선 규칙이 이 기본값을 덮어쓴다.
  if (family && String(product?.CounName || '') === '콜롬비아') return 12;
  return 0;
}

function normalizeMappingKey(value) {
  return String(value || '').toLowerCase().replace(/[\s()\[\]{}_\-/.]/g, '');
}

/** 붙여넣기 주문등록에서 사용자가 선택/저장한 별칭의 품목별 빈도. */
export function buildProductMappingStats(mappings = {}) {
  const stats = new Map();
  for (const [input, value] of Object.entries(mappings || {})) {
    const prodKey = Number(value?.prodKey || 0);
    if (!prodKey) continue;
    const current = stats.get(prodKey) || { count: 0, aliases: [] };
    current.count += 1;
    if (input && current.aliases.length < 12) current.aliases.push(String(input));
    stats.set(prodKey, current);
  }
  return stats;
}

function mappingRank(inputName, product, mappingByProdKey) {
  const item = mappingByProdKey?.get(Number(product?.ProdKey));
  if (!item) return { rank: 0, count: 0 };
  const wanted = normalizeMappingKey(inputName);
  const exact = (item.aliases || []).some((alias) => normalizeMappingKey(alias) === wanted);
  return {
    rank: exact ? 22 : Math.min(14, Math.log10(Number(item.count || 0) + 1) * 6),
    count: Number(item.count || 0),
  };
}

function extractCm(text) {
  const m = String(text || '').match(/(\d{2})\s*cm/i);
  return m ? Number(m[1]) : null;
}

function productCm(prod) {
  return extractCm(`${prod?.ProdName || ''} ${prod?.DisplayName || ''}`);
}

function resolveRoseCandidate(inputName, chosenProd, allProducts) {
  const input = String(inputName || '').trim();
  const isRoseInput = /(장미|rose)/i.test(input) || isRoseProduct(chosenProd);
  if (!isRoseInput) return { prod: chosenProd, ambiguousCountry: false, reason: null };

  let candidates = allProducts
    .filter(isRoseProduct)
    .filter(prod => !isFreightMismatch(input, prod))
    .map(prod => ({ prod, score: scoreMatch(input, prod, '') }))
    .filter(x => x.score >= 70)
    .sort((a, b) => b.score - a.score);

  const explicitCm = extractCm(input);
  if (explicitCm) {
    const lengthMatches = candidates.filter(x => productCm(x.prod) === explicitCm);
    if (lengthMatches.length) candidates = lengthMatches;
  } else {
    const cm50 = candidates.filter(x => productCm(x.prod) === 50);
    if (cm50.length) candidates = cm50;
  }

  if (candidates.length === 0) {
    return { prod: chosenProd, ambiguousCountry: false, reason: null };
  }

  const { candidates: countryFiltered } = filterRoseCandidatesByCountry(input, candidates);
  if (countryFiltered.length) candidates = countryFiltered;

  if (wantsChinaRoseInput(input) && chosenProd && !isChinaRoseProduct(chosenProd)) {
    const chinaPick = candidates.find(x => isChinaRoseProduct(x.prod));
    if (!chinaPick && !isChinaRoseProduct(candidates[0]?.prod)) {
      return { prod: null, ambiguousCountry: true, reason: '중국 장미로 입력됐으나 매칭 품목이 없습니다' };
    }
  }

  return { prod: candidates[0].prod, ambiguousCountry: false, reason: null };
}

function findBestProductCandidate(inputName, allProducts) {
  const input = String(inputName || '').trim();
  if (!input) return null;
  const scored = allProducts
    .filter(prod => !isMixBoxMismatch(input, prod))
    .filter(prod => !isFreightMismatch(input, prod))
    .map(prod => ({ prod, score: scoreMatch(input, prod, '') }))
    .filter(x => x.score >= 72)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const topScore = scored[0].score;
  const nearTop = scored.filter(x => x.score >= topScore - 3);
  const nearKeys = new Set(nearTop.map(x => Number(x.prod.ProdKey)));
  if (nearKeys.size > 1) return null;
  return scored[0].prod;
}

/** 우선순위 후보 (미매칭 UI용) */
export function buildProductSuggestions(inputName, allProducts, {
  limit = 8,
  minScore = 35,
  usageByProdKey = null,
  mappingByProdKey = null,
} = {}) {
  const input = String(inputName || '').trim();
  if (!input) return [];
  const requestedCountry = explicitCountry(input);
  const countryCandidates = requestedCountry
    ? allProducts.filter((prod) => productCountryMatches(requestedCountry, prod))
    : allProducts;
  const sourceProducts = countryCandidates.length ? countryCandidates : allProducts;
  const seen = new Set();
  const scored = sourceProducts
    .filter(prod => !isMixBoxMismatch(input, prod))
    .filter(prod => !isFreightMismatch(input, prod))
    .map(prod => {
      const usage = usageRank(usageByProdKey, prod.ProdKey);
      const mapping = mappingRank(input, prod, mappingByProdKey);
      const country = countryPreference(input, prod);
      // 문자열 유사도만으로 중국 후보가 콜롬비아의 실제 빈출 품목을
      // 앞지르지 않도록 사용량/기존 매칭을 보조 점수로 반영한다.
      const score = scoreMatch(input, prod, '');
      const popularity = Math.min(30, Math.log10(Number(usage.usageRank || 0) + 1) * 10);
      return {
        prod,
        score,
        ...usage,
        mappingCount: mapping.count,
        rankScore: score + popularity + mapping.rank + country,
      };
    })
    .filter(x => x.score >= minScore)
    .sort((a, b) => b.rankScore - a.rankScore
      || b.score - a.score
      || b.usageRank - a.usageRank
      || b.usageCount - a.usageCount
      || String(a.prod.ProdName || '').localeCompare(String(b.prod.ProdName || ''), 'ko'));

  const out = [];
  for (const x of scored) {
    const key = Number(x.prod.ProdKey);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      prodKey: key,
      prodName: x.prod.ProdName,
      displayName: x.prod.DisplayName || x.prod.ProdName,
      suggestedDisplayName: suggestDisplayName(x.prod.ProdName),
      flowerName: x.prod.FlowerName,
      counName: x.prod.CounName,
      outUnit: x.prod.OutUnit,
      score: x.score,
      usageCount: x.usageCount,
      recentUsageCount: x.recentUsageCount,
      mappingCount: x.mappingCount,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * @param {{ inputName: string, unit?: string, qty: number, rowNo?: number, preferredProdKey?: number|string|null }} row
 */
export function matchImportRow(row, { allProducts, productByKey, prodUnitMap, savedMappings, unitCatalog }) {
  const inputName = row.inputName;
  // 이미지 파이프라인은 OCR 오타/현장 약칭을 matchName에 별도로 전달한다.
  // 원문 inputName은 화면·학습키로 보존하고, 기존 Excel/붙여넣기 호출자는
  // 이전과 동일하게 inputName만 사용한다.
  const matchName = row.matchName || inputName;
  const fuzzyMatch = findMappingFuzzy(inputName, savedMappings)
    || (matchName !== inputName ? findMappingFuzzy(matchName, savedMappings) : null);
  const savedMap = fuzzyMatch ? fuzzyMatch.value : null;
  const savedMappedProd = savedMap ? productByKey.get(Number(savedMap.prodKey)) : null;
  const savedFallbackInfo = savedMappedProd
    ? detectFallbackProdKey(savedMappedProd.ProdKey, fuzzyMatch?.key)
    : { isFallback: false, count: 0 };
  const legacyFallbackMapping = !!fuzzyMatch && savedMap?.auto === true && savedFallbackInfo.isFallback;
  // 이미지 입력은 과거 자동매핑 캐시에 잘못 저장된 동명이 품목을 그대로
  // 신뢰하지 않는다. 예: "카네이션 화이트"가 Moon Light로 저장된 경우.
  // 기존 텍스트/엑셀 파이프라인에는 이 추가 검사를 적용하지 않는다.
  const imageMappingScore = row.matchName && savedMappedProd
    ? scoreMatch(matchName, savedMappedProd, '')
    : 100;
  const imageMappingIrrelevant = Boolean(row.matchName && savedMappedProd && imageMappingScore < 72);
  const mappedProd = (
    legacyFallbackMapping ||
    imageMappingIrrelevant ||
    isMixBoxMismatch(matchName, savedMappedProd) ||
    isFreightMismatch(matchName, savedMappedProd)
  ) ? null : savedMappedProd;

  const preferredProd = !mappedProd && row.preferredProdKey
    ? productByKey.get(Number(row.preferredProdKey)) || null
    : null;
  const preferredProdAllowed = preferredProd
    && !isMixBoxMismatch(matchName, preferredProd)
    && !isFreightMismatch(matchName, preferredProd)
    ? preferredProd
    : null;
  const scoredProd = !mappedProd
    ? (preferredProdAllowed || findBestProductCandidate(matchName, allProducts))
    : null;
  const resolved = resolveRoseCandidate(matchName, mappedProd || scoredProd, allProducts);
  const prod = resolved.prod;

  let confidence = 0;
  let confidenceLabel = 'none';
  if (resolved.ambiguousCountry) {
    confidence = 0;
    confidenceLabel = 'none';
  } else if (mappedProd) {
    confidence = fuzzyMatch?.score ?? 1;
    confidenceLabel = fuzzyMatch?.matchType === 'exact' ? 'high' : 'medium';
  } else if (preferredProdAllowed) {
    confidence = 0.6;
    confidenceLabel = 'medium';
  } else if (scoredProd) {
    confidence = 0.55;
    confidenceLabel = 'medium';
  }

  const fallbackInfo = prod ? detectFallbackProdKey(prod.ProdKey) : { isFallback: false, count: 0 };
  const mappingLooksSpecific = !!fuzzyMatch && !legacyFallbackMapping && (
    fuzzyMatch.matchType === 'exact' ||
    fuzzyMatch.matchType === 'compact' ||
    Number(fuzzyMatch.score || 0) >= 0.5
  );
  if (fallbackInfo.isFallback && !mappingLooksSpecific) {
    confidence = Math.min(confidence, 0.4);
    confidenceLabel = 'low';
  }

  const unitResolved = resolveImportUnit(prod, inputName, {
    sourceUnit: row.unit,
    savedMappingUnit: savedMap?.unit,
    unitCatalog,
    prodUnitMap,
  });
  const suggestions = buildProductSuggestions(matchName, allProducts);

  return {
    rowNo: row.rowNo,
    inputName,
    qty: row.qty,
    unit: unitResolved.unit,
    unitSource: unitResolved.unitSource,
    unitMatchType: unitResolved.unitMatchType,
    unitCatalogKey: unitResolved.unitCatalogKey || null,
    rawUnit: row.unit || '',
    prodKey: prod?.ProdKey || null,
    prodName: prod?.ProdName || null,
    displayName: prod?.DisplayName || null,
    flowerName: prod?.FlowerName || null,
    counName: prod?.CounName || null,
    fromMapping: !!mappedProd && Number(mappedProd.ProdKey) === Number(prod?.ProdKey),
    mappingMatchType: mappedProd ? (fuzzyMatch?.matchType || null) : null,
    mappingMatchKey: mappedProd ? (fuzzyMatch?.key || null) : null,
    ambiguousCountry: resolved.ambiguousCountry,
    ambiguityReason: resolved.reason,
    confidence,
    confidenceLabel,
    fallbackSuspect: fallbackInfo.isFallback && !mappingLooksSpecific,
    fallbackCount: fallbackInfo.count,
    suggestedProducts: suggestions,
    skip: false,
  };
}

export function matchImportRows(parsedRows, context) {
  const savedMappings = context.savedMappings || loadMappings(true);
  const productByKey = context.productByKey || new Map(
    (context.allProducts || []).map(p => [Number(p.ProdKey), p])
  );
  return parsedRows.map(row => matchImportRow(row, {
    ...context,
    savedMappings,
    productByKey,
    unitCatalog: context.unitCatalog,
  }));
}

export function summarizeMatches(items) {
  const active = items.filter(it => !it.skip);
  const matched = active.filter(it => it.prodKey);
  const unmatched = active.filter(it => !it.prodKey);
  return {
    total: items.length,
    active: active.length,
    matched: matched.length,
    unmatched: unmatched.length,
    skipped: items.filter(it => it.skip).length,
  };
}

export function mergeRegisterItems(items) {
  const map = new Map();
  for (const it of items) {
    if (it.skip || !it.prodKey) continue;
    const key = Number(it.prodKey);
    const prev = map.get(key);
    const qty = Math.abs(Number(it.qty || 0));
    if (prev) {
      prev.qty += qty;
    } else {
      map.set(key, {
        prodKey: key,
        prodName: it.prodName,
        displayName: it.displayName,
        qty,
        unit: normalizeOrderUnit(it.unit),
      });
    }
  }
  return [...map.values()];
}

export function prodToOption(prod) {
  return {
    prodKey: prod.ProdKey,
    prodName: prod.ProdName,
    displayName: getDisplayName(prod),
    flowerName: prod.FlowerName,
    counName: prod.CounName,
    outUnit: prod.OutUnit,
  };
}

// Product 자연어 매칭 공통 계약. ERP Product 원장을 수정하지 않는 순수 모듈이다.
import { getEnglishOf, scoreMatch, tokenizeForMatch } from './displayName.js';

export const PRODUCT_MATCH_MODEL_VERSION = 'nl-product-v1';
export const PRODUCT_MATCH_THRESHOLDS = Object.freeze({ high: 0.9, medium: 0.68 });

const COUNTRY_ALIASES = new Map([
  ['콜롬비아', ['콜롬비아', 'colombia']], ['중국', ['중국', 'china']],
  ['에콰도르', ['에콰도르', 'ecuador']], ['네덜란드', ['네덜란드', 'holland', 'netherlands']],
  ['호주', ['호주', 'australia']], ['태국', ['태국', 'thailand']], ['베트남', ['베트남', 'vietnam']],
]);
const FLOWER_ALIASES = new Map([
  ['장미', ['장미', 'rose']], ['카네이션', ['카네이션', '카네', 'carnation']],
  ['수국', ['수국', 'hydrangea']], ['백합', ['백합', 'lily']], ['튤립', ['튤립', 'tulip']],
]);
const UNIT_PATTERNS = [
  ['박스', /(?:^|\s)(?:box|bx|박스)(?:\s|$)/i],
  ['스팀(대)', /(?:^|\s)(?:stem|steam|st|스팀|대|송이)(?:\s|$)/i],
  ['단', /(?:^|\s)(?:bunch|bn|단)(?:\s|$)/i],
];

function compact(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); }
function findConcept(text, catalog) {
  const normalized = ` ${String(text || '').normalize('NFKC').toLowerCase().replace(/[()[\]{}_/.,:+-]+/g, ' ').replace(/\s+/g, ' ')} `;
  for (const [canonical, aliases] of catalog) if (aliases.some((alias) => normalized.includes(` ${alias} `) || compact(normalized).includes(compact(alias)))) return canonical;
  return '';
}
function productUnit(product) { return String(product?.EstUnit || product?.OutUnit || '').trim(); }

export function normalizeProductQuery(raw) {
  const source = String(raw || '').normalize('NFKC').trim();
  const unit = UNIT_PATTERNS.find(([, pattern]) => pattern.test(` ${source} `))?.[0] || '';
  const withoutUnit = UNIT_PATTERNS.reduce((value, [, pattern]) => value.replace(pattern, ' '), ` ${source} `).trim();
  const tokens = tokenizeForMatch(withoutUnit).map((token) => String(token).toLowerCase());
  const expandedTokens = [...new Set(tokens.flatMap((token) => [token, getEnglishOf(token)].filter(Boolean).map((x) => String(x).toLowerCase())))];
  return {
    raw: source, normalized: compact(withoutUnit), tokens, expandedTokens,
    country: findConcept(withoutUnit, COUNTRY_ALIASES), flower: findConcept(withoutUnit, FLOWER_ALIASES), unit,
  };
}

function confidencePolicy(score, conflicts) {
  if (conflicts.country || conflicts.flower || conflicts.unit) return { confidence: Math.min(score, 0.49), band: 'low', autoSelect: false };
  if (score >= PRODUCT_MATCH_THRESHOLDS.high) return { confidence: score, band: 'high', autoSelect: true };
  if (score >= PRODUCT_MATCH_THRESHOLDS.medium) return { confidence: score, band: 'medium', autoSelect: false };
  return { confidence: score, band: 'low', autoSelect: false };
}

export function scoreNaturalLanguageProducts(rawQuery, products = [], options = {}) {
  const query = normalizeProductQuery(rawQuery);
  const customerUsage = options.customerUsageByProdKey || new Map();
  const recentUsage = options.recentUsageByProdKey || new Map();
  const aliasUsage = options.aliasUsageByProdKey || new Map();
  const candidates = products.map((product) => {
    const country = String(product.CounName || '');
    const flower = String(product.FlowerName || '');
    const unit = productUnit(product);
    const conflicts = {
      country: Boolean(query.country && findConcept(country, COUNTRY_ALIASES) !== query.country),
      flower: Boolean(query.flower && findConcept(flower, FLOWER_ALIASES) !== query.flower),
      unit: Boolean(query.unit && unit && compact(query.unit) !== compact(unit)),
    };
    const exact = [product.ProdName, product.DisplayName, product.ProdCode].some((value) => compact(value) === query.normalized);
    const lexical = Math.max(0, Math.min(100, scoreMatch(query.raw, product, ''))) / 100;
    const usage = Math.log10(Number(product.UsageCount || product.orderCount || 0) + 1) / 20;
    const customer = Math.log10(Number(customerUsage.get?.(Number(product.ProdKey)) || product.CustomerUsageCount || 0) + 1) / 16;
    const recent = Math.log10(Number(recentUsage.get?.(Number(product.ProdKey)) || product.RecentUsageCount || 0) + 1) / 20;
    const alias = Math.log10(Number(aliasUsage.get?.(Number(product.ProdKey)) || product.MappingCount || 0) + 1) / 18;
    const agreement = (query.country && !conflicts.country ? 0.12 : 0) + (query.flower && !conflicts.flower ? 0.12 : 0) + (query.unit && !conflicts.unit ? 0.04 : 0);
    const penalty = (conflicts.country ? 0.48 : 0) + (conflicts.flower ? 0.42 : 0) + (conflicts.unit ? 0.18 : 0);
    const score = Math.max(0, Math.min(1, lexical * 0.7 + (exact ? 0.22 : 0) + usage + customer + recent + alias + agreement - penalty));
    const policy = confidencePolicy(score, conflicts);
    const reasons = [exact && 'exact', lexical >= 0.7 && 'token-alias', customer > 0 && 'customer-usage', recent > 0 && 'recent-usage', query.country && !conflicts.country && 'country', query.flower && !conflicts.flower && 'flower', query.unit && !conflicts.unit && 'unit'].filter(Boolean);
    return {
      prodKey: Number(product.ProdKey), prodName: product.ProdName || '', displayName: product.DisplayName || '',
      country, flower, color: product.DisplayName || product.ProdName || '', unit,
      score: Number(score.toFixed(4)), ...policy, conflicts, reasons, modelVersion: PRODUCT_MATCH_MODEL_VERSION,
      source: product,
    };
  }).sort((a, b) => b.score - a.score || a.prodKey - b.prodKey);
  const compatible = candidates.filter((item) => !item.conflicts.country && !item.conflicts.flower);
  const alternateCountry = candidates.filter((item) => item.conflicts.country && !item.conflicts.flower);
  let emptyReason = '';
  if (!products.length) emptyReason = 'NO_MASTER_CANDIDATE';
  else if (query.country && !candidates.some((item) => !item.conflicts.country)) emptyReason = 'COUNTRY_CONFLICT';
  else if (query.flower && !candidates.some((item) => !item.conflicts.flower)) emptyReason = 'FLOWER_MISMATCH';
  else if (!compatible.some((item) => item.score > 0)) emptyReason = 'NO_SIMILAR_CANDIDATE';
  return { query, candidates: compatible.slice(0, options.limit || 40), alternateCountry: alternateCountry.slice(0, 10), emptyReason, modelVersion: PRODUCT_MATCH_MODEL_VERSION };
}

export function calculateMatchingMetrics(events = [], { minGroupSize = 20 } = {}) {
  const confirmed = events.filter((e) => e.confirmed === true && Number(e.selectedProdKey));
  const aggregate = (rows) => {
    const total = rows.length;
    const top1 = rows.filter((e) => Number(e.candidateProdKeys?.[0]) === Number(e.selectedProdKey)).length;
    const top3 = rows.filter((e) => (e.candidateProdKeys || []).slice(0, 3).map(Number).includes(Number(e.selectedProdKey))).length;
    const wrongAuto = rows.filter((e) => e.autoSelected && Number(e.candidateProdKeys?.[0]) !== Number(e.selectedProdKey)).length;
    return { sampleSize: total, top1: total ? top1 / total : 0, top3: total ? top3 / total : 0, wrongAutoRate: total ? wrongAuto / total : 0 };
  };
  const overall = aggregate(confirmed);
  const group = (field) => Object.fromEntries([...new Set(confirmed.map((e) => e[field] || '미지정'))].map((key) => {
    const metric = aggregate(confirmed.filter((e) => (e[field] || '미지정') === key));
    return [key, { ...metric, lowSampleWarning: metric.sampleSize < minGroupSize }];
  }));
  return { overall, targetMet: overall.sampleSize >= minGroupSize && overall.top1 >= 0.9 && overall.wrongAutoRate <= 0.01, byCustomer: group('customerGroup'), byCountry: group('country'), byFlower: group('flower') };
}

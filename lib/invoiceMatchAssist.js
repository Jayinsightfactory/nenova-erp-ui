// 인보이스 품목 매칭 보조: ① 나라 불일치 감지 ② 100% 미만 후보 순위(1순위 기본, 2순위 이하 버튼).
// 읽기 전용 순수 함수. DB·입고·원가를 바꾸지 않는다. 선택은 항상 사람이 확정한다.
import { historyKey } from './driveMatchHistory.js';
import { allowsDiscontinuedProduct } from './discontinuedVendors.js';

const text = value => String(value ?? '').trim();
const normalize = value => text(value).normalize('NFKC').toLowerCase().replace(/\bwo+l+y\b/g, 'woolly').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ── ① 나라 불일치 ─────────────────────────────────────────────
// 근거가 두 개 이상 같은 쪽을 가리킬 때만 "다른 나라로 보임"이라고 알린다(한 가지 근거로 막지 않는다).
const CHINA_FARMS = /cloud\s*land|hub\s*fresh|melody/i;
const COLOMBIA_FARMS = /ayura|circasia|cactus|tiba|daflor|turflor|eusebio|colibri|construnorte|prisma|fillco|monika|maxiflores|matina|la gaitana|esperance|funza|invos|mayra|green genie|the elite|prestige|el milagro|el redil/i;
const CJK = /[㐀-鿿]/;

export function detectInvoiceCountry({ farmName, lineNames = [], currency, selectedCountry } = {}) {
  const score = { CN: 0, CO: 0 };
  const signals = [];
  const add = (country, reason) => { score[country] += 1; signals.push({ country, reason }); };
  const farm = text(farmName);
  if (CHINA_FARMS.test(farm)) add('CN', `농장 ${farm}은(는) 중국 농장입니다`);
  if (COLOMBIA_FARMS.test(farm)) add('CO', `농장 ${farm}은(는) 콜롬비아 농장입니다`);
  const names = (Array.isArray(lineNames) ? lineNames : []).map(text).filter(Boolean);
  if (names.length) {
    const chinaWord = names.filter(name => /\bchina\b/i.test(name) || CJK.test(name)).length;
    if (chinaWord / names.length >= 0.5) add('CN', `품목 ${chinaWord}/${names.length}행에 CHINA·중국어 표기가 있습니다`);
  }
  const cur = text(currency).toUpperCase();
  if (cur === 'CNY') add('CN', '통화가 CNY입니다');
  if (cur === 'USD') add('CO', '통화가 USD입니다(콜롬비아 기준)');
  const suggested = score.CN >= 2 && score.CN > score.CO ? 'CN' : score.CO >= 2 && score.CO > score.CN ? 'CO' : null;
  const selected = text(selectedCountry).toUpperCase();
  const mismatch = Boolean(suggested && selected && ['CN', 'CO'].includes(selected) && suggested !== selected);
  return { suggested, selected: selected || null, mismatch, signals, score };
}

/** 이미 고른 전산 품목의 원산지가 문서 나라와 다른지. product.country는 'CO'/'CN' 같은 코드. */
export function productCountryMismatch(product, documentCountry) {
  const productCountry = text(product?.country).toUpperCase();
  const doc = text(documentCountry).toUpperCase();
  return Boolean(productCountry && doc && productCountry !== doc);
}

// ── ② 후보 순위 ───────────────────────────────────────────────
const NOISE = new Set(['rose', 'roses', 'china', 'select', 'premium', 'grade', 'spray', 'garden', 'co', 'cm', 'the', 'and', 'of', 'stem', 'stems']);
function sizes(value) {
  const out = [];
  const re = /(\d{2,3})\s*(?:cm)?(?:\s*[-~–]\s*(\d{2,3}))?\s*cm/gi;
  let m;
  while ((m = re.exec(text(value))) !== null) { out.push(Number(m[1])); if (m[2]) out.push(Number(m[2])); }
  return out;
}
function tokens(value) {
  return [...new Set(normalize(value).replace(/\d+\s*cm/g, ' ').split(/\s+/)
    .filter(word => word.length >= 2 && !NOISE.has(word) && !/^\d+$/.test(word)))];
}
const sameSizes = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

/** 0~100 점수(정수). 이름이 같으면 100. */
export function scoreProductMatch(originalName, product) {
  const a = normalize(originalName).replace(/\s+/g, ' ');
  const names = [product?.ProdName, product?.DisplayName].map(normalize).filter(Boolean);
  if (a && names.some(name => name === a)) return 100;
  const invoiceTokens = tokens(originalName);
  if (!invoiceTokens.length) return 0;
  let best = 0;
  for (const name of names) {
    const catalogTokens = tokens(name);
    if (!catalogTokens.length) continue;
    const overlap = invoiceTokens.filter(word => catalogTokens.includes(word)).length;
    if (!overlap) continue;
    const recall = overlap / invoiceTokens.length;
    const precision = overlap / catalogTokens.length;
    let value = 2 * recall * precision / (recall + precision);
    const left = sizes(originalName), right = sizes(name);
    if (left.length && right.length) value = sameSizes(left, right) ? Math.min(1, value + 0.1) : value * 0.4;
    else if (left.length || right.length) value *= 0.9;
    best = Math.max(best, value);
  }
  // 이름이 완전히 같지 않으면 99를 넘기지 않는다 — 100은 "이름 일치"만 뜻한다.
  return Math.min(99, Math.round(best * 100));
}

/**
 * 한 행의 후보 순위. 같은 나라 품목만, 점수 내림차순.
 * 반환: { exact, items:[{ product, score }] } — exact=true면 이름이 100% 일치해 버튼이 필요 없다.
 */
export function rankProductSuggestions(originalName, products = [], { country, limit = 5, minScore = 35, history } = {}) {
  const doc = text(country).toUpperCase();
  // 업무드라이브 원가자료로 이미 연결된 적이 있는 품명이면 그 품목을 위로 올린다(94~99점, 100은 이름 일치 전용).
  const past = new Map((history?.[historyKey(originalName)] || []).map(entry => [Number(entry.prodKey), entry]));
  const scored = (Array.isArray(products) ? products : [])
    .filter(product => product && product.selectable !== false && (!doc || !product.country || String(product.country).toUpperCase() === doc))
    // 거래가 끝난 거래처([MEL], [오경]) 품목은 원문에 같은 표식이 없으면 후보에서 뺀다.
    .filter(product => allowsDiscontinuedProduct(originalName, product.ProdName))
    .map(product => {
      const base = scoreProductMatch(originalName, product);
      const seen = past.get(Number(product.ProdKey));
      return seen ? { product, score: base === 100 ? 100 : Math.max(base, Math.min(99, 94 + Math.min(5, seen.count))), history: { count: seen.count, lastWeek: seen.lastWeek } }
        : { product, score: base };
    })
    .filter(item => item.score >= minScore)
    .sort((x, y) => y.score - x.score || Number(x.product.ProdKey) - Number(y.product.ProdKey));
  return { exact: scored[0]?.score === 100, items: scored.slice(0, limit) };
}

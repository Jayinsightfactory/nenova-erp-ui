// 인보이스 품목 매칭 보조: ① 나라 불일치 감지 ② 화종 기반 기본 필터링 ③ 영한 색상·농장 약어 동의어 순위.
// 읽기 전용 순수 함수. DB·입고·원가를 바꾸지 않는다. 선택은 항상 사람이 확정한다.
import { historyKey } from './driveMatchHistory.js';
import { allowsDiscontinuedProduct } from './discontinuedVendors.js';

const text = value => String(value ?? '').trim();
const normalize = value => text(value)
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\bwo+l+y\b/g, 'woolly')
  .replace(/\bpremiun\b/g, 'premium')
  .replace(/\blavander\b/g, 'lavender')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

// ── ① 나라 불일치 ─────────────────────────────────────────────
const CHINA_FARMS = /cloud\s*land|hub\s*fresh|melody/i;
const COLOMBIA_FARMS = /ayura|circasia|cactus|tiba|daflor|turflor|eusebio|colibri|construnorte|construnote|prisma|fillco|monika|maxiflores|matina|la gaitana|esperance|funza|invos|mayra|green genie|the elite|flora\s*concept|prestige|el milagro|el redil|aguata|aguaclara|agua\s*clara|zelecta/i;
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

// ── ② 화종 식별 및 화종 기반 필터링 ─────────────────────────────
const FLOWER_FAMILY_DEFS = [
  { code: 'HYDRANGEA', label: '수국', re: /\b(?:hydrangea|hortensia|macrophylla)s?\b|수국/i },
  { code: 'LILY', label: '백합', re: /\b(?:roselily|lily|lilium|oriental\s*lily)s?\b|백합|로즈릴리/i },
  { code: 'CARNATION', label: '카네이션', re: /\b(?:carnation|clavel|minicarnation|mini\s*carnation)s?\b|카네이션/i },
  { code: 'ALSTROEMERIA', label: '알스트로메리아', re: /\b(?:alstroemeria|alstro)s?\b|알스트로메리아|알스트로/i },
  { code: 'CHRYSANTHEMUM', label: '국화', re: /\b(?:chrysanthemum|pompon|pomp|disbud|santini|anastasia)s?\b|국화|폼폰|소국|대국/i },
  { code: 'GYPSOPHILA', label: '안개', re: /\b(?:gypsophila|gyp|xlence|million\s*star)s?\b|안개꽃|안개/i },
  { code: 'EUCALYPTUS', label: '유칼립투스', re: /\b(?:eucalyptus|euca)\b|유칼립투스|유카리/i },
  { code: 'RANUNCULUS', label: '라넌큘러스', re: /\b(?:ranunculus)s?\b|라넌큘러스/i },
  { code: 'TULIP', label: '튤립', re: /\b(?:tulip)s?\b|튤립/i },
  { code: 'PEONY', label: '작약', re: /\b(?:peony|peonies)\b|작약/i },
  { code: 'CALLA', label: '카라', re: /\b(?:calla)s?\b|카라/i },
  { code: 'LIMONIUM', label: '리모늄·스타티스', re: /\b(?:limonium|statice)\b|리모늄|스타티스/i },
  { code: 'ROSE', label: '장미', re: /\b(?:rose|rosa)s?\b|장미/i },
];

export function detectFlowerFamily(input) {
  const combined = typeof input === 'string'
    ? input
    : `${input?.ProdName || ''} ${input?.DisplayName || ''} ${input?.FlowerName || ''}`;
  if (!combined.trim()) return null;
  for (const def of FLOWER_FAMILY_DEFS) {
    if (def.re.test(combined)) return { code: def.code, label: def.label };
  }
  return null;
}

/**
 * 원문 품명(또는 송장 문맥 화종)에서 화종이 식별되면 기본적으로 같은 화종 품목만 남긴다.
 * includeAll=true 이거나 해당 국가에 같은 화종 품목이 0개이면 전체 목록을 그대로 돌려준다.
 */
export function filterProductsByDetectedFamily(originalName, products = [], { fallbackText = '', includeAll = false } = {}) {
  const list = Array.isArray(products) ? products : [];
  const detected = detectFlowerFamily(originalName) || (fallbackText ? detectFlowerFamily(fallbackText) : null);
  if (!detected || includeAll) {
    return { family: detected, filtered: list, applied: false };
  }
  const sameFamily = list.filter(product => {
    const prodFamily = detectFlowerFamily(product);
    return prodFamily?.code === detected.code;
  });
  if (!sameFamily.length) {
    return { family: detected, filtered: list, applied: false };
  }
  return { family: detected, filtered: sameFamily, applied: true };
}

// 공급처명 → 전산 품목 괄호 약어 매칭 (예: CI FLORES BALVERDE -> (BA))
const SUPPLIER_PRODUCT_TAGS = [
  [/balverde/i, ['ba', 'bal']],
  [/florentina/i, ['fl', 'flo']],
  [/antioquia\s*floral/i, ['an', 'ant']],
  [/green\s*land/i, ['gl', 'grl']],
  [/valores/i, ['va', 'val']],
  [/princess/i, ['pr', 'pn', 'pns']],
  [/dawn/i, ['da', 'dw', 'daw']],
  [/pietrasanta/i, ['pi', 'pie']],
  [/lorzate/i, ['lo', 'lor']],
  [/surandina/i, ['su', 'sur']],
  [/chaquiro/i, ['ch', 'cha']],
];

export function supplierProductTagBonus(supplier, product) {
  const rawSupplier = text(supplier);
  if (!rawSupplier) return 0;
  const prodText = `${product?.ProdName || ''} ${product?.DisplayName || ''}`;
  const parenTokens = [...prodText.matchAll(/\(([^()]+)\)/g)]
    .flatMap(m => m[1].toLowerCase().split(/[\s,/.-]+/).filter(Boolean));
  if (!parenTokens.length) return 0;
  for (const [re, tags] of SUPPLIER_PRODUCT_TAGS) {
    if (re.test(rawSupplier) && tags.some(tag => parenTokens.includes(tag))) {
      return 7;
    }
  }
  return 0;
}

// ── ③ 후보 순위 (영한 색상·약어 동의어 확장 포함) ─────────────────
const NOISE = new Set(['rose', 'roses', 'china', 'select', 'grade', 'spray', 'garden', 'co', 'cm', 'the', 'and', 'of', 'stem', 'stems', 'tinted', 'dyed', 'natural', 'fresh', 'cut']);

const COLOR_SYNONYM_RULES = [
  [/\bsuper\s*light\s*pink\b|\bbaby\s*pink\b|연연핑크|베이비핑크/i, ['color_super_light_pink', 'pink']],
  [/\b(?:light\s*pink|pale\s*pink|soft\s*pink)\b|\bp\s*[./-]?\s*pk\b|\bl\s*[./-]?\s*pk\b|(?<!연)연핑크|연분홍/i, ['color_light_pink', 'pink']],
  [/\b(?:dark\s*pink|deep\s*pink)\b|\bd\s*[./-]?\s*pk\b|진핑크/i, ['color_dark_pink', 'pink']],
  [/\b(?:hot\s*pink|shocking\s*pink|fuchsia)\b|\bh\s*[./-]?\s*pk\b|핫핑크|진분홍/i, ['color_hot_pink', 'pink']],
  [/\b(?:light\s*blue|sky\s*blue)\b|\b[lp]\s*[./-]?\s*bl\b|연블루|스카이블루|하늘색/i, ['color_light_blue', 'blue']],
  [/\b(?:dark\s*blue|royal\s*blue|navy)\b|\bd\s*[./-]?\s*bl\b|진블루|로얄블루/i, ['color_dark_blue', 'blue']],
  [/\b(?:lavender|lavander|lilac)\b|라벤더|라벤다|연보라|라일락/i, ['color_lavender']],
  [/\b(?:purple|violet)\b|퍼플|진보라|바이올렛|(?<!연)보라/i, ['color_purple']],
  [/\b(?:esmeralda|emerald)\b|에스메랄다|에메랄드/i, ['color_emerald', 'green']],
  [/\b(?:albaricoque|apricot|peach|salmon)\b|피치|살구|연살구/i, ['color_peach']],
  [/\b(?:white)\b|\bwh\b|화이트|백색/i, ['color_white']],
  [/\b(?:green|lime)\b|그린|라임|초록/i, ['color_green']],
  [/\b(?:blue)\b|(?<!연|진|스카이|로얄)블루|청색/i, ['color_blue']],
  [/\b(?:red|burgundy|wine)\b|레드|버건디|와인/i, ['color_red']],
  [/\b(?:yellow)\b|옐로우|노랑/i, ['color_yellow']],
  [/\b(?:orange)\b|오렌지|주황/i, ['color_orange']],
  [/\b(?:antique)\b|엔틱|앤틱/i, ['style_antique']],
  [/\b(?:jumbo)\b|점보/i, ['grade_jumbo']],
  [/\b(?:mini)\b|미니/i, ['grade_mini']],
];

function sizes(value) {
  const out = [];
  const re = /(\d{2,3})\s*(?:cm)?(?:\s*[-~–]\s*(\d{2,3}))?\s*cm/gi;
  let m;
  while ((m = re.exec(text(value))) !== null) { out.push(Number(m[1])); if (m[2]) out.push(Number(m[2])); }
  return out;
}

function semanticTokens(rawValue) {
  const source = text(rawValue);
  const base = normalize(source)
    .replace(/\d+\s*cm/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 2 && !NOISE.has(word) && !/^\d+$/.test(word));
  const set = new Set(base);
  const family = detectFlowerFamily(source);
  if (family) {
    set.add(`family_${family.code.toLowerCase()}`);
    // Unify English/Korean flower tokens so "(수국)" doesn't dilute precision against "HYDRANGEA"
    set.delete('hydrangea');
    set.delete('hortensia');
    set.delete('수국');
    set.delete('carnation');
    set.delete('clavel');
    set.delete('카네이션');
  }
  for (const [re, tags] of COLOR_SYNONYM_RULES) {
    if (re.test(source)) {
      for (const tag of tags) set.add(tag);
      // Remove raw abbreviation fragments that were absorbed into the canonical color tag
      if (tags[0] === 'color_light_pink') {
        set.delete('light'); set.delete('pink'); set.delete('pk'); set.delete('연핑크');
      } else if (tags[0] === 'color_super_light_pink') {
        set.delete('super'); set.delete('light'); set.delete('pink'); set.delete('연연핑크');
      } else if (tags[0] === 'color_dark_pink') {
        set.delete('dark'); set.delete('pink'); set.delete('pk'); set.delete('진핑크');
      } else if (tags[0] === 'color_hot_pink') {
        set.delete('hot'); set.delete('pink'); set.delete('pk'); set.delete('핫핑크');
      } else if (tags[0] === 'color_lavender') {
        set.delete('lavender'); set.delete('라벤더'); set.delete('라벤다'); set.delete('연보라');
      } else if (tags[0] === 'color_white') {
        set.delete('white'); set.delete('wh'); set.delete('화이트');
      } else if (tags[0] === 'color_emerald') {
        set.delete('esmeralda'); set.delete('emerald'); set.delete('에스메랄다');
      } else if (tags[0] === 'color_peach') {
        set.delete('albaricoque'); set.delete('apricot'); set.delete('peach'); set.delete('피치'); set.delete('살구');
      }
    }
  }
  // Drop 2-letter farm tags in parens like (ba), (fl) from base denominator so they act as bonus, not penalty
  for (const m of source.matchAll(/\(([A-Za-z]{2,3})\)/g)) {
    set.delete(m[1].toLowerCase());
  }
  return [...set];
}

const sameSizes = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

/** 0~100 점수(정수). 이름이 같으면 100. 화종이 서로 다르면 0. */
export function scoreProductMatch(originalName, product, options = {}) {
  const a = normalize(originalName).replace(/\s+/g, ' ');
  const rawCandidates = [
    product?.ProdName,
    product?.DisplayName,
    `${product?.ProdName || ''} ${product?.DisplayName || ''} ${product?.FlowerName || ''}`.trim(),
  ].filter(Boolean);
  const normalizedExact = [product?.ProdName, product?.DisplayName].map(normalize).filter(Boolean);
  if (a && normalizedExact.some(name => name === a)) return 100;

  const sourceFamily = detectFlowerFamily(originalName);
  const prodFamily = detectFlowerFamily(product);
  if (sourceFamily && prodFamily && sourceFamily.code !== prodFamily.code) {
    return 0;
  }

  const invoiceTokens = semanticTokens(originalName);
  if (!invoiceTokens.length) return 0;
  let best = 0;
  for (const rawName of rawCandidates) {
    const catalogTokens = semanticTokens(rawName);
    if (!catalogTokens.length) continue;
    const overlap = invoiceTokens.filter(word => catalogTokens.includes(word)).length;
    if (!overlap) continue;
    const recall = overlap / invoiceTokens.length;
    const precision = overlap / catalogTokens.length;
    let value = 2 * recall * precision / (recall + precision);
    const left = sizes(originalName), right = sizes(rawName);
    if (left.length && right.length) value = sameSizes(left, right) ? Math.min(1, value + 0.1) : value * 0.4;
    else if (left.length || right.length) value *= 0.9;
    best = Math.max(best, value);
  }
  if (best <= 0) return 0;
  const farmBonus = options?.supplier ? supplierProductTagBonus(options.supplier, product) : 0;
  // 이름이 완전히 같지 않으면 99를 넘기지 않는다 — 100은 "이름 일치"만 뜻한다.
  return Math.min(99, Math.round(best * 100) + farmBonus);
}

/**
 * 한 행의 후보 순위. 같은 나라 품목만, 화종이 식별되면 같은 화종 우선, 점수 내림차순.
 * 반환: { exact, family, items:[{ product, score }] } — exact=true면 이름이 100% 일치해 버튼이 필요 없다.
 */
export function rankProductSuggestions(originalName, products = [], { country, supplier = '', limit = 5, minScore = 35, history } = {}) {
  const doc = text(country).toUpperCase();
  const past = new Map((history?.[historyKey(originalName)] || []).map(entry => [Number(entry.prodKey), entry]));
  const countryScoped = (Array.isArray(products) ? products : [])
    .filter(product => product && product.selectable !== false && (!doc || !product.country || String(product.country).toUpperCase() === doc))
    .filter(product => allowsDiscontinuedProduct(originalName, product.ProdName));

  const { family, filtered } = filterProductsByDetectedFamily(originalName, countryScoped);
  const scored = filtered
    .map(product => {
      const base = scoreProductMatch(originalName, product, { supplier });
      const seen = past.get(Number(product.ProdKey));
      return seen
        ? { product, score: base === 100 ? 100 : Math.max(base, Math.min(99, 94 + Math.min(5, seen.count))), history: { count: seen.count, lastWeek: seen.lastWeek } }
        : { product, score: base };
    })
    .filter(item => item.score >= minScore)
    .sort((x, y) => y.score - x.score || Number(x.product.ProdKey) - Number(y.product.ProdKey));
  return { exact: scored[0]?.score === 100, family, items: scored.slice(0, limit) };
}

export function defaultInvoiceMatchSuggestion(originalName, products, country) {
  const scope = text(country).toUpperCase();
  if (!scope) return null;
  const scoped = (products || []).filter(product => text(product?.country).toUpperCase() === scope);
  const { items: [first, second] } = rankProductSuggestions(originalName, scoped, { country: scope, limit: 2, minScore: 90 });
  return first && (!second || first.score > second.score) ? first : null;
}

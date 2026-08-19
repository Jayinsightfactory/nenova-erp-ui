// lib/colombiaFlowerClassification.js — 콜롬비아 4품목(장미/카네이션/알스트로/루스커스) 무게배분
// 분류의 단일 진실 소스. DB 의존 없는 순수 모듈.
//
// 2026-08-12 결함수정: lib/customsForwarding.js의 CASE_COLOMBIA_ALLOC(SQL, colombiaBoxQtyByCategory
// 전용)이 Product.FlowerName의 한글 표기(장미/카네이션/알스트로/루스커스)만 매칭해, FlowerName이
// 영문(ROSE/CARNATION/ALSTROEMERIA/RUSCUS)으로 저장된 품목은 그외통관비/포워딩 무게배분(박스당무게×
// 박스수량 비율)에서 통째로 빠졌다(카테고리 미배정 → 배분 대상 박스수량 0). 이 모듈이 한/영 토큰
// 목록을 하나로 관리하고, FlowerName뿐 아니라 ProdName도 함께 검사하며, 운송료/SERVICE FEE/현지상차
// 운임/GW·CW 무게 placeholder 행(lib/profitReportClassification.js isNonStockableItem과 동일 기준)은
// 항상 분류 대상에서 제외한다. lib/customsForwarding.js의 CASE_COLOMBIA_ALLOC(SQL)은 이 토큰
// 목록과 같은 언어 쌍을 매칭하며, __tests__/colombiaFlowerClassification.test.js가 JS↔SQL 일치를
// 대조한다.
import { isNonStockableItem } from './profitReportClassification.js';

export const COLOMBIA_ALLOC_CATEGORY_KEYS = [
  '콜롬비아 장미', '콜롬비아 카네이션', '콜롬비아 알스트로', '콜롬비아 루스커스',
];

export const COLOMBIA_HYDRANGEA_CATEGORY = '콜롬비아 수국';
export const COLOMBIA_SHARED_APOLLO_CATEGORY = '콜롬비아 공유APOLLO';
export const COLOMBIA_ALLOC_POOL_DEFAULT = '콜카장알루';
export const COLOMBIA_ALLOC_POOL_WITH_HYDRANGEA = '콜카장알루수국';

const HYDRANGEA_RE = /수국|hydrangea/i;
const FOUR_ITEM_RE = /장미|rose|카네이션|carnation|알스트로|alstro|루스커스|ruscus/i;
const APOLLO_RE = /apollo|freightwise/i;

export function isColombiaHydrangeaPool(poolOrFlag) {
  if (poolOrFlag === true || Number(poolOrFlag) === 1) return true;
  return String(poolOrFlag || '').trim() === COLOMBIA_ALLOC_POOL_WITH_HYDRANGEA;
}

export function colombiaAllocPoolLabel(poolOrFlag) {
  return isColombiaHydrangeaPool(poolOrFlag)
    ? COLOMBIA_ALLOC_POOL_WITH_HYDRANGEA
    : COLOMBIA_ALLOC_POOL_DEFAULT;
}

/** 수국 박스는 화면에서 콜카장알루수국을 켠 경우에만 배분 대상에 넣는다. SQL 4키는 건드리지 않는다. */
export function applyColombiaHydrangeaBoxes(boxQty, hydrangeaBoxes, includeHydrangea) {
  const out = { ...(boxQty || {}) };
  delete out[COLOMBIA_HYDRANGEA_CATEGORY];
  if (includeHydrangea && Number(hydrangeaBoxes) > 0) {
    out[COLOMBIA_HYDRANGEA_CATEGORY] = Number(hydrangeaBoxes);
  }
  return out;
}

/** 카장알루 기본 4개. 화면에서 콜카장알루수국을 켠 경우에만 수국을 앞에 붙인다. */
export function colombiaAllocCategories({ includeHydrangea } = {}) {
  return includeHydrangea
    ? [COLOMBIA_HYDRANGEA_CATEGORY, ...COLOMBIA_ALLOC_CATEGORY_KEYS]
    : [...COLOMBIA_ALLOC_CATEGORY_KEYS];
}

export function isColombiaFourItemCategory(category) {
  return COLOMBIA_ALLOC_CATEGORY_KEYS.includes(String(category || ''));
}

/** 같은 APOLLO AWB에 수국과 카장알루가 함께 있으면 통관·트럭·항공료 풀을 합친다. */
export function isColombiaSharedApolloShipment({
  farmName, invoiceNo, flowerNames = [], prodNames = [],
} = {}) {
  const farm = String(farmName || '');
  const invoice = String(invoiceNo || '');
  const names = [...flowerNames, ...prodNames].map((value) => String(value || ''));
  const hasHydrangea = names.some((name) => HYDRANGEA_RE.test(name));
  const hasFourItem = names.some((name) => FOUR_ITEM_RE.test(name));
  const isApollo = APOLLO_RE.test(farm) || APOLLO_RE.test(invoice);
  return Boolean(isApollo && hasHydrangea && hasFourItem);
}

export function isColombiaSharedApolloContext(categories = []) {
  const values = [...categories].map((value) => String(value || ''));
  return values.includes(COLOMBIA_HYDRANGEA_CATEGORY) && values.some(isColombiaFourItemCategory);
}

/** 카테고리 키(한글) → 매칭 토큰(한글+영문). 토큰은 소문자/공백제거 후 부분일치(includes)로 비교한다.
 * "rose"/"alstro"는 4자 이상이라 lib/countryClassification.js의 3자 이하 짧은토큰 오분류 방지 규칙
 * 대상이 아니다 — 이 도메인(수입 절화 품목명)에는 "rose"/"alstro"가 우연히 부분일치할 다른 품종·
 * 국가명이 없다. */
export const COLOMBIA_ALLOC_TOKEN_MAP = [
  { key: '콜롬비아 장미', tokens: ['장미', 'rose'] },
  { key: '콜롬비아 카네이션', tokens: ['카네이션', 'carnation'] },
  { key: '콜롬비아 알스트로', tokens: ['알스트로', 'alstroemeria', 'alstromeria', 'alstro'] },
  { key: '콜롬비아 루스커스', tokens: ['루스커스', 'ruscus'] },
];

const normalize = (value) => String(value || '').trim().toLowerCase();

/**
 * 콜롬비아 4품목 분류 — FlowerName을 먼저 보고, 못 찾으면 ProdName도 검사한다(영문 품명에만
 * 품종이 적힌 경우 대비). 운송료/SERVICE FEE/현지상차운임/GW·CW 무게 placeholder 행은 항상 null
 * (무게배분 대상 아님). 호출부(colombiaBoxQtyByCategory)는 이미 CounName='콜롬비아' 범위로
 * 스코프한 뒤 이 함수를 쓴다 — "country-scoped" 분류.
 */
export function classifyColombiaAllocCategory(flowerName, prodName) {
  if (isNonStockableItem(prodName)) return null;
  const flower = normalize(flowerName);
  const product = normalize(prodName);
  for (const { key, tokens } of COLOMBIA_ALLOC_TOKEN_MAP) {
    if (tokens.some((token) => flower.includes(token) || product.includes(token))) return key;
  }
  return null;
}

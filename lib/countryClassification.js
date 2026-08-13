// lib/countryClassification.js — 공용 국가 분류 규칙 (DB/React 의존 없는 순수 모듈)
//
// 배경(2026-08-11 결함수정): customsForwarding.js의 baseCountry()는 자유입력 문자열(운송장/AWB/
// 농장 컨텍스트)에서 한글+영문 토큰을 매칭해 국가를 추정하고, profitReport.js의 CASE_CATEGORY는
// SQL에서 p.CounName(DB 저장값, 한글만)을 LIKE 매칭한다. 두 코드가 각자 국가 키 문자열을 따로
// 들고 있으면 한쪽만 고치고 다른 쪽을 빠뜨리는 회귀가 생긴다. 이 모듈이 "국가 키 이름 집합"과
// "한/영 매칭 토큰" 단일 진실 소스이며, customsForwarding.js/freightCalc.js가 이를 사용한다.
//
// CASE_CATEGORY(SQL)는 profitReportCountryResolver.js의 생성기를 단일 진실 소스로 사용한다. 이 모듈은
// 생성 SQL의 "카테고리 키 이름" 집합(PROFIT_REPORT_CATEGORY_KEYS)을 공용 참조로 제공한다.

/** 국가 키(한글, canonical) → 매칭 토큰 배열(한글+영문). 토큰은 소문자/공백제거 후 부분일치(includes)로 비교한다. */
export const COUNTRY_TOKEN_MAP = [
  { key: '콜롬비아', tokens: ['콜롬비아', 'colombia'] },
  { key: '네덜란드', tokens: ['네덜란드', 'netherlands', 'holland', 'nl'] },
  { key: '호주', tokens: ['호주', 'australia', 'aus'] },
  { key: '태국', tokens: ['태국', 'thailand'] },
  { key: '중국', tokens: ['중국', 'china'] },
  { key: '에콰도르', tokens: ['에콰도르', 'ecuador'] },
  { key: '미국', tokens: ['미국', 'usa', 'unitedstates', 'us'] },
  { key: '이스라엘', tokens: ['이스라엘', 'israel'] },
  { key: '뉴질랜드', tokens: ['뉴질랜드', 'newzealand', 'nz'] },
  { key: '일본', tokens: ['일본', 'japan'] },
  { key: '베트남', tokens: ['베트남', 'vietnam'] },
  { key: '에티오피아', tokens: ['에티오피아', 'ethiopia'] },
];

/** 국내/한국 — baseCountry()가 null(=해외 아님)을 반환해야 하는 토큰. */
export const DOMESTIC_TOKENS = ['국내', '한국', 'korea', 'domestic'];

const normalizeToken = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');

// 2026-08-11 결함수정 3: nl/us/aus/nz처럼 짧은(3자 이하) 순수 영문 토큰은 "Ruscus"(⊃us),
// "Saussurea"(⊃aus) 같은 무관한 품목명·고유명사 안에이 우연히 부분문자열로 나타나 오분류를
// 일으킨다. 이런 토큰은 값 안의 개별 단어와 완전히 같을 때만 인정한다(단어 경계 일치).
// 한글 토큰과 4자 이상 영문 전체국가명(netherlands/australia 등)은 오분류 위험이 낮으므로
// 기존 부분일치(includes)를 그대로 유지한다.
const SHORT_LATIN_TOKEN_MAX_LEN = 3;
const isShortLatinToken = (t) => /^[a-z0-9]+$/.test(t) && t.length <= SHORT_LATIN_TOKEN_MAX_LEN;

const splitWords = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .split(/[^a-z0-9가-힣]+/)
  .filter(Boolean);

/**
 * 자유입력 문자열(운송장/AWB/농장명/Product.CounName 등)에서 국가 키(한글 canonical)를 추정한다.
 * 매칭 실패 또는 국내/한국이면 null.
 * customsForwarding.js의 loadWarehouseGw/autoForwardingByCountry, freightCalc.js의 countryToCurrency가
 * 동일 규칙을 쓰도록 이 함수 하나로 통일한다.
 */
export function baseCountry(value) {
  const token = normalizeToken(value);
  if (!token) return null;
  if (DOMESTIC_TOKENS.some((t) => token === normalizeToken(t))) return null;
  const words = splitWords(value);
  for (const { key, tokens } of COUNTRY_TOKEN_MAP) {
    const matched = tokens.some((raw) => {
      const t = normalizeToken(raw);
      if (isShortLatinToken(t)) return words.includes(t);
      return token.includes(t);
    });
    if (matched) return key;
  }
  return null;
}

/**
 * lib/profitReport.js의 CASE_CATEGORY(SQL)가 산출하는 카테고리 키 이름 전체 집합.
 * SQL은 그대로 유지하되(업무 규칙 검증됨), 이 목록과 SQL의 리터럴 문자열 집합이 항상 같은지
 * __tests__/profitReportCountryClassificationParity.test.js 가 정적으로 대조한다.
 */
export const PROFIT_REPORT_CATEGORY_KEYS = [
  '콜롬비아 수국',
  '콜롬비아 카네이션',
  '콜롬비아 장미',
  '콜롬비아 루스커스',
  '콜롬비아 알스트로',
  '네덜란드',
  '호주',
  '태국',
  '중국',
  '에콰도르',
  '미국',
  '이스라엘',
  '뉴질랜드',
  '일본',
  '베트남',
  '국내',
  '기타(미분류)',
];

/**
 * 국가 키(한글) → 인보이스 통화. freightCalc.js(COUNTRY_TO_CURRENCY)와
 * profitReport.js(CATEGORY_CURRENCY)가 같은 값을 쓰도록 참조용으로 둔다.
 * 호주=AUD (2026-08-11 결함수정: 이전에는 USD로 잘못 매핑되어 있었음).
 */
export const COUNTRY_CURRENCY_MAP = {
  '국내': 'KRW',
  '한국': 'KRW',
  '콜롬비아': 'USD',
  '에콰도르': 'USD',
  '미국': 'USD',
  '이스라엘': 'USD',
  '태국': 'USD',
  '호주': 'AUD',
  '뉴질랜드': 'USD',
  '에티오피아': 'USD',
  '베트남': 'USD',
  '네덜란드': 'EUR',
  '중국': 'CNY',
  '일본': 'JPY',
};

/** 국가명(한글 정확값 우선, 실패 시 한/영 토큰 정규화) → 통화코드. 매칭 실패시 'USD'. */
export function countryToCurrency(counName) {
  if (!counName) return 'USD';
  const key = String(counName).trim();
  if (COUNTRY_CURRENCY_MAP[key] != null) return COUNTRY_CURRENCY_MAP[key];
  const normalized = baseCountry(key);
  if (normalized && COUNTRY_CURRENCY_MAP[normalized] != null) return COUNTRY_CURRENCY_MAP[normalized];
  return 'USD';
}

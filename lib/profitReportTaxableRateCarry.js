// lib/profitReportTaxableRateCarry.js — 매출이익 보고서 R(과세환율) 이월(carry) 정책.
//
// ## 왜 필요한가
// resolveTaxableRate()(lib/taxableExchangeRate.js)는 "정확히 그 OrderYear+MajorWeek" 원천만 자동
// 적용하고, 그 주차에 입고(재고화 대상 매입)가 있는데 정확한 원천이 없으면 절대 이월하지 않는다(결함
// 재발 방지). 그런데 그 주차에 **입고 자체가 없으면** R을 쓸 곳이 실질적으로 없고, 재고 평가에는 여전히
// "가장 최근에 실제로 적용됐던 정확한 과세환율"이 필요하다. 이 모듈은 그 경우에만, 아래 규칙을 그대로
// 따르는 이월을 계산한다:
//
//   1. 이번 차수에 재고화 대상 매입수량이 있고 정확한 원천이 없으면 → 이월하지 않는다. missing 그대로.
//   2. 이번 차수에 재고화 대상 매입이 없으면 → 직전 대차수로 한 칸씩 걸어가며 "정확한 원천"을 찾는다.
//      - 그 주에 정확한 원천이 있으면 그 값을 이월값으로 쓰고 멈춘다(성공).
//      - 그 주에 매입이 없으면 계속 더 걸어간다.
//      - 그 주에 매입은 있는데 정확한 원천이 없으면 그 자리에서 멈춘다(미해결 — 이월하지 않음).
//   3. 최대 53스텝(1년 이상 무한 루프 방지)까지만 걷는다.
//   4. 01차의 직전은 전년도 52차다. 같은 차수 번호라도 다른 연도 데이터끼리 섞지 않는다(각 스텝은
//      항상 "바로 그 전 실제 대차수"만 본다).
//   5. CurrencyMaster 현재 환율은 이월 탐색에서도 "정확한 원천"으로 절대 취급하지 않는다(제안 전용
//      원칙은 이월에도 그대로 적용된다) — 아래 resolveExactRateForWeek가 currencyMasterRate를 항상
//      null로 넘긴다.
//
// 순수 정책 함수(priorMajorWeek/resolveExactRateForWeek/walkCarry)는 DB에 의존하지 않아 단위 테스트가
// 가능하고, resolveCarriedRatesForCategories()만 "차수별 데이터를 어떻게 불러올지"를 호출부가 주입하는
// 얇은 오케스트레이션이다. GET 경로 전용이며 어떤 값도 자동으로 저장하지 않는다(그 값을 실제로 저장하려면
// 담당자가 화면에서 확인 후 기존 과세환율 저장 경로로 명시 저장해야 한다).

import { resolveTaxableRate, RATE_SOURCE } from './taxableExchangeRate.js';
import { getHistoricalTaxableRate } from './profitReportHistoricalCustoms.js';

/** 무한 루프 방지 상한 — 1년(52주) + 1 버퍼. */
export const MAX_CARRY_STEPS = 53;

export const CARRIED_RATE_SOURCE = 'carried_taxable_rate';

/** 바로 직전 대차수. 01차는 전년도 52차로 넘어간다(연도 경계, 교차연도 동일차수 혼용 없음). */
export function priorMajorWeek(orderYear, major) {
  const m = Number(major);
  if (!Number.isFinite(m) || m <= 1) {
    return { orderYear: String(Number(orderYear) - 1), major: '52' };
  }
  return { orderYear: String(orderYear), major: String(m - 1).padStart(2, '0') };
}

/**
 * 한 차수의 "정확한" 원천만으로 R을 찾는다(전차수/통화마스터 제안은 절대 섞지 않음) — 이월 탐색
 * 한 스텝에서 그 차수 자체가 정확한 원천을 갖는지 확인하는 순수 함수.
 * @param {{orderYear:string, major:string, category:string, currency:?string, manualRate:?number,
 *          invoiceRates:object, savedRates:{byCategory:object, byCurrency:object}, kcsRates:object}} input
 * @returns {?{rate:number, source:string}}
 */
export function resolveExactRateForWeek({ orderYear, major, category, currency, manualRate, invoiceRates, savedRates, kcsRates }) {
  if (Number(manualRate) > 0) {
    return { rate: Number(manualRate), source: RATE_SOURCE.MANUAL_INPUT };
  }
  const resolved = resolveTaxableRate({
    snapshotRate: invoiceRates?.[category] != null ? Number(invoiceRates[category]) : null,
    savedByCategory: savedRates?.byCategory?.[category] || null,
    savedByCurrency: currency ? savedRates?.byCurrency?.[currency] || null : null,
    historicalRate: getHistoricalTaxableRate(orderYear, major, category),
    currency,
    currencyMasterRate: null, // 이월도 "제안 전용" 원칙 그대로 — CurrencyMaster는 정확한 원천이 아니다.
    previousWeekRate: null,
    previousWeekLabel: null,
    kcsRate: kcsRates?.byCategory?.[category]?.rate ?? null,
    kcsDetail: kcsRates?.byCategory?.[category]?.detail ?? null,
  });
  if (!resolved || resolved.source === RATE_SOURCE.MISSING || !(Number(resolved.rate) > 0)) return null;
  return { rate: Number(resolved.rate), source: resolved.source };
}

/** 한국어 이월 근거 메모. */
export function formatCarryNote(sourceYear, sourceMajor) {
  return `이번 차수 입고가 없어 ${sourceYear}년 ${Number(sourceMajor)}차 과세환율을 이어 사용`;
}

/**
 * 순수 이월 탐색(단일 카테고리) — 매 스텝의 컨텍스트(그 차수의 정확한 원천 입력 + 매입수량)를
 * getWeekContext(orderYear, major)로 주입받는다(동기/비동기 모두 허용, 호출부가 캐싱 책임을 진다).
 * @param {{orderYear:string, major:string, category:string, currency:?string,
 *          getWeekContext:(y:string,m:string)=>({invoiceRates, savedRates, kcsRates, purchaseQty}|Promise<...>),
 *          maxSteps?:number}} input
 */
export async function walkCarry({ orderYear, major, category, currency, getWeekContext, maxSteps = MAX_CARRY_STEPS }) {
  let y = String(orderYear);
  let m = String(major);
  for (let depth = 1; depth <= maxSteps; depth += 1) {
    const prior = priorMajorWeek(y, m);
    y = prior.orderYear;
    m = prior.major;
    const ctx = await getWeekContext(y, m);
    const exact = resolveExactRateForWeek({
      orderYear: y, major: m, category, currency,
      manualRate: ctx?.manual?.[category]?.R,
      invoiceRates: ctx?.invoiceRates, savedRates: ctx?.savedRates, kcsRates: ctx?.kcsRates,
    });
    if (exact) {
      return {
        rate: exact.rate,
        sourceYear: y,
        sourceMajor: m,
        originalSource: exact.source,
        carryDepth: depth,
        note: formatCarryNote(y, m),
      };
    }
    const purchaseQty = Number(ctx?.purchaseQty?.[category] || 0);
    if (purchaseQty > 0) return null; // 매입은 있는데 정확한 원천이 없음 — 미해결, 이월 중단
    // 매입 자체가 없는 차수 — 계속 더 걸어간다
  }
  return null;
}

/**
 * 여러 카테고리를 한 번에 이월 탐색 — 걷는 동안 만나는 각 차수(y,m)마다 fetchWeekContext(y,m)을
 * "딱 한 번만" 호출하고(공유 캐시), 그 결과를 남아있는 모든 미해결 카테고리가 함께 재사용한다
 * (카테고리별 반복 DB 호출 금지). fetchWeekContext는 호출부가 배치로 구현한다(예: 그 차수의
 * invoiceRatesByCategory/loadTaxableRates/kcsRatesByCategory/purchaseQtyByCategory를 Promise.all).
 *
 * @param {{orderYear:string, major:string,
 *          categories: Array<{key:string, currency:?string}>,
 *          currentExactByCategory: Record<string, ?{rate:number, source:string}>,
 *          currentPurchaseQtyByCategory: Record<string, number>,
 *          fetchWeekContext: (y:string, m:string)=>Promise<{invoiceRates,savedRates,kcsRates,purchaseQty}>,
 *          maxSteps?: number}} input
 * @returns {Promise<Record<string, {rate:number, sourceYear:string, sourceMajor:string,
 *           originalSource:string, carryDepth:number, note:string}>>}
 */
export async function resolveCarriedRatesForCategories({
  orderYear, major, categories, currentExactByCategory = {}, currentPurchaseQtyByCategory = {},
  fetchWeekContext, maxSteps = MAX_CARRY_STEPS,
}) {
  const pending = new Map();
  for (const c of categories || []) {
    if (!c || !c.key) continue;
    const exact = currentExactByCategory[c.key];
    const hasExact = exact && Number(exact.rate) > 0;
    const qty = Number(currentPurchaseQtyByCategory[c.key] || 0);
    // 규칙 1: 이번 차수에 재고화 대상 매입이 있으면(양수) — 정확한 원천이 없어도 이월 대상이 아니다.
    if (hasExact || qty > 0) continue;
    pending.set(c.key, c);
  }

  const results = {};
  if (!pending.size) return results;

  const weekCache = new Map();
  const getWeekContext = async (y, m) => {
    const cacheKey = `${y}-${m}`;
    if (!weekCache.has(cacheKey)) weekCache.set(cacheKey, fetchWeekContext(y, m));
    return weekCache.get(cacheKey);
  };

  let y = String(orderYear);
  let m = String(major);
  for (let depth = 1; depth <= maxSteps && pending.size; depth += 1) {
    const prior = priorMajorWeek(y, m);
    y = prior.orderYear;
    m = prior.major;
    const ctx = await getWeekContext(y, m);
    for (const [key, def] of [...pending]) {
      const exact = resolveExactRateForWeek({
        orderYear: y, major: m, category: key, currency: def.currency,
        manualRate: ctx?.manual?.[key]?.R,
        invoiceRates: ctx?.invoiceRates, savedRates: ctx?.savedRates, kcsRates: ctx?.kcsRates,
      });
      if (exact) {
        results[key] = {
          rate: exact.rate,
          sourceYear: y,
          sourceMajor: m,
          originalSource: exact.source,
          carryDepth: depth,
          note: formatCarryNote(y, m),
        };
        pending.delete(key);
        continue;
      }
      const purchaseQty = Number(ctx?.purchaseQty?.[key] || 0);
      if (purchaseQty > 0) pending.delete(key); // 미해결 — 이월 중단, missing 유지
    }
  }
  return results;
}

/** 요청 1건 안에서 재사용할 차수 컨텍스트 캐시 팩토리 — fetchWeekContext(y,m)를 (y,m) 조합당
 * 한 번만 실행하도록 감싼다. 같은 요청에서 여러 resolveCarriedRatesForCategories 호출(예:
 * 이번 차수 행 R + AUD 재고 근거 + 전차수 평가)이 겹치는 과거 차수를 다시 조회하지 않게 한다. */
export function createWeekContextCache(fetchWeekContextRaw) {
  const cache = new Map();
  return async (y, m) => {
    const cacheKey = `${y}-${m}`;
    if (!cache.has(cacheKey)) cache.set(cacheKey, fetchWeekContextRaw(y, m));
    return cache.get(cacheKey);
  };
}

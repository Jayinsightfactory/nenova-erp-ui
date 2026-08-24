// lib/profitReportTaxableRateCarry.js — 매출이익 보고서 R(과세환율) 이월(carry) 정책 회귀 테스트.
//
// 검증 범위(2026-08-24 이월 정책 도입):
//   - 정확한 원천이 있으면 이월 시도 자체를 하지 않는다("exact wins").
//   - 이번 차수에 재고화 대상 매입이 있으면 정확한 원천이 없어도 절대 이월하지 않는다(missing 유지).
//   - 매입이 없는 연속 차수는 계속 걸어가고, 정확한 원천을 만나면 그 자리에서 멈춘다(AUD/다른 통화 모두).
//   - 매입은 있는데 정확한 원천이 없는 차수를 만나면 그 자리에서 멈추고 미해결로 남는다(carry 없음).
//   - 01차의 직전은 전년도 52차이고, 연도 경계 밖에서는 같은 대차수라도 연도가 섞이지 않는다.
//   - 이월 provenance(sourceYear/sourceMajor/originalSource/carryDepth/note)와 한국어 문구 형식.
//   - carry는 순수 조회 함수만 쓰고 어떤 DB write/DDL 경로도 참조하지 않는다(GET-only 계약).
//
// 실행: node __tests__/profitReportTaxableRateCarry.test.js
// DB/네트워크를 전혀 쓰지 않는다 — 모든 차수 컨텍스트는 인메모리 mock으로 주입한다.
let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

// 인메모리 week 컨텍스트 — { [orderYear]: { [major]: { manual, invoiceRates, savedRates, kcsRates, purchaseQty } } }
function buildWeekWorld(spec) {
  return async (y, m) => {
    const week = spec?.[y]?.[m];
    if (week) return week;
    return { manual: {}, invoiceRates: {}, savedRates: { byCategory: {}, byCurrency: {} }, kcsRates: { byCategory: {} }, purchaseQty: {} };
  };
}

function countingFetch(fn) {
  const calls = [];
  const wrapped = async (y, m) => {
    calls.push(`${y}-${m}`);
    return fn(y, m);
  };
  wrapped.calls = calls;
  return wrapped;
}

async function main() {
  const {
    priorMajorWeek, resolveExactRateForWeek, walkCarry, resolveCarriedRatesForCategories,
    createWeekContextCache, formatCarryNote, MAX_CARRY_STEPS, CARRIED_RATE_SOURCE,
  } = await import('../lib/profitReportTaxableRateCarry.js');
  const { RATE_SOURCE } = await import('../lib/taxableExchangeRate.js');

  console.log('=== priorMajorWeek — 연도 경계/교차연도 비혼용 ===');
  check('중간 차수는 같은 연도에서 -1', JSON.stringify(priorMajorWeek('2026', '33')) === JSON.stringify({ orderYear: '2026', major: '32' }));
  check('01차의 직전은 전년도 52차', JSON.stringify(priorMajorWeek('2026', '01')) === JSON.stringify({ orderYear: '2025', major: '52' }));
  check('major=1(숫자)도 동일하게 처리', JSON.stringify(priorMajorWeek('2027', 1)) === JSON.stringify({ orderYear: '2026', major: '52' }));

  console.log('\n=== 1) exact wins — 정확한 원천이 있으면 이월 시도 자체를 안 한다 ===');
  {
    const fetchWeekContext = countingFetch(buildWeekWorld({}));
    const results = await resolveCarriedRatesForCategories({
      orderYear: '2026', major: '33',
      categories: [{ key: '호주', currency: 'AUD' }],
      currentExactByCategory: { 호주: { rate: 1234.5, source: RATE_SOURCE.FREIGHT_COST_SNAPSHOT } },
      currentPurchaseQtyByCategory: { 호주: 0 },
      fetchWeekContext,
    });
    check('정확한 원천이 있으면 결과에 없음(carry 미적용)', results.호주 === undefined);
    check('정확한 원천이 있으면 과거 차수를 전혀 조회하지 않음', fetchWeekContext.calls.length === 0, JSON.stringify(fetchWeekContext.calls));
  }

  console.log('\n=== 2) AU 33차 매입 없음 → 32차 정확 원천으로 이월 ===');
  {
    const world = {
      2026: {
        '32': { invoiceRates: { 호주: 1100.25 }, savedRates: { byCategory: {}, byCurrency: {} }, kcsRates: { byCategory: {} }, purchaseQty: { 호주: 500 } },
      },
    };
    const fetchWeekContext = countingFetch(buildWeekWorld(world));
    const results = await resolveCarriedRatesForCategories({
      orderYear: '2026', major: '33',
      categories: [{ key: '호주', currency: 'AUD' }],
      currentExactByCategory: { 호주: null },
      currentPurchaseQtyByCategory: { 호주: 0 },
      fetchWeekContext,
    });
    const c = results.호주;
    check('32차 FreightCost 스냅샷을 이월값으로 채택', c && c.rate === 1100.25, JSON.stringify(c));
    check('sourceYear/sourceMajor가 32차를 가리킴', c && c.sourceYear === '2026' && c.sourceMajor === '32');
    check('originalSource가 그 차수의 실제 원천 태그', c && c.originalSource === RATE_SOURCE.FREIGHT_COST_SNAPSHOT);
    check('carryDepth=1(한 칸만 이동)', c && c.carryDepth === 1);
    check('33차 자신은 조회하지 않고 32차만 조회', fetchWeekContext.calls.length === 1 && fetchWeekContext.calls[0] === '2026-32');
  }

  console.log('\n=== 3) 연속 무매입 구간을 계속 걸어가 31차에서 발견 ===');
  {
    const world = {
      2026: {
        '32': { invoiceRates: {}, savedRates: { byCategory: {}, byCurrency: {} }, kcsRates: { byCategory: {} }, purchaseQty: { 호주: 0 } },
        '31': { invoiceRates: {}, savedRates: { byCategory: { 호주: { rate: 1050.75, source: RATE_SOURCE.SAVED_OFFICIAL_WEEK } }, byCurrency: {} }, kcsRates: { byCategory: {} }, purchaseQty: { 호주: 300 } },
      },
    };
    const fetchWeekContext = countingFetch(buildWeekWorld(world));
    const results = await resolveCarriedRatesForCategories({
      orderYear: '2026', major: '33',
      categories: [{ key: '호주', currency: 'AUD' }],
      currentExactByCategory: { 호주: null },
      currentPurchaseQtyByCategory: { 호주: 0 },
      fetchWeekContext,
    });
    const c = results.호주;
    check('32차(매입 0)를 건너뛰고 31차 저장값을 채택', c && c.rate === 1050.75, JSON.stringify(c));
    check('sourceMajor=31, carryDepth=2', c && c.sourceMajor === '31' && c.carryDepth === 2);
    check('32→31 두 차수만 조회(카테고리 반복 조회 없음)', fetchWeekContext.calls.length === 2);
  }

  console.log('\n=== 4) 다른 통화(태국/THB)도 동일 규칙으로 이월 ===');
  {
    const world = {
      2026: {
        '32': { invoiceRates: {}, savedRates: { byCategory: {}, byCurrency: { THB: { rate: 41.2, source: RATE_SOURCE.SAVED_OFFICIAL_WEEK } } }, kcsRates: { byCategory: {} }, purchaseQty: { 태국: 0 } },
      },
    };
    const fetchWeekContext = buildWeekWorld(world);
    const results = await resolveCarriedRatesForCategories({
      orderYear: '2026', major: '33',
      categories: [{ key: '태국', currency: 'THB' }],
      currentExactByCategory: { 태국: null },
      currentPurchaseQtyByCategory: { 태국: 0 },
      fetchWeekContext,
    });
    check('THB 통화 기본행도 이월됨', results.태국 && results.태국.rate === 41.2, JSON.stringify(results.태국));
  }

  console.log('\n=== 4-b) 직전 차수 담당자 확정 환율도 정확한 원천으로 이월 ===');
  {
    const world = {
      2026: {
        '32': { manual: { 호주: { R: 1088.4 } }, invoiceRates: {}, savedRates: { byCategory: {}, byCurrency: {} }, kcsRates: { byCategory: {} }, purchaseQty: { 호주: 0 } },
      },
    };
    const results = await resolveCarriedRatesForCategories({
      orderYear: '2026', major: '33',
      categories: [{ key: '호주', currency: 'AUD' }],
      currentExactByCategory: { 호주: null },
      currentPurchaseQtyByCategory: { 호주: 0 },
      fetchWeekContext: buildWeekWorld(world),
    });
    check('이전 WebProfitReport 수기 확정 R을 이어 사용', results.호주?.rate === 1088.4 && results.호주?.originalSource === RATE_SOURCE.MANUAL_INPUT, JSON.stringify(results.호주));
  }

  console.log('\n=== 5) 매입은 있는데 정확한 원천이 없는 차수를 만나면 그 자리에서 중단(미해결) ===');
  {
    const world = {
      2026: {
        '32': { invoiceRates: {}, savedRates: { byCategory: {}, byCurrency: {} }, kcsRates: { byCategory: {} }, purchaseQty: { 호주: 40 } }, // 매입 있음, 원천 없음
        '31': { invoiceRates: { 호주: 999 }, savedRates: { byCategory: {}, byCurrency: {} }, kcsRates: { byCategory: {} }, purchaseQty: { 호주: 0 } }, // 더 과거에는 원천이 있어도 무시
      },
    };
    const fetchWeekContext = countingFetch(buildWeekWorld(world));
    const results = await resolveCarriedRatesForCategories({
      orderYear: '2026', major: '33',
      categories: [{ key: '호주', currency: 'AUD' }],
      currentExactByCategory: { 호주: null },
      currentPurchaseQtyByCategory: { 호주: 0 },
      fetchWeekContext,
    });
    check('미해결 — 결과에 없음(999원을 몰래 이월하지 않음)', results.호주 === undefined);
    check('32차에서 멈추고 31차는 조회하지 않음', fetchWeekContext.calls.length === 1 && fetchWeekContext.calls[0] === '2026-32');
  }
  console.log('\n=== 5-b) 이번 차수 자체에 매입이 있으면 정확한 원천이 없어도 절대 이월 시도 안 함 ===');
  {
    const fetchWeekContext = countingFetch(buildWeekWorld({}));
    const results = await resolveCarriedRatesForCategories({
      orderYear: '2026', major: '33',
      categories: [{ key: '호주', currency: 'AUD' }],
      currentExactByCategory: { 호주: null },
      currentPurchaseQtyByCategory: { 호주: 120 }, // 이번 차수 매입 있음
      fetchWeekContext,
    });
    check('이번 차수 매입이 있으면 이월 대상에서 제외', results.호주 === undefined);
    check('과거 차수를 전혀 조회하지 않음(NEVER CARRY)', fetchWeekContext.calls.length === 0);
  }

  console.log('\n=== 6) 01차 → 전년도 52차로 이월(연도 경계) ===');
  {
    const world = {
      2025: {
        '52': { invoiceRates: { 호주: 1010 }, savedRates: { byCategory: {}, byCurrency: {} }, kcsRates: { byCategory: {} }, purchaseQty: { 호주: 200 } },
      },
    };
    const fetchWeekContext = buildWeekWorld(world);
    const results = await resolveCarriedRatesForCategories({
      orderYear: '2026', major: '01',
      categories: [{ key: '호주', currency: 'AUD' }],
      currentExactByCategory: { 호주: null },
      currentPurchaseQtyByCategory: { 호주: 0 },
      fetchWeekContext,
    });
    const c = results.호주;
    check('전년도(2025) 52차로 이월', c && c.sourceYear === '2025' && c.sourceMajor === '52' && c.rate === 1010, JSON.stringify(c));
  }

  console.log('\n=== 7) 2025/2026 연도 격리 — 같은 대차수라도 다른 연도를 섞지 않음 ===');
  {
    // 2026-23차 historical(원본 엑셀)에는 값이 있지만, 대상 연도가 2025면 절대 적용되지 않아야 한다.
    const exact2025 = resolveExactRateForWeek({
      orderYear: '2025', major: '23', category: '콜롬비아 카네이션', currency: 'USD',
      invoiceRates: {}, savedRates: { byCategory: {}, byCurrency: {} }, kcsRates: { byCategory: {} },
    });
    check('2025년 23차는 2026년 historical 값을 빌려오지 않음(원천 없음)', exact2025 === null);
    const exact2026 = resolveExactRateForWeek({
      orderYear: '2026', major: '23', category: '콜롬비아 카네이션', currency: 'USD',
      invoiceRates: {}, savedRates: { byCategory: {}, byCurrency: {} }, kcsRates: { byCategory: {} },
    });
    check('2026년 23차는 historical 값을 그대로 채택', exact2026 && exact2026.rate === 1507.15 && exact2026.source === RATE_SOURCE.EXCEL_HISTORICAL, JSON.stringify(exact2026));
    // 이월 도중에도 같은 대차수 번호로 연도를 건너뛰지 않고 순차적으로만 내려간다.
    let y = '2026', m = '05';
    for (let i = 0; i < 4; i += 1) { const p = priorMajorWeek(y, m); y = p.orderYear; m = p.major; }
    check('중간 대차수 4번 이동은 연도를 넘지 않음(2026 유지)', y === '2026' && m === '01', `${y}-${m}`);
  }

  console.log('\n=== 8) AUD 재고 카탈로그 — 이월값도 정상적인 숫자로 재고 평가 곱셈에 쓸 수 있다 ===');
  {
    const world = {
      2026: {
        '32': { invoiceRates: { 호주: 1100.25 }, savedRates: { byCategory: {}, byCurrency: {} }, kcsRates: { byCategory: {} }, purchaseQty: { 호주: 500 } },
      },
    };
    const results = await resolveCarriedRatesForCategories({
      orderYear: '2026', major: '33',
      categories: [{ key: '호주', currency: 'AUD' }],
      currentExactByCategory: { 호주: null },
      currentPurchaseQtyByCategory: { 호주: 0 },
      fetchWeekContext: buildWeekWorld(world),
    });
    const carry = results.호주;
    const foreignInventoryValue = 42.5; // AUD 표시 재고금액(예시)
    const wonValue = foreignInventoryValue * carry.rate;
    check('이월 rate는 유한한 양수(NaN/문자열 아님)', Number.isFinite(carry.rate) && carry.rate > 0);
    check('AUD 재고금액 × 이월 rate가 정확히 계산됨', Math.abs(wonValue - 46760.625) < 1e-9, String(wonValue));
  }

  console.log('\n=== 9) 한국어 provenance 문구 형식 ===');
  {
    check('formatCarryNote가 정확한 문구를 생성(선행 0 없이 N차)', formatCarryNote('2026', '05') === '이번 차수 입고가 없어 2026년 5차 과세환율을 이어 사용');
    check('formatCarryNote가 두 자리 차수도 동일 규칙(N차)', formatCarryNote('2026', '32') === '이번 차수 입고가 없어 2026년 32차 과세환율을 이어 사용');
  }

  console.log('\n=== 10) GET 전용 — DB write/DDL 경로를 전혀 참조하지 않는다 ===');
  {
    const fs = await import('fs');
    const src = fs.readFileSync(new URL('../lib/profitReportTaxableRateCarry.js', import.meta.url), 'utf8');
    const forbidden = ['INSERT ', 'UPDATE ', 'DELETE ', 'MERGE ', 'CREATE TABLE', 'saveTaxableRate(', 'ensureTaxableRateTables(', "from './db.js'", 'withTransaction'];
    const hit = forbidden.find((token) => src.includes(token));
    check('write/DDL 관련 토큰이 소스에 전혀 없음', !hit, hit || '');
    check('DB 모듈(db.js)을 import하지 않음', !src.includes("./db"));
    check('저장 없이 조회 함수(resolveTaxableRate/getHistoricalTaxableRate)만 사용', src.includes('resolveTaxableRate') && src.includes('getHistoricalTaxableRate'));
  }

  console.log('\n=== 최대 스텝(무한루프 방지) ===');
  {
    check('MAX_CARRY_STEPS는 53(1년+버퍼)', MAX_CARRY_STEPS === 53);
    // 53스텝을 넘어서도 원천이 없으면 조용히 미해결로 끝나야 한다(예외/무한루프 없음).
    const fetchWeekContext = buildWeekWorld({});
    const results = await resolveCarriedRatesForCategories({
      orderYear: '2026', major: '10',
      categories: [{ key: '호주', currency: 'AUD' }],
      currentExactByCategory: { 호주: null },
      currentPurchaseQtyByCategory: { 호주: 0 },
      fetchWeekContext,
      maxSteps: 5,
    });
    check('맞춤 maxSteps 내에서 못 찾으면 미해결로 종료(예외 없음)', results.호주 === undefined);
  }

  console.log('\n=== CARRIED_RATE_SOURCE 태그 ===');
  check('이월 소스 태그가 다른 RATE_SOURCE 값과 겹치지 않음', CARRIED_RATE_SOURCE === 'carried_taxable_rate' && !Object.values(RATE_SOURCE).includes(CARRIED_RATE_SOURCE));

  console.log(`\n${failed === 0 ? '✅ 전부 통과' : `❌ ${failed}건 실패`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

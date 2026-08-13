// 관세청(KCS) 과세환율 자동 조회(2026년 28차 이후 R 4순위) — 순수 로직 회귀 테스트.
//
// 검증 범위:
//   - lib/taxableExchangeRate.js resolveTaxableRate()의 새 kcsRate 우선순위 단계(4순위) —
//     스냅샷/저장값/2026 22~27차 historical이 항상 kcsRate보다 우선해야 22~27차가 보존된다.
//   - lib/taxableExchangeRate.js isKcsRateEligibleWeek() — 2026년 28차 이후만 활성화되는 단일 게이트.
//   - lib/kcsTaxableRate.js getKcsTaxableRate() — 응답 파싱(weekFxrtIm)·타임아웃·HTTP 오류·
//     프로세스 메모리 TTL 캐시. global.fetch를 mock해 실네트워크를 전혀 사용하지 않는다.
//   - lib/taxableExchangeRate.js kcsRatesByCategory() — 2026 22~27차/28차 미만 대상 밖 주차는 DB
//     조회도 네트워크 호출도 하지 않고 즉시 빈 결과를 반환하는지(단일 게이트가 실제로 지켜지는지).
//   - lib/kcsRateDateWeights.js mapCategoryDateRowsToWeights()/weightedRateFromDatePoints() —
//     신고일자별 wd.TPrice 가중치 그룹핑과 환율 자체의 TPrice 가중평균(순수 함수).
//
// 실행: node __tests__/taxableExchangeRateKcs.test.js
let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const { resolveTaxableRate, RATE_SOURCE, fetchKcsTaxableRate, isKcsRateEligibleWeek, kcsRatesByCategory } =
    await import('../lib/taxableExchangeRate.js');

  console.log('=== resolveTaxableRate — kcsRate는 4순위(스냅샷/저장값/historical 모두 없을 때만) ===');
  check('아무 원천도 없으면 missing (kcsRate도 없음)', resolveTaxableRate({}).source === RATE_SOURCE.MISSING);
  check('kcsRate만 있으면 KCS_API로 채택',
    resolveTaxableRate({ kcsRate: 1500 }).source === RATE_SOURCE.KCS_API
      && resolveTaxableRate({ kcsRate: 1500 }).rate === 1500);
  check('kcsRate<=0/null이면 여전히 missing',
    resolveTaxableRate({ kcsRate: 0 }).source === RATE_SOURCE.MISSING
      && resolveTaxableRate({ kcsRate: null }).source === RATE_SOURCE.MISSING);
  check('당주 FreightCost 스냅샷이 kcsRate보다 우선',
    resolveTaxableRate({ kcsRate: 1500, snapshotRate: 1200 }).rate === 1200
      && resolveTaxableRate({ kcsRate: 1500, snapshotRate: 1200 }).source === RATE_SOURCE.FREIGHT_COST_SNAPSHOT);
  check('저장된 카테고리 지정 행이 kcsRate보다 우선',
    resolveTaxableRate({ kcsRate: 1500, savedByCategory: { rate: 1300, source: RATE_SOURCE.MANUAL_INPUT } }).rate === 1300);
  check('2026 22~27차 historical(excel)이 kcsRate보다 우선 — 22~27차 보존의 핵심',
    resolveTaxableRate({ kcsRate: 1500, historicalRate: 1538.3 }).rate === 1538.3
      && resolveTaxableRate({ kcsRate: 1500, historicalRate: 1538.3 }).source === RATE_SOURCE.EXCEL_HISTORICAL);
  check('저장된 통화 기본 행이 kcsRate보다 우선',
    resolveTaxableRate({ kcsRate: 1500, savedByCurrency: { rate: 1400, source: RATE_SOURCE.SAVED_OFFICIAL_WEEK } }).rate === 1400);
  check('kcsDetail이 detail로 그대로 전달됨',
    resolveTaxableRate({ kcsRate: 900, kcsDetail: { currency: 'USD' } }).detail?.currency === 'USD');
  check('rateSuggestions(전차수·통화마스터)은 kcsRate와 무관하게 계속 참고용으로만 내려감',
    resolveTaxableRate({ kcsRate: 1500, previousWeekRate: 1000, previousWeekLabel: '27차' }).source === RATE_SOURCE.KCS_API
      && resolveTaxableRate({ kcsRate: 1500, previousWeekRate: 1000, previousWeekLabel: '27차' }).suggestions.length === 1
      && resolveTaxableRate({ kcsRate: 1500, previousWeekRate: 1000, previousWeekLabel: '27차' }).suggestions[0].kind === 'previous_week');

  console.log('\n=== isKcsRateEligibleWeek — 2026년 28차 이후만 (단일 게이트) ===');
  check('2026-28 대상', isKcsRateEligibleWeek('2026', '28') === true);
  check('2026-29 대상(major가 number)', isKcsRateEligibleWeek('2026', 29) === true);
  check('2026-27 대상 아님 — historical snapshot 보존', isKcsRateEligibleWeek('2026', '27') === false);
  check('2026-22 대상 아님 — historical snapshot 보존', isKcsRateEligibleWeek('2026', '22') === false);
  check('2025-30 대상 아님(연도 불일치)', isKcsRateEligibleWeek('2025', '30') === false);
  check('2027-30 대상(도입 경계 2026-28 이후)', isKcsRateEligibleWeek('2027', '30') === true);

  console.log('\n=== kcsRatesByCategory — 22~27차/28차 미만은 DB·네트워크 호출 자체를 하지 않음 ===');
  {
    const outOfRangeWeeks = [['2026', '22'], ['2026', '27'], ['2025', '30']];
    let allSkipped = true;
    for (const [yr, mj] of outOfRangeWeeks) {
      // 이 범위에서는 declarationDateByCategory()가 호출되지 않아야 한다 — DB 접속 정보가 없는
      // 이 테스트 환경에서 실제로 query()를 호출했다면 여기서 예외가 던져지거나 타임아웃난다.
      const r = await kcsRatesByCategory(mj, yr);
      if (!r || typeof r.byCategory !== 'object' || Object.keys(r.byCategory).length !== 0) allSkipped = false;
    }
    check('대상 밖 주차는 항상 빈 byCategory를 즉시 반환(DB 조회 스킵)', allSkipped);
  }

  console.log('\n=== lib/kcsRateDateWeights.js — 신고일자별 wd.TPrice 가중치 그룹핑/가중평균(순수 함수) ===');
  {
    const { mapCategoryDateRowsToWeights, weightedRateFromDatePoints } = await import('../lib/kcsRateDateWeights.js');
    const mapped = mapCategoryDateRowsToWeights([
      { Category: '태국', ResolvedDate: '2026-07-20', Weight: 100 },
      { Category: '태국', ResolvedDate: '2026-07-20', Weight: 50 }, // 같은 날짜 두 행은 합치지 않고 그대로 넘긴다(가중평균 단계에서 합산됨)
      { Category: '기타(미분류)', ResolvedDate: '2026-07-20', Weight: 100 }, // 미분류는 제외
      { Category: '태국', ResolvedDate: null, Weight: 100 }, // 날짜 없으면 자동 적용 차단용 진단행으로 유지
      { Category: '태국', ResolvedDate: '2026-07-21', Weight: 0 }, // weight<=0 제외
    ]);
    check('미분류/weight<=0은 제외하고 날짜없음은 진단행으로 유지', mapped.length === 3 && mapped.some(m => m.date === null && m.missingDeclarationDate), JSON.stringify(mapped));
    check('통화는 currencyCodeForCategory로 채워짐(태국=USD)', mapped.every(m => m.currency === 'USD'), JSON.stringify(mapped));

    const w1 = weightedRateFromDatePoints(
      [{ date: '2026-07-20', weight: 1 }, { date: '2026-07-27', weight: 3 }],
      { '2026-07-20': 1000, '2026-07-27': 2000 },
    );
    check('환율 자체를 TPrice 가중평균(1000×1+2000×3)/4=1750', Math.abs(w1 - 1750) < 1e-9);
    const w2 = weightedRateFromDatePoints(
      [{ date: '2026-07-20', weight: 100 }, { date: '2026-07-27', weight: 50 }],
      new Map([['2026-07-20', 1500]]), // 순수 함수는 누락 날짜를 제외하지만 상위 오케스트레이터가 전체 카테고리를 차단
    );
    check('순수 가중평균 함수는 제공된 환율만 계산(부분 실패 차단은 상위 함수 책임)', w2 === 1500);
    check('빈 배열/전부 무효 → null',
      weightedRateFromDatePoints([], {}) === null
        && weightedRateFromDatePoints([{ date: '2026-07-20', weight: 0 }], { '2026-07-20': 1000 }) === null);
  }

  console.log('\n=== lib/kcsTaxableRate.js — 응답 파싱/타임아웃/HTTP 오류/TTL 캐시 (fetch mock, 실네트워크 없음) ===');
  const kcs = await import('../lib/kcsTaxableRate.js');
  const originalFetch = global.fetch;
  const savedEnv = {
    KCS_TAXABLE_RATE_ENABLED: process.env.KCS_TAXABLE_RATE_ENABLED,
    KCS_TAXABLE_RATE_TTL_MS: process.env.KCS_TAXABLE_RATE_TTL_MS,
  };
  try {
    delete process.env.KCS_TAXABLE_RATE_ENABLED;
    let fetchCalls = 0;
    let lastUrl = '';
    global.fetch = async (url) => {
      fetchCalls += 1;
      lastUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          tCnt: 1,
          list: [{ currCd: 'USD', weekFxrtIm: '1,362.50', aplyBgnDt: '20260810', aplyEndDt: '20260816' }],
        }),
      };
    };
    kcs.clearKcsTaxableRateCache();
    const ok = await kcs.getKcsTaxableRate({ currency: 'usd', declarationDate: '2026-08-10' });
    check('기본값(미설정)은 활성 — 시크릿 없이도 조회 시도', ok.available === true && fetchCalls === 1, JSON.stringify(ok));
    check('weekFxrtIm 파싱(천단위 쉼표 제거)', ok.available === true && ok.rate === 1362.5, JSON.stringify(ok));
    check('요청 URL에 aplyBgnDt/currCd 파라미터 포함',
      lastUrl.includes('aplyBgnDt=20260810') && lastUrl.includes('currCd=USD'), lastUrl);
    check('고시 적용기간(sourceRangeStart/End)을 응답에서 추출',
      ok.sourceRangeStart === '2026-08-10' && ok.sourceRangeEnd === '2026-08-16');

    process.env.KCS_TAXABLE_RATE_ENABLED = 'false';
    // 캐시를 비우지 않는다 — disabled 경로는 캐시 조회보다 먼저 반환되므로 캐시에 영향이 없어야
    // 하고, 아래 "TTL 내 재조회는 캐시 사용" 검증이 방금 캐시된 값을 그대로 써야 한다.
    const explicitlyDisabled = await kcs.getKcsTaxableRate({ currency: 'USD', declarationDate: '2026-08-10' });
    check('명시적 false는 disabled — 네트워크 호출 없이 즉시 반환',
      explicitlyDisabled.available === false && explicitlyDisabled.reason === 'disabled' && fetchCalls === 1);

    process.env.KCS_TAXABLE_RATE_ENABLED = 'true';
    const cached = await kcs.getKcsTaxableRate({ currency: 'usd', declarationDate: '2026-08-10' });
    check('TTL 내 재조회는 캐시 사용 — 네트워크 재호출 없음', fetchCalls === 1 && cached.rate === 1362.5);

    process.env.KCS_TAXABLE_RATE_TTL_MS = '1';
    kcs.clearKcsTaxableRateCache();
    await kcs.getKcsTaxableRate({ currency: 'USD', declarationDate: '2026-08-11' });
    await new Promise(r => setTimeout(r, 5));
    await kcs.getKcsTaxableRate({ currency: 'USD', declarationDate: '2026-08-11' });
    check('TTL 만료 후에는 다시 네트워크 호출', fetchCalls === 3);
    delete process.env.KCS_TAXABLE_RATE_TTL_MS;

    global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ tCnt: 0, list: [] }) });
    kcs.clearKcsTaxableRateCache();
    const notFound = await kcs.getKcsTaxableRate({ currency: 'EUR', declarationDate: '2026-08-03' });
    check('weekFxrtIm 없으면 rate_not_found(추측/0-fallback 금지)', notFound.available === false && notFound.reason === 'rate_not_found');

    global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
      list: [{ currCd: 'USD', weekFxrtIm: '1360', aplyBgnDt: '20260803', aplyEndDt: '20260809' }],
    }) });
    kcs.clearKcsTaxableRateCache();
    const currencyMismatch = await kcs.getKcsTaxableRate({ currency: 'EUR', declarationDate: '2026-08-03' });
    check('응답 통화 불일치는 자동 채택하지 않음', currencyMismatch.available === false && currencyMismatch.reason === 'rate_not_found');

    global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
      list: [
        { currCd: 'EUR', weekFxrtIm: '1550', aplyBgnDt: '20260727', aplyEndDt: '20260802' },
        { currCd: 'EUR', weekFxrtIm: '1560', aplyBgnDt: '20260810', aplyEndDt: '20260816' },
      ],
    }) });
    kcs.clearKcsTaxableRateCache();
    const dateMismatch = await kcs.getKcsTaxableRate({ currency: 'EUR', declarationDate: '2026-08-05' });
    check('요청일이 적용기간 밖이면 자동 채택하지 않음', dateMismatch.available === false && dateMismatch.reason === 'rate_not_found');

    global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
      list: [
        { currCd: 'EUR', weekFxrtIm: '1550', aplyBgnDt: '20260803', aplyEndDt: '20260809' },
        { currCd: 'EUR', weekFxrtIm: '1560', aplyBgnDt: '20260803', aplyEndDt: '20260809' },
      ],
    }) });
    kcs.clearKcsTaxableRateCache();
    const ambiguous = await kcs.getKcsTaxableRate({ currency: 'EUR', declarationDate: '2026-08-05' });
    check('같은 통화·기간에 서로 다른 환율이 둘이면 자동 선택하지 않음', ambiguous.available === false && ambiguous.reason === 'rate_ambiguous');

    global.fetch = async () => ({ ok: false, status: 500, text: async () => '' });
    kcs.clearKcsTaxableRateCache();
    const httpErr = await kcs.getKcsTaxableRate({ currency: 'EUR', declarationDate: '2026-08-03' });
    check('HTTP 오류는 http_error로 구분', httpErr.available === false && httpErr.reason === 'http_error');

    global.fetch = async () => ({ ok: false, status: 401, text: async () => '' });
    kcs.clearKcsTaxableRateCache();
    const authErr = await kcs.getKcsTaxableRate({ currency: 'EUR', declarationDate: '2026-08-03' });
    check('401/403은 auth_failed로 구분', authErr.available === false && authErr.reason === 'auth_failed');

    global.fetch = async () => { const e = new Error('aborted'); e.name = 'TimeoutError'; throw e; };
    kcs.clearKcsTaxableRateCache();
    const timeout = await kcs.getKcsTaxableRate({ currency: 'EUR', declarationDate: '2026-08-03' });
    check('타임아웃은 timeout 사유로 구분', timeout.available === false && timeout.reason === 'timeout');
  } finally {
    global.fetch = originalFetch;
    if (savedEnv.KCS_TAXABLE_RATE_ENABLED === undefined) delete process.env.KCS_TAXABLE_RATE_ENABLED;
    else process.env.KCS_TAXABLE_RATE_ENABLED = savedEnv.KCS_TAXABLE_RATE_ENABLED;
    if (savedEnv.KCS_TAXABLE_RATE_TTL_MS === undefined) delete process.env.KCS_TAXABLE_RATE_TTL_MS;
    else process.env.KCS_TAXABLE_RATE_TTL_MS = savedEnv.KCS_TAXABLE_RATE_TTL_MS;
    kcs.clearKcsTaxableRateCache();
  }

  console.log('\n=== lib/taxableExchangeRate.js fetchKcsTaxableRate — 얇은 위임 래퍼 ===');
  const missingParams = await fetchKcsTaxableRate({ currency: '', declarationDate: '' });
  check('통화/신고일자 누락은 네트워크 호출 전에 즉시 거부', missingParams.available === false && missingParams.reason === 'missing_parameters');
  process.env.KCS_TAXABLE_RATE_ENABLED = 'false';
  const disabledWrapped = await fetchKcsTaxableRate({ currency: 'USD', declarationDate: '2026-08-10' });
  check('명시적 false 상태에서 래퍼도 disabled를 그대로 위임', disabledWrapped.available === false && disabledWrapped.reason === 'disabled');
  delete process.env.KCS_TAXABLE_RATE_ENABLED;

  console.log(`\n${failed === 0 ? '✅ 전부 통과' : `❌ ${failed}건 실패`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

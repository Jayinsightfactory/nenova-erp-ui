// lib/taxableExchangeRate.js#kcsRatesByCategory() 엔드투엔드 회귀 검증 — 2026 28차 이후 관세청(KCS)
// 카테고리별 과세환율이 "날짜를 먼저 평균"이 아니라 "환율 자체를 신고일자별 TPrice로 가중평균"하는지.
//
// __tests__/taxableExchangeRateKcs.test.js는 이미 isKcsRateEligibleWeek() 게이트와
// mapCategoryDateRowsToWeights/weightedRateFromDatePoints 순수 함수를 커버한다. 이 파일은 그 둘을
// 실제로 엮는 kcsRatesByCategory() 오케스트레이션(중복 (통화,날짜) fetch 제거 → 카테고리별
// weightedRateFromDatePoints 호출)을 검증한다 — 별도 커버리지.
//
// DB 목킹 방법에 대한 감사 메모(문제 지시사항의 "확인 후 재사용" 요구 이행):
//   grep -rn "mock" __tests__/*.test.js 결과 이 저장소의 기존 DB 목킹 패턴은 딱 하나 —
//   __tests__/syncShipmentDateEst.test.js 류의 "쿼리 함수(tQ)를 함수 인자로 넘겨받는 함수만
//   가짜 tQ로 대체" 방식이다(의존성 주입). 하지만 kcsRatesByCategory()가 호출하는
//   loadWarehouseDateWeights()는 tQ를 인자로 받지 않고 lib/db.js#query를 모듈 최상단에서 직접
//   import해 호출하므로, 이 저장소의 기존 패턴을 그대로 재사용할 수 없다(주입 지점이 없음).
//   그래서 이 파일은 Node 20.6+/24 표준 API인 node:module의 module.register() 리졸브 훅으로
//   lib/taxableExchangeRate.js가 import하는 './kcsRateDateWeights.js' 단 하나의 specifier만
//   (__tests__/fixtures/kcsRateDateWeightsMock.mjs로) 리다이렉트한다 — lib/pages 파일은 전혀
//   건드리지 않고, 그 목 모듈도 실제 순수 함수(weightedRateFromDatePoints/
//   mapCategoryDateRowsToWeights)는 그대로 재수출하며 loadWarehouseDateWeights만 대체한다.
//   (이 기법 자체는 작업 중 별도 격리 스크립트로 먼저 검증한 뒤 적용했다 — 정상 동작 확인됨.)
//
// 실행: node __tests__/kcsRatesByCategoryWeighting.test.js
import { register } from 'node:module';

register('./fixtures/kcsRateDateWeightsLoaderHook.mjs', import.meta.url);

let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const { kcsRatesByCategory } = await import('../lib/taxableExchangeRate.js');
  const kcs = await import('../lib/kcsTaxableRate.js');

  const originalFetch = global.fetch;
  const savedEnabled = process.env.KCS_TAXABLE_RATE_ENABLED;
  delete process.env.KCS_TAXABLE_RATE_ENABLED; // 기본 활성

  const setFetchByDate = (rateByDate) => {
    global.fetch = async (url) => {
      const u = new URL(url);
      const bgn = u.searchParams.get('aplyBgnDt'); // 'YYYYMMDD'
      const iso = `${bgn.slice(0, 4)}-${bgn.slice(4, 6)}-${bgn.slice(6, 8)}`;
      const entry = rateByDate[iso];
      if (entry === undefined || entry === 'FAIL') {
        return { ok: true, status: 200, text: async () => JSON.stringify({ tCnt: 0, list: [] }) };
      }
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({
          tCnt: 1,
          list: [{ currCd: u.searchParams.get('currCd'), weekFxrtIm: String(entry), aplyBgnDt: bgn, aplyEndDt: bgn }],
        }),
      };
    };
  };

  try {
    console.log('=== 카테고리 하나, 서로 다른 2개 날짜(가중치/환율 상이) — 가중평균(단순평균 아님) ===');
    {
      kcs.clearKcsTaxableRateCache();
      globalThis.__mockLoadWarehouseDateWeights = async () => [
        { category: '태국', currency: 'USD', date: '2026-08-03', weight: 900 },
        { category: '태국', currency: 'USD', date: '2026-08-10', weight: 100 },
      ];
      setFetchByDate({ '2026-08-03': 1300, '2026-08-10': 1500 });
      const { byCategory } = await kcsRatesByCategory('28', '2026');
      const entry = byCategory['태국'];
      check('태국 카테고리 결과 존재', Boolean(entry), JSON.stringify(byCategory));
      const expected = (1300 * 900 + 1500 * 100) / 1000; // = 1320
      check(`가중평균 ${expected}으로 산출(단순평균 1400 아님)`, entry && Math.abs(entry.rate - expected) < 1e-9, `actual=${entry?.rate}`);
      check('detail.distinctDateCount === 2', entry?.detail?.distinctDateCount === 2, JSON.stringify(entry?.detail));
      check('detail.weightedAvg === true', entry?.detail?.weightedAvg === true);
      check('detail.currency === USD', entry?.detail?.currency === 'USD');
      check('detail.source === kcs_api', entry?.detail?.source === 'kcs_api');
    }

    console.log('\n=== 날짜가 1개뿐인 카테고리 — weightedAvg === false ===');
    {
      kcs.clearKcsTaxableRateCache();
      globalThis.__mockLoadWarehouseDateWeights = async () => [
        { category: '네덜란드', currency: 'EUR', date: '2026-08-03', weight: 500 },
      ];
      setFetchByDate({ '2026-08-03': 1450 });
      const { byCategory } = await kcsRatesByCategory('28', '2026');
      const entry = byCategory['네덜란드'];
      check('네덜란드 카테고리 결과 존재 및 환율 그대로', entry?.rate === 1450, JSON.stringify(entry));
      check('distinctDateCount === 1', entry?.detail?.distinctDateCount === 1);
      check('weightedAvg === false(날짜 1개뿐)', entry?.detail?.weightedAvg === false);
    }

    console.log('\n=== 호주 일정 보완 provenance가 최종 KCS detail에 보존됨 ===');
    {
      kcs.clearKcsTaxableRateCache();
      globalThis.__mockLoadWarehouseDateWeights = async () => [
        {
          category: '호주', currency: 'AUD', date: '2026-07-06', weight: 500,
          dateSource: 'category_schedule', scheduleId: 'AUSTRALIA_AUD_MAJOR_ISO_WEEK_MONDAY_V1',
        },
      ];
      setFetchByDate({ '2026-07-06': 1068.96 });
      const { byCategory } = await kcsRatesByCategory('28', '2026');
      const used = byCategory['호주']?.detail?.dates?.[0];
      check('호주 일정 환율이 자동 계산됨', byCategory['호주']?.rate === 1068.96, JSON.stringify(byCategory));
      check('일정 보완 출처와 규칙 ID가 응답에 남음',
        used?.dateSource === 'category_schedule' && used?.scheduleId === 'AUSTRALIA_AUD_MAJOR_ISO_WEEK_MONDAY_V1',
        JSON.stringify(used));
    }

    console.log('\n=== 2개 날짜 중 1개 조회 실패 — 카테고리 전체를 입력 필요로 처리 ===');
    {
      kcs.clearKcsTaxableRateCache();
      globalThis.__mockLoadWarehouseDateWeights = async () => [
        { category: '호주', currency: 'AUD', date: '2026-08-03', weight: 300 },
        { category: '호주', currency: 'AUD', date: '2026-08-10', weight: 700 },
      ];
      setFetchByDate({ '2026-08-03': 950, '2026-08-10': 'FAIL' });
      const { byCategory, failuresByCategory } = await kcsRatesByCategory('28', '2026');
      check('호주 카테고리는 일부 날짜 환율로 임의 계산하지 않음', !Object.prototype.hasOwnProperty.call(byCategory, '호주'), JSON.stringify(byCategory));
      check('실패한 날짜가 진단정보에 남음', failuresByCategory?.['호주']?.[0]?.date === '2026-08-10', JSON.stringify(failuresByCategory));
    }

    console.log('\n=== 카테고리의 모든 날짜 조회 실패 — byCategory에서 완전히 빠짐(rate:null로 남지 않음) ===');
    {
      kcs.clearKcsTaxableRateCache();
      globalThis.__mockLoadWarehouseDateWeights = async () => [
        { category: '중국', currency: 'CNY', date: '2026-08-03', weight: 400 },
        { category: '중국', currency: 'CNY', date: '2026-08-10', weight: 600 },
      ];
      setFetchByDate({ '2026-08-03': 'FAIL', '2026-08-10': 'FAIL' });
      const { byCategory } = await kcsRatesByCategory('28', '2026');
      check('전부 실패한 카테고리는 byCategory 키 자체가 없음(rate:null로 남지 않음)',
        !Object.prototype.hasOwnProperty.call(byCategory, '중국'), JSON.stringify(byCategory));
    }

    console.log('\n=== 상품 매입 일부에 신고 기준일이 없음 — 카테고리 전체 자동환율 차단 ===');
    {
      kcs.clearKcsTaxableRateCache();
      globalThis.__mockLoadWarehouseDateWeights = async () => [
        { category: '태국', currency: 'USD', date: '2026-08-03', weight: 900 },
        { category: '태국', currency: 'USD', date: null, weight: 100, missingDeclarationDate: true },
      ];
      setFetchByDate({ '2026-08-03': 1300 });
      const { byCategory, failuresByCategory } = await kcsRatesByCategory('28', '2026');
      check('날짜가 있는 90%만으로 임의 평균하지 않음', !Object.prototype.hasOwnProperty.call(byCategory, '태국'));
      check('신고일 누락 원인이 진단정보에 남음', failuresByCategory?.['태국']?.some((x) => x.reason === 'missing_declaration_date'), JSON.stringify(failuresByCategory));
    }

    console.log('\n=== 같은 (통화,날짜) 조합은 카테고리가 여러 개여도 fetch를 정확히 1회만 호출(중복 제거) ===');
    {
      kcs.clearKcsTaxableRateCache();
      globalThis.__mockLoadWarehouseDateWeights = async () => [
        { category: '태국', currency: 'USD', date: '2026-08-03', weight: 100 },
        { category: '이스라엘', currency: 'USD', date: '2026-08-03', weight: 200 }, // 같은 (USD,08-03)
      ];
      let fetchCalls = 0;
      global.fetch = async (url) => {
        fetchCalls += 1;
        const u = new URL(url);
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({ tCnt: 1, list: [{ currCd: u.searchParams.get('currCd'), weekFxrtIm: '1000', aplyBgnDt: u.searchParams.get('aplyBgnDt'), aplyEndDt: u.searchParams.get('aplyBgnDt') }] }),
        };
      };
      await kcsRatesByCategory('28', '2026');
      check('동일 (통화,날짜) 조합은 정확히 1회만 fetch', fetchCalls === 1, `fetchCalls=${fetchCalls}`);
    }

    console.log('\n=== loadWarehouseDateWeights가 빈 배열이면 byCategory도 빈 객체(불필요한 fetch 없음) ===');
    {
      kcs.clearKcsTaxableRateCache();
      globalThis.__mockLoadWarehouseDateWeights = async () => [];
      let fetchCalls = 0;
      global.fetch = async () => { fetchCalls += 1; return { ok: true, status: 200, text: async () => '{}' }; };
      const { byCategory } = await kcsRatesByCategory('28', '2026');
      check('빈 포인트 → byCategory 빈 객체, fetch 호출 없음', Object.keys(byCategory).length === 0 && fetchCalls === 0);
    }
  } finally {
    global.fetch = originalFetch;
    if (savedEnabled === undefined) delete process.env.KCS_TAXABLE_RATE_ENABLED;
    else process.env.KCS_TAXABLE_RATE_ENABLED = savedEnabled;
    delete globalThis.__mockLoadWarehouseDateWeights;
    kcs.clearKcsTaxableRateCache();
  }

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

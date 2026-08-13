// lib/kcsRateDateWeights.js 순수 함수(mapCategoryDateRowsToWeights/weightedRateFromDatePoints) 회귀 검증.
//
// loadWarehouseDateWeights()(DB 의존)는 이 파일에서 다루지 않는다 — DB 접속 정보 없이 이 순수
// 함수 두 개만으로 신고일자별 TPrice 가중치 그룹핑 + 환율 자체의 TPrice 가중평균 로직을 검증한다.
// kcsRatesByCategory() 오케스트레이션(로더훅으로 loadWarehouseDateWeights를 목킹) 엔드투엔드 검증은
// __tests__/kcsRatesByCategoryWeighting.test.js 를 참조.
//
// 실행: node __tests__/kcsRateDateWeights.test.js
let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const { mapCategoryDateRowsToWeights, weightedRateFromDatePoints } = await import('../lib/kcsRateDateWeights.js');

  console.log('=== mapCategoryDateRowsToWeights — SQL 원시 행 → {category,currency,date,weight} ===');
  {
    const mapped = mapCategoryDateRowsToWeights([
      { Category: '네덜란드', ResolvedDate: '2026-07-20', Weight: 100 },
    ]);
    check('필드 매핑(category/currency/date/weight)',
      mapped.length === 1
        && mapped[0].category === '네덜란드'
        && mapped[0].currency === 'EUR'
        && mapped[0].date === '2026-07-20'
        && mapped[0].weight === 100,
      JSON.stringify(mapped));
  }
  {
    // '공제'와 '기타(미분류)'는 통화를 확정할 수 없는 대표 두 경로 —
    // 전자는 currencyCodeForCategory()가 명시적으로 null을 반환, 후자는 EXTRA_CATEGORY로 매핑 이전에 스킵된다.
    const mapped = mapCategoryDateRowsToWeights([
      { Category: '공제', ResolvedDate: '2026-07-20', Weight: 100 },
      { Category: '기타(미분류)', ResolvedDate: '2026-07-20', Weight: 100 },
      { Category: '', ResolvedDate: '2026-07-20', Weight: 100 },
      { Category: null, ResolvedDate: '2026-07-20', Weight: 100 },
    ]);
    check('통화 불확정 카테고리(공제/기타(미분류)) 및 빈/null 카테고리는 모두 제외', mapped.length === 0, JSON.stringify(mapped));
  }
  {
    const mapped = mapCategoryDateRowsToWeights([
      { Category: '태국', ResolvedDate: '2026-07-20', Weight: 0 },
      { Category: '태국', ResolvedDate: '2026-07-20', Weight: -5 },
      { Category: '태국', ResolvedDate: '2026-07-20', Weight: null },
    ]);
    check('weight<=0(0/음수/null→0) 행은 모두 제외', mapped.length === 0, JSON.stringify(mapped));
  }
  {
    const mapped = mapCategoryDateRowsToWeights([
      { Category: '태국', ResolvedDate: null, Weight: 100 },
      { Category: '태국', ResolvedDate: undefined, Weight: 100 },
      { Category: '태국', ResolvedDate: '', Weight: 100 },
    ]);
    check('날짜 없음(null/undefined/빈문자열) 행은 모두 제외', mapped.length === 0, JSON.stringify(mapped));
  }
  {
    // Date 객체는 UTC 게터로 변환되어야 로컬 타임존에 따라 하루 밀리지 않는다.
    const mapped = mapCategoryDateRowsToWeights([
      { Category: '태국', ResolvedDate: new Date('2026-07-20T00:00:00.000Z'), Weight: 100 },
    ]);
    check('Date 객체는 UTC 게터로 YYYY-MM-DD 변환', mapped[0]?.date === '2026-07-20', JSON.stringify(mapped));
  }
  {
    // 정렬: category.localeCompare('ko') || currency.localeCompare || date.localeCompare
    const mapped = mapCategoryDateRowsToWeights([
      { Category: '태국', ResolvedDate: '2026-07-27', Weight: 10 },
      { Category: '네덜란드', ResolvedDate: '2026-07-20', Weight: 10 },
      { Category: '태국', ResolvedDate: '2026-07-20', Weight: 10 },
      { Category: '호주', ResolvedDate: '2026-07-15', Weight: 10 },
    ]);
    const order = mapped.map((m) => `${m.category}/${m.date}`);
    check('카테고리(한글 로케일) → 통화 → 날짜 순 정렬',
      order[0] === '네덜란드/2026-07-20' && order[1] === '태국/2026-07-20' && order[2] === '태국/2026-07-27' && order[3] === '호주/2026-07-15',
      JSON.stringify(order));
  }
  {
    // 같은 (카테고리,날짜) 두 행은 합치지 않고 그대로 통과시킨다(가중평균 단계에서 합산됨).
    const mapped = mapCategoryDateRowsToWeights([
      { Category: '태국', ResolvedDate: '2026-07-20', Weight: 100 },
      { Category: '태국', ResolvedDate: '2026-07-20', Weight: 50 },
    ]);
    check('같은 카테고리/날짜 중복 행은 병합하지 않고 그대로 유지', mapped.length === 2, JSON.stringify(mapped));
  }
  {
    check('배열이 아닌 입력은 빈 결과', mapCategoryDateRowsToWeights(null).length === 0
      && mapCategoryDateRowsToWeights(undefined).length === 0
      && mapCategoryDateRowsToWeights({}).length === 0);
  }

  console.log('\n=== weightedRateFromDatePoints — 날짜별 TPrice 가중치로 환율 자체를 가중평균 ===');
  {
    // 2개 날짜, 1300원/1500원, 90%/10% 가중 → 가중평균 ~1320(단순 중간값 1400과는 다름).
    // 이 테스트는 "날짜를 먼저 평균해서 그 하루치 환율만 조회"하는 방식이 아니라, 각 날짜의 실제
    // 환율을 그대로 두고 환율값 자체를 TPrice로 가중평균한다는 2026-08-12 설계 결정을 고정한다
    // (lib/kcsRateDateWeights.js 파일 헤더 주석 및 lib/profitReportDeclarationDate.js 헤더 참조).
    const weighted = weightedRateFromDatePoints(
      [{ date: '2026-07-20', weight: 90 }, { date: '2026-07-27', weight: 10 }],
      { '2026-07-20': 1300, '2026-07-27': 1500 },
    );
    const naiveMidpoint = 1400;
    check('가중평균(~1320)이 산출됨', Math.abs(weighted - 1320) < 1e-9, `actual=${weighted}`);
    check('단순 날짜평균(중간값 1400)과는 다름 — 가중치가 실제로 적용됨', Math.abs(weighted - naiveMidpoint) > 50, `actual=${weighted}`);
  }
  {
    // 가중치가 다르지 않으면 결과가 단순평균과 같아질 수 있으므로, "가중치가 적용됨"을 증명하려면
    // 불균등 가중치에서 naive 평균과 달라지는 것으로 검증해야 한다(위 케이스가 그 증명).
    const w = weightedRateFromDatePoints(
      [{ date: '2026-07-20', weight: 1 }, { date: '2026-07-27', weight: 3 }],
      { '2026-07-20': 1000, '2026-07-27': 2000 },
    );
    check('가중평균(1000×1+2000×3)/4=1750', Math.abs(w - 1750) < 1e-9, `actual=${w}`);
  }
  {
    // rateByDate가 Map 형태
    const wMap = weightedRateFromDatePoints(
      [{ date: '2026-08-01', weight: 2 }, { date: '2026-08-08', weight: 2 }],
      new Map([['2026-08-01', 1300], ['2026-08-08', 1500]]),
    );
    check('rateByDate가 Map이어도 정상 동작(균등가중 평균 1400)', Math.abs(wMap - 1400) < 1e-9, `actual=${wMap}`);
  }
  {
    // rateByDate가 plain object 형태(위 1320 케이스도 object였음 — 별도로 동일 입력 Map 버전과 비교)
    const wObj = weightedRateFromDatePoints(
      [{ date: '2026-08-01', weight: 2 }, { date: '2026-08-08', weight: 2 }],
      { '2026-08-01': 1300, '2026-08-08': 1500 },
    );
    const wMap = weightedRateFromDatePoints(
      [{ date: '2026-08-01', weight: 2 }, { date: '2026-08-08', weight: 2 }],
      new Map([['2026-08-01', 1300], ['2026-08-08', 1500]]),
    );
    check('object와 Map 두 형태 모두 동일 결과', wObj === wMap && Math.abs(wObj - 1400) < 1e-9);
  }
  {
    // 날짜가 rateByDate에 없으면(조회 실패) 그 날짜는 0으로 취급하지 않고 완전히 제외된다.
    const w = weightedRateFromDatePoints(
      [{ date: '2026-08-01', weight: 100 }, { date: '2026-08-08', weight: 900 }],
      { '2026-08-01': 1300 }, // 08-08은 없음
    );
    check('조회 실패 날짜는 0이 아니라 가중평균에서 완전 제외(남은 날짜만으로 계산)', w === 1300, `actual=${w}`);
  }
  {
    check('빈 배열 → null', weightedRateFromDatePoints([], { '2026-08-01': 1300 }) === null);
    check('전부 무효(weight<=0) → null',
      weightedRateFromDatePoints([{ date: '2026-08-01', weight: 0 }, { date: '2026-08-08', weight: -1 }], { '2026-08-01': 1300, '2026-08-08': 1300 }) === null);
    check('전부 rateByDate에 없음 → null', weightedRateFromDatePoints([{ date: '2026-08-01', weight: 100 }], {}) === null);
    check('배열이 아닌 datePoints → null', weightedRateFromDatePoints(null, {}) === null && weightedRateFromDatePoints(undefined, {}) === null);
  }
  {
    // 단일 날짜/포인트 → 그 환율 그대로.
    const w = weightedRateFromDatePoints([{ date: '2026-08-01', weight: 12345 }], { '2026-08-01': 1421.7 });
    check('단일 날짜는 가중치 크기와 무관하게 그 날짜 환율 그대로', w === 1421.7, `actual=${w}`);
  }

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

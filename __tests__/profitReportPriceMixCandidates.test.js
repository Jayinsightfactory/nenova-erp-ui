// lib/profitReportPriceMixCandidates.js 회귀 검증 — 거래처×품목 단가하락/저가 거래처 구성비 확대 후보 탐지.
// 전부 순수 함수(DB 호출 없음) — DB 목킹 불필요.
//
// 실행: node __tests__/profitReportPriceMixCandidates.test.js
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

async function main() {
  const { median, weightedAverage, detectPriceDecreaseCandidates, detectLowPriceCustomerMixCandidates } =
    await import('../lib/profitReportPriceMixCandidates.js');

  console.log('=== median — 홀수/짝수 개수, null/NaN 제외, 빈 배열 ===');
  check('홀수 개수 [1,3,2] → 2', median([1, 3, 2]) === 2);
  check('짝수 개수 [1,2,3,4] → (2+3)/2=2.5', median([1, 2, 3, 4]) === 2.5);
  check('null/NaN 섞여도 유효값만으로 중앙값', median([10, null, 20, NaN, 30]) === 20, `actual=${median([10, null, 20, NaN, 30])}`);
  check('빈 배열 → null', median([]) === null);
  check('전부 무효 → null', median([null, NaN, undefined]) === null);
  check('단일값 → 그 값', median([42]) === 42);

  console.log('\n=== weightedAverage — {value,weight} 가중평균, weight<=0/무효 제외, 전체 weight 0 → null ===');
  {
    const w = weightedAverage([{ value: 100, weight: 1 }, { value: 200, weight: 3 }]);
    check('불균등 가중치 (100×1+200×3)/4=175', w === 175, `actual=${w}`);
  }
  check('weight<=0 항목 제외', weightedAverage([{ value: 100, weight: 0 }, { value: 200, weight: -1 }, { value: 300, weight: 2 }]) === 300);
  check('value가 숫자 아니면 제외', weightedAverage([{ value: null, weight: 5 }, { value: 100, weight: 1 }]) === 100);
  check('빈 배열/전체 weight 0 → null', weightedAverage([]) === null && weightedAverage([{ value: 100, weight: 0 }]) === null);

  console.log('\n=== detectPriceDecreaseCandidates — 3% 이상 하락 경계값, note 고정 문자열 ===');
  {
    const prior = [{ custKey: 1, prodKey: 10, custName: '거래처A', productName: 'ROSE / Test 50cm', vatInclusiveUnitPrice: 1000 }];
    // 정확히 3% 하락(970) — 스펙: >=3% 하락이면 트리거(<=0.97배)
    const exact3 = detectPriceDecreaseCandidates(
      [{ custKey: 1, prodKey: 10, custName: '거래처A', productName: 'ROSE / Test 50cm', vatInclusiveUnitPrice: 970 }], prior,
    );
    check('정확히 3% 하락(970) → 트리거됨(경계 포함)', exact3.length === 1, JSON.stringify(exact3));
    check('note는 고정 문자열', exact3[0]?.note === '특가·재고소진 여부 확인');
    check('사용자가 확인할 실제 품목명이 후보에 유지됨', exact3[0]?.productName === 'ROSE / Test 50cm');
    check('pctChange ≈ -0.03', Math.abs(exact3[0].pctChange - (-0.03)) < 1e-6, `actual=${exact3[0].pctChange}`);

    // 3% 미만 하락(971 = 2.9% 하락) — 트리거 안 됨
    const justUnder3 = detectPriceDecreaseCandidates(
      [{ custKey: 1, prodKey: 10, custName: '거래처A', vatInclusiveUnitPrice: 971 }], prior,
    );
    check('3% 미만 하락(971, 2.9%) → 트리거 안 됨', justUnder3.length === 0, JSON.stringify(justUnder3));
  }
  {
    // 직전 행 자체가 없으면(신규 조합) 스킵 — false positive 아님.
    const out = detectPriceDecreaseCandidates(
      [{ custKey: 9, prodKey: 99, custName: '신규거래처', vatInclusiveUnitPrice: 500 }],
      [{ custKey: 1, prodKey: 10, custName: '거래처A', vatInclusiveUnitPrice: 1000 }],
    );
    check('직전 스냅샷에 없던 조합은 후보 아님(스킵)', out.length === 0);
  }
  {
    // priorPrice=0이면 division-by-zero 회피 — 스킵.
    const out = detectPriceDecreaseCandidates(
      [{ custKey: 1, prodKey: 10, vatInclusiveUnitPrice: 100 }],
      [{ custKey: 1, prodKey: 10, vatInclusiveUnitPrice: 0 }],
    );
    check('priorPrice=0은 division-by-zero 없이 스킵', out.length === 0);
  }
  {
    // 상승/보합은 후보 아님.
    const out = detectPriceDecreaseCandidates(
      [{ custKey: 1, prodKey: 10, vatInclusiveUnitPrice: 1100 }],
      [{ custKey: 1, prodKey: 10, vatInclusiveUnitPrice: 1000 }],
    );
    check('가격 상승은 후보 아님', out.length === 0);
  }
  {
    // note가 정확히 고정 문자열 하나뿐이고 다른 텍스트가 덧붙지 않는지(커스터머명 등과 결합 금지).
    const out = detectPriceDecreaseCandidates(
      [{ custKey: 1, prodKey: 10, custName: '특정거래처', vatInclusiveUnitPrice: 900 }],
      [{ custKey: 1, prodKey: 10, custName: '특정거래처', vatInclusiveUnitPrice: 1000 }],
    );
    check('note는 커스터머명 등과 결합되지 않은 순수 고정 문자열', out[0]?.note === '특가·재고소진 여부 확인' && out[0].note.length === '특가·재고소진 여부 확인'.length);
  }

  console.log('\n=== detectPriceDecreaseCandidates — 소스 코드에 하드코딩된 이름 리터럴 없음(고정 note 문자열 제외) ===');
  {
    const srcPath = path.join(__dirname, '..', 'lib', 'profitReportPriceMixCandidates.js');
    const src = fs.readFileSync(srcPath, 'utf8');
    // 소스 전체에서 문자열 리터럴을 뽑아, 고정 note('특가·재고소진 여부 확인')와 순수 필드명/기술
    // 문자열('price_decrease' 등)을 제외하고 사람 이름/거래처명처럼 보이는 한글 고유명사 리터럴이
    // 하드코딩되어 있지 않은지 확인한다(주석 속 예시 문구는 코드 리터럴이 아니므로 별도로 제외).
    const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const stringLiterals = [...codeOnly.matchAll(/'([^'\\]|\\.)*'/g)].map((m) => m[0]);
    const ALLOWLIST = new Set([
      "'특가·재고소진 여부 확인'", "'price_decrease'", "'low_price_customer_mix'",
      "'lib/profitReportPriceMixCandidates.js'",
    ]);
    const suspicious = stringLiterals.filter((lit) => !ALLOWLIST.has(lit) && !/^'[a-zA-Z0-9_]*'$/.test(lit) && lit !== "''");
    check('코드 내 문자열 리터럴은 허용목록(고정 note/kind태그) 또는 순수 영숫자 식별자뿐', suspicious.length === 0, JSON.stringify(suspicious));
  }

  console.log('\n=== detectLowPriceCustomerMixCandidates — 가중평균 AND 중앙값 모두 5% 이상 낮아야 트리거, 비중 2%p 이상 상승 ===');
  {
    // 품목 하나에 거래처 3명. 피어 가중평균/중앙값을 계산해 threshold=min(avg,median)*0.95 산출.
    const current = [
      { custKey: 1, prodKey: 100, custName: 'A', vatInclusiveUnitPrice: 1000, qty: 700, qtyShare: 0.70 },
      { custKey: 2, prodKey: 100, custName: 'B', vatInclusiveUnitPrice: 1050, qty: 200, qtyShare: 0.20 },
      { custKey: 3, prodKey: 100, custName: 'C', vatInclusiveUnitPrice: 900, qty: 100, qtyShare: 0.10 }, // 저가 후보
    ];
    // peerWeightedAvg = (1000*700+1050*200+900*100)/1000 = (700000+210000+90000)/1000 = 1000
    // peerMedian = median([1000,1050,900]) = 1000
    // threshold = min(1000,1000)*0.95 = 950 → C(900)는 950 미만 → 가격조건 통과
    const priorShare0 = [
      { custKey: 1, prodKey: 100, qtyShare: 0.70 },
      { custKey: 2, prodKey: 100, qtyShare: 0.20 },
      { custKey: 3, prodKey: 100, qtyShare: 0.08 }, // 직전 8% → 이번 10% = +2.0pp 정확히 경계
    ];
    const out = detectLowPriceCustomerMixCandidates(current, priorShare0);
    check('가격·비중 조건 모두 충족한 C만 후보로 검출', out.length === 1 && out[0].custKey === 3, JSON.stringify(out));
    check('note는 고정 문자열', out[0]?.note === '특가·재고소진 여부 확인');
    check('shareDeltaPp = 2(경계값 포함, >=2 트리거)', out[0]?.shareDeltaPp === 2, `actual=${out[0]?.shareDeltaPp}`);
  }
  {
    // 가중평균 기준으로는 5% 미만이지만 중앙값 기준으로는 5% 이상 낮은 케이스 — 스펙은 "둘 다"이므로 미검출.
    // peer prices: [1000(w=900), 1000(w=90), 950(w=10)] → weightedAvg=(1000*900+1000*90+950*10)/1000=999.5
    // median([1000,1000,950])=1000. threshold=min(999.5,1000)*0.95=949.525
    // 거래처C 단가=955 → weightedAvg 대비는 (999.5-955)/999.5=4.45%(5% 미만) → threshold(949.525)보다는 위 → 가격조건 자체가 미충족
    const current = [
      { custKey: 1, prodKey: 200, custName: 'A', vatInclusiveUnitPrice: 1000, qty: 900, qtyShare: 0.90 },
      { custKey: 2, prodKey: 200, custName: 'B', vatInclusiveUnitPrice: 1000, qty: 90, qtyShare: 0.09 },
      { custKey: 3, prodKey: 200, custName: 'C', vatInclusiveUnitPrice: 955, qty: 10, qtyShare: 0.01 },
    ];
    const priorShare0 = [
      { custKey: 1, prodKey: 200, qtyShare: 0.90 },
      { custKey: 2, prodKey: 200, qtyShare: 0.09 },
      { custKey: 3, prodKey: 200, qtyShare: 0 },
    ];
    const out = detectLowPriceCustomerMixCandidates(current, priorShare0);
    check('가중평균 기준 5% 미만 하락은 미검출(AND 조건, threshold=min(avg,median)*0.95 미달)', out.length === 0, JSON.stringify(out));
  }
  {
    // 저가 조건은 충족하지만 비중 상승이 2%p 미만이면 미검출.
    const current = [
      { custKey: 1, prodKey: 300, custName: 'A', vatInclusiveUnitPrice: 1000, qty: 800, qtyShare: 0.80 },
      { custKey: 2, prodKey: 300, custName: 'B', vatInclusiveUnitPrice: 1000, qty: 150, qtyShare: 0.15 },
      { custKey: 3, prodKey: 300, custName: 'C', vatInclusiveUnitPrice: 800, qty: 50, qtyShare: 0.05 }, // 20% 낮음(가격조건 충족)
    ];
    const priorShare0 = [
      { custKey: 1, prodKey: 300, qtyShare: 0.80 },
      { custKey: 2, prodKey: 300, qtyShare: 0.15 },
      { custKey: 3, prodKey: 300, qtyShare: 0.04 }, // 직전 4% → 이번 5% = +1.0pp (< 2pp)
    ];
    const out = detectLowPriceCustomerMixCandidates(current, priorShare0);
    check('저가 조건 충족해도 비중상승 <2pp면 미검출', out.length === 0, JSON.stringify(out));
  }
  {
    // 신규 거래처(직전 비중 0)도 현재 비중 델타가 2pp 이상이면 검출됨.
    const current = [
      { custKey: 1, prodKey: 400, custName: 'A', vatInclusiveUnitPrice: 1000, qty: 700, qtyShare: 0.70 },
      { custKey: 2, prodKey: 400, custName: 'B', vatInclusiveUnitPrice: 1000, qty: 250, qtyShare: 0.25 },
      { custKey: 3, prodKey: 400, custName: '신규C', vatInclusiveUnitPrice: 850, qty: 50, qtyShare: 0.05 }, // 신규, 저가
    ];
    // 직전 스냅샷에 신규C 자체가 없음(0으로 간주)
    const priorShare0 = [
      { custKey: 1, prodKey: 400, qtyShare: 0.70 },
      { custKey: 2, prodKey: 400, qtyShare: 0.30 },
    ];
    const out = detectLowPriceCustomerMixCandidates(current, priorShare0);
    check('신규 거래처(직전 비중 0)도 델타 조건 충족 시 검출', out.length === 1 && out[0].custKey === 3, JSON.stringify(out));
    check('shareDeltaPp = 5(0 → 5%)', out[0]?.shareDeltaPp === 5, `actual=${out[0]?.shareDeltaPp}`);
  }

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

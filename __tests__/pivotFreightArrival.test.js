// Pivot 도착원가 집계 순수함수 검증
// 실행: node __tests__/pivotFreightArrival.test.js
//
// aggregateArrivalCosts(records) 의 weighted-average / edge case 를 커버.
// DB 없이 node 단독 실행 가능 (lib/pivotFreightArrival.js 순수함수만 import).

const assert = (label, cond) => {
  if (!cond) {
    console.error(`  FAIL ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  PASS ${label}`);
  }
};
const near = (a, b, tol = 0.01) => Math.abs(Number(a) - Number(b)) < tol;

async function main() {
  // lib/pivotArrivalCalc.js は DB/번들러 의존 없음 — node 단독 실행 가능
  const { aggregateArrivalCosts } = await import('../lib/pivotArrivalCalc.js');

  // ── 1. 단일 행 ─────────────────────────────────────────────────────────────
  console.log('\n=== 단일 행: 그대로 반환 ===');
  {
    const m = aggregateArrivalCosts([
      { prodKey: 10, inQty: 5, displayArrivalKRW: 30000, arrivalPerStem: 3000, arrivalPerBunch: 30000, displayUnit: '단', source: 'snapshot' },
    ]);
    assert('prodKey 10 존재', m[10] != null);
    assert('arrivalCost = 30000', near(m[10].arrivalCost, 30000));
    assert('arrivalPerStem = 3000', near(m[10].arrivalPerStem, 3000));
    assert('arrivalPerBunch = 30000', near(m[10].arrivalPerBunch, 30000));
    assert('displayUnit = 단', m[10].displayUnit === '단');
    assert('source = snapshot', m[10].source === 'snapshot');
  }

  // ── 2. 다중 AWB 가중평균 ───────────────────────────────────────────────────
  console.log('\n=== 다중 AWB — 입고수량 가중평균 ===');
  {
    // (10 × 20000 + 30 × 25000) / 40 = (200000 + 750000) / 40 = 23750
    const m = aggregateArrivalCosts([
      { prodKey: 1, inQty: 10, displayArrivalKRW: 20000, arrivalPerStem: 2000, arrivalPerBunch: null, displayUnit: '단', source: 'live' },
      { prodKey: 1, inQty: 30, displayArrivalKRW: 25000, arrivalPerStem: 2500, arrivalPerBunch: null, displayUnit: '단', source: 'live' },
    ]);
    assert('가중평균 23750 (MAX 25000 아님)', near(m[1].arrivalCost, 23750));
    // arrivalPerStem: (10×2000 + 30×2500)/40 = (20000+75000)/40 = 2375
    assert('arrivalPerStem 가중평균 2375', near(m[1].arrivalPerStem, 2375));
  }

  // ── 3. inQty=0 행 제외 ────────────────────────────────────────────────────
  console.log('\n=== inQty=0 행 제외 ===');
  {
    const m = aggregateArrivalCosts([
      { prodKey: 2, inQty: 0, displayArrivalKRW: 99999, arrivalPerStem: 9999, displayUnit: '단', source: 'live' },
      { prodKey: 2, inQty: 4, displayArrivalKRW: 15000, arrivalPerStem: 1500, displayUnit: '단', source: 'live' },
    ]);
    assert('inQty=0 무시 → 15000', near(m[2].arrivalCost, 15000));
  }

  // ── 4. 빈/null 입력 방어 ──────────────────────────────────────────────────
  console.log('\n=== 빈/null 입력 방어 ===');
  {
    const m1 = aggregateArrivalCosts(null);
    const m2 = aggregateArrivalCosts([]);
    assert('null → {}', Object.keys(m1).length === 0);
    assert('[] → {}', Object.keys(m2).length === 0);
  }

  // ── 5. 여러 prodKey 분리 키잉 ─────────────────────────────────────────────
  console.log('\n=== 여러 prodKey 독립 집계 ===');
  {
    const m = aggregateArrivalCosts([
      { prodKey: 10, inQty: 5, displayArrivalKRW: 10000, arrivalPerStem: 1000, displayUnit: '단', source: 'snapshot' },
      { prodKey: 11, inQty: 5, displayArrivalKRW: 20000, arrivalPerStem: 2000, displayUnit: '박스', source: 'live' },
      { prodKey: 10, inQty: 5, displayArrivalKRW: 12000, arrivalPerStem: 1200, displayUnit: '단', source: 'snapshot' },
    ]);
    // prodKey 10: (5×10000 + 5×12000)/10 = 11000
    assert('p10 가중평균 11000', near(m[10].arrivalCost, 11000));
    assert('p11 = 20000', near(m[11].arrivalCost, 20000));
    assert('p11 displayUnit = 박스', m[11].displayUnit === '박스');
    assert('p11 source = live', m[11].source === 'live');
  }

  // ── 6. displayUnit='박스' 행이 있으면 source='live' 로 승격 ───────────────
  console.log('\n=== 박스 행 존재 → source=live 로 승격 ===');
  {
    const m = aggregateArrivalCosts([
      { prodKey: 5, inQty: 3, displayArrivalKRW: 50000, arrivalPerStem: 5000, displayUnit: '단', source: 'snapshot' },
      { prodKey: 5, inQty: 3, displayArrivalKRW: 55000, arrivalPerStem: 5500, displayUnit: '박스', source: 'live' },
    ]);
    assert('source=live 우선', m[5].source === 'live');
  }

  // ── 7. arrivalPerBunch 가중평균 ───────────────────────────────────────────
  console.log('\n=== arrivalPerBunch 가중평균 ===');
  {
    // (10×30000 + 10×40000)/20 = 35000
    const m = aggregateArrivalCosts([
      { prodKey: 7, inQty: 10, displayArrivalKRW: 30000, arrivalPerStem: 3000, arrivalPerBunch: 30000, displayUnit: '단', source: 'snapshot' },
      { prodKey: 7, inQty: 10, displayArrivalKRW: 40000, arrivalPerStem: 4000, arrivalPerBunch: 40000, displayUnit: '단', source: 'snapshot' },
    ]);
    assert('arrivalPerBunch 가중평균 35000', near(m[7].arrivalPerBunch, 35000));
  }

  // ── 8. arrivalPerBunch=null 행은 평균에서 제외 ────────────────────────────
  console.log('\n=== arrivalPerBunch=null 행 제외 ===');
  {
    const m = aggregateArrivalCosts([
      { prodKey: 8, inQty: 5, displayArrivalKRW: 20000, arrivalPerStem: 2000, arrivalPerBunch: null, displayUnit: '박스', source: 'live' },
    ]);
    assert('arrivalPerBunch=null 유지', m[8].arrivalPerBunch === null);
  }

  // ── 9. snapshot-vs-live source 선택 로직 (순수 플래그 테스트) ─────────────
  console.log('\n=== snapshot/live source 필드 ===');
  {
    const mSnap = aggregateArrivalCosts([
      { prodKey: 9, inQty: 5, displayArrivalKRW: 10000, arrivalPerStem: 1000, displayUnit: '단', source: 'snapshot' },
    ]);
    const mLive = aggregateArrivalCosts([
      { prodKey: 9, inQty: 5, displayArrivalKRW: 10000, arrivalPerStem: 1000, displayUnit: '단', source: 'live' },
    ]);
    assert('snapshot source 보존', mSnap[9].source === 'snapshot');
    assert('live source 보존', mLive[9].source === 'live');
  }

  console.log('\n=== arrivalCostWithVat ===');
  {
    const { arrivalCostWithVat, ARRIVAL_VAT_MULTIPLIER } = await import('../lib/pivotArrivalCalc.js');
    assert('배율 1.1', ARRIVAL_VAT_MULTIPLIER === 1.1);
    assert('30000 → 33000', near(arrivalCostWithVat(30000), 33000));
    assert('0 → 0', arrivalCostWithVat(0) === 0);
  }

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

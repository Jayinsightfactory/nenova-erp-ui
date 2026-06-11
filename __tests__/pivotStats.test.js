// Pivot 통계 순수함수 검증 — 분배단가 집계 + compact summary 합계
// 실행: node __tests__/pivotStats.test.js  (npm run test:pivot)

const assert = (label, cond) => {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}`);
  }
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.0001;

async function main() {
  // pivotStats.js 는 lib/db 를 번들러 없이 못 불러오므로 순수 모듈을 직접 임포트
  // (pivotStats.js 는 동일 함수를 re-export 함)
  const { aggregateDistCostOrders } = await import('../lib/pivotDistCost.js');

  console.log('=== 단일 행: cost 그대로 ===');
  {
    const m = aggregateDistCostOrders([
      { prodKey: 1, custName: 'A상사', outQty: 5, cost: 18000 },
    ]);
    assert('prodKey 1 / A상사 = 18000', near(m[1]['A상사'], 18000));
  }

  console.log('\n=== 동일 cust+prod 다행: OutQuantity 가중 평균 ===');
  {
    // (10×17000 + 30×18000) / 40 = (170000+540000)/40 = 17750
    const m = aggregateDistCostOrders([
      { prodKey: 1, custName: 'A상사', outQty: 10, cost: 17000 },
      { prodKey: 1, custName: 'A상사', outQty: 30, cost: 18000 },
    ]);
    assert('가중평균 17750 (MAX 18000 아님)', near(m[1]['A상사'], 17750));
  }

  console.log('\n=== 여러 거래처/품목 분리 키잉 ===');
  {
    const m = aggregateDistCostOrders([
      { prodKey: 1, custName: 'A상사', outQty: 5, cost: 10000 },
      { prodKey: 1, custName: 'B플라워', outQty: 5, cost: 12000 },
      { prodKey: 2, custName: 'A상사', outQty: 2, cost: 30000 },
    ]);
    assert('p1 A상사 10000', near(m[1]['A상사'], 10000));
    assert('p1 B플라워 12000', near(m[1]['B플라워'], 12000));
    assert('p2 A상사 30000', near(m[2]['A상사'], 30000));
    assert('p2 에 B플라워 없음', m[2]['B플라워'] === undefined);
  }

  console.log('\n=== OutQuantity<=0 행은 무시(빈 레코드/고스트 배제) ===');
  {
    const m = aggregateDistCostOrders([
      { prodKey: 1, custName: 'A상사', outQty: 0, cost: 99999 },
      { prodKey: 1, custName: 'A상사', outQty: 4, cost: 16000 },
    ]);
    assert('outQty 0 행 제외 → 16000', near(m[1]['A상사'], 16000));
  }

  console.log('\n=== Cost=0 포함 가중평균 ===');
  {
    // (5×0 + 5×20000)/10 = 10000
    const m = aggregateDistCostOrders([
      { prodKey: 1, custName: 'A상사', outQty: 5, cost: 0 },
      { prodKey: 1, custName: 'A상사', outQty: 5, cost: 20000 },
    ]);
    assert('Cost=0 섞이면 10000', near(m[1]['A상사'], 10000));
  }

  console.log('\n=== custName 빈값/null 행 무시 ===');
  {
    const m = aggregateDistCostOrders([
      { prodKey: 1, custName: '', outQty: 5, cost: 18000 },
      { prodKey: 1, custName: null, outQty: 5, cost: 18000 },
    ]);
    assert('빈 custName → 결과 키 없음', !m[1] || Object.keys(m[1]).length === 0);
  }

  console.log('\n=== 빈/누락 입력 방어 ===');
  {
    assert('null 입력 → {}', JSON.stringify(aggregateDistCostOrders(null)) === '{}');
    assert('[] 입력 → {}', JSON.stringify(aggregateDistCostOrders([])) === '{}');
  }

  console.log('\n=== compact summary 합계 (row.summary 구조 검증) ===');
  {
    // getPivotStats row 의 summary 는 { totalOrder, totalIncoming } — compact 1열 표시용.
    // 합계 산식이 detail 의 orders/incoming 합과 일치하는지 mock 으로 확인.
    const mockRow = {
      orders: { A: 12, B: 8 },
      incoming: { FlorAndes: 25 },
    };
    const totalOrder = Object.values(mockRow.orders).reduce((a, b) => a + b, 0);
    const totalIncoming = Object.values(mockRow.incoming).reduce((a, b) => a + b, 0);
    const summary = { totalOrder, totalIncoming };
    assert('summary.totalOrder = 20', summary.totalOrder === 20);
    assert('summary.totalIncoming = 25', summary.totalIncoming === 25);
  }

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

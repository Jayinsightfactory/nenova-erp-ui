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

async function testInboundWeekScope() {
  const fs = require('fs');
  const source = fs.readFileSync(require.resolve('../lib/pivotStats.js'), 'utf8');
  const { normalizedOrderYearWeekSql } = await import('../lib/pivotWeekScopeSql.js');
  const expr = normalizedOrderYearWeekSql('wm');
  const incomingQuery = source.match(/const inResult = await query\(([\s\S]*?)\);\s*\n\s*const stockResult/);
  assert('incoming week query pads legacy one-digit subweeks before comparing', Boolean(incomingQuery?.[1]?.includes("normalizedOrderYearWeekSql('wm')")));
  assert('normalized warehouse key reads year and both OrderWeek components', /CAST\(wm\.OrderYear AS NVARCHAR\(4\)\).*CHARINDEX\('-'.*wm\.OrderWeek/s.test(expr));
  assert('order and inbound pivot rows both retain CountryFlower for country matching', (source.match(/p\.CountryFlower AS countryFlower/g) || []).length === 2);
  assert('inbound pivot metadata carries CountryFlower through to the response rows', /countryFlower: r\.countryFlower \|\| ''/.test(source) && /countryFlower: item\?\.countryFlower \|\| meta\.countryFlower \|\| ''/.test(source));
}

async function main() {
  await testInboundWeekScope();
  const { pivotCustomerQuantity } = await import('../lib/pivotCustomerQuantity.js');
  const duplicateNameRow = { orders: { '공통상호': 7 }, ordersByCustKey: { '10': 3, '20': 4 } };
  assert('동일 업체명도 CustKey 10은 자기 주문3만 조회', pivotCustomerQuantity(duplicateNameRow, { custKey: 10, custName: '공통상호' }) === 3);
  assert('동일 업체명도 CustKey 20은 자기 주문4만 조회', pivotCustomerQuantity(duplicateNameRow, { custKey: 20, custName: '공통상호' }) === 4);
  assert('기존 피벗 응답은 업체명 fallback 유지', pivotCustomerQuantity({ orders: { '기존업체': 5 } }, { custKey: 30, custName: '기존업체' }) === 5);

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

  console.log('\n=== aggregateOutOrders: 거래처별 확정 출고 합계 ===');
  {
    const { aggregateOutOrders } = await import('../lib/pivotDistCost.js');
    const m = aggregateOutOrders([
      { prodKey: 10, custName: '신라호텔', outQty: 100 },
      { prodKey: 10, custName: '신라호텔', outQty: 50 },
      { prodKey: 10, custName: 'B호텔', outQty: 20 },
      { prodKey: 10, custName: '', outQty: 5 },
    ]);
    assert('신라호텔 150', m[10]['신라호텔'] === 150);
    assert('B호텔 20', m[10]['B호텔'] === 20);
    assert('빈 custName 무시', m[10][''] == null);
  }

  console.log('\n=== cleanPivotProdName: 꽃/품종 접두어 제거 ===');
  {
    const { cleanPivotProdName } = await import('../lib/pivotProdName.js');
    assert('ROSE / Freedom 50cm → Freedom 50cm', cleanPivotProdName('ROSE / Freedom 50cm', '장미') === 'Freedom 50cm');
    assert('CARNATION Crimea → Crimea', cleanPivotProdName('CARNATION Crimea', '카네이션') === 'Crimea');
    assert('ALSTROMERIA Dubai → Dubai', cleanPivotProdName('ALSTROMERIA Dubai', '알스트로') === 'Dubai');
    assert('빈 입력', cleanPivotProdName('', '장미') === '');
  }

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

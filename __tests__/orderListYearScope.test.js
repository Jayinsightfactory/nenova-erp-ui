const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  const { resolveOrderListYearScope } = await import('../lib/orderListYearScope.js');

  assert.deepEqual(
    resolveOrderListYearScope({ week: '35-01', startDate: '2026-08-24', endDate: '2026-08-30' }),
    { orderYear: '2026', orderWeek: '35-01', source: 'DATE_RANGE' },
  );
  assert.deepEqual(
    resolveOrderListYearScope({ week: '35-01', explicitYear: '2026' }),
    { orderYear: '2026', orderWeek: '35-01', source: 'EXPLICIT_YEAR' },
  );
  assert.deepEqual(
    resolveOrderListYearScope({ week: '2025-35-01', explicitYear: '2025' }),
    { orderYear: '2025', orderWeek: '35-01', source: 'FULL_WEEK' },
  );
  assert.throws(
    () => resolveOrderListYearScope({ week: '2025-35-01', explicitYear: '2026' }),
    /연도.*다릅니다/,
  );
  assert.throws(
    () => resolveOrderListYearScope({ week: '35-01', startDate: '2025-12-29', endDate: '2026-01-04' }),
    /두 연도/,
  );

  const fixture = [
    { OrderYear: '2025', OrderWeek: '35-01', CustKey: 7, ProdKey: 101, Qty: 9 },
    { OrderYear: '2026', OrderWeek: '35-01', CustKey: 7, ProdKey: 101, Qty: 5 },
  ];
  const selected = resolveOrderListYearScope({ week: '35-01', explicitYear: '2026' });
  assert.deepEqual(
    fixture.filter(row => row.OrderYear === selected.orderYear && row.OrderWeek === selected.orderWeek).map(row => row.Qty),
    [5],
    '동일 차수의 전년도 주문이 현재연도 조회에 섞이면 안 된다.',
  );

  const pageSource = fs.readFileSync('pages/orders/index.js', 'utf8');
  assert.match(pageSource, /year:\s*resolveOrderListYearScope/);
  const apiSource = fs.readFileSync('pages/api/orders/index.js', 'utf8');
  assert.match(apiSource, /vo\.OrderWeek = @week[\s\S]*vo\.OrderYear = @orderYear/);
  assert.doesNotMatch(apiSource, /vo\.OrderYear = @orderYear OR vo\.OrderYear IS NULL/);

  console.log('order list year scope tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

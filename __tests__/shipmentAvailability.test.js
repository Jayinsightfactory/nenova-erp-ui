const assert = require('node:assert/strict');

async function main() {
  const {
    calculateShipmentAvailability,
    hasInsufficientShipmentStock,
  } = await import('../lib/shipmentAvailability.js');

  const fixtures = [
    { prevStock: 2, currentIn: 103, totalOut: 105, expected: 0 },
    { prevStock: 2, currentIn: 8, totalOut: 10, expected: 0 },
    { prevStock: 2, currentIn: 2, totalOut: 4, expected: 0 },
    { prevStock: 1, currentIn: 4, totalOut: 5, expected: 0 },
    { prevStock: 0, currentIn: 4, totalOut: 5, expected: -1 },
    { prevStock: 2, currentIn: 103.00000000000003, totalOut: 105, expected: 0 },
  ];

  for (const fixture of fixtures) {
    const result = calculateShipmentAvailability(fixture);
    assert.equal(result.remainAfter, fixture.expected, JSON.stringify(fixture));
    assert.equal(hasInsufficientShipmentStock(result.remainAfter), fixture.expected < 0);
  }

  const years = [
    { orderYearWeek: '20252902', stock: 900 },
    { orderYearWeek: '20262801', stock: 2 },
    { orderYearWeek: '20262902', stock: 777 },
  ];
  const selected = years
    .filter((row) => row.orderYearWeek < '20262902')
    .sort((a, b) => b.orderYearWeek.localeCompare(a.orderYearWeek))[0];
  assert.deepEqual(selected, years[1], '2025 동일 차수나 현재 스냅샷 대신 현재 결합키 직전 스냅샷을 선택해야 한다.');

  console.log('shipment availability tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

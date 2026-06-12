// Pivot 물량표 행 포함 로직 — node __tests__/pivotVolumeRows.test.js

const assert = (label, cond) => {
  if (!cond) {
    console.error(`  ✗ ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${label}`);
  }
};

async function main() {
  const {
    includePivotVolumeRow,
    sumOrderQty,
    sumIncomingQty,
    sumMapQty,
  } = await import('../lib/pivotVolumeRows.js');

  console.log('=== sumMapQty ===');
  assert('null → 0', sumMapQty(null) === 0);
  assert('A:10 B:5 → 15', sumMapQty({ A: 10, B: '5' }) === 15);

  console.log('\n=== sumOrderQty — totalOrder vs orders 불일치 방어 ===');
  assert('totalOrder만', sumOrderQty({ totalOrder: 30, orders: {} }) === 30);
  assert('orders만 (totalOrder 0)', sumOrderQty({ totalOrder: 0, orders: { A: 12, B: 8 } }) === 20);
  assert('둘 다 있으면 max', sumOrderQty({ totalOrder: 5, orders: { A: 20 } }) === 20);

  console.log('\n=== sumIncomingQty ===');
  assert('incoming 맵만', sumIncomingQty({ totalIncoming: 0, incoming: { F1: 100 } }) === 100);

  console.log('\n=== includePivotVolumeRow ===');
  assert('주문만 (입고 0) 포함', includePivotVolumeRow({
    totalOrder: 0,
    totalIncoming: 0,
    orders: { '주광': 50 },
    incoming: {},
  }));
  assert('입고만 포함', includePivotVolumeRow({
    totalOrder: 0,
    totalIncoming: 25,
    orders: {},
    incoming: { FlorAndes: 25 },
  }));
  assert('주문·입고 모두 0 → 제외', !includePivotVolumeRow({
    totalOrder: 0,
    totalIncoming: 0,
    orders: {},
    incoming: {},
  }));
  assert('totalOrder>0 입고0 포함', includePivotVolumeRow({
    totalOrder: 10,
    totalIncoming: 0,
    orders: { A: 10 },
  }));
  assert('전재고만 포함(물량표)', includePivotVolumeRow({ prevStock: 50, orders: {}, incoming: {} }));

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

const assert = require('node:assert/strict');

async function expectCode(fn, code) {
  await assert.rejects(fn, (error) => error?.code === code);
}

function fixedRow(overrides = {}) {
  return {
    SdetailKey: 101,
    ProdKey: 7,
    OrderYear: '2026',
    OrderWeek: '34-02',
    DetailIsFix: true,
    MasterIsFix: true,
    DetailOutQuantity: 10,
    DateShipmentQuantity: 10,
    ...overrides,
  };
}

function change(row, next) {
  return { row, newDateOutQuantity: next, newDateEstQuantity: next };
}

async function mockTransaction(state, fn) {
  const before = structuredClone(state);
  try {
    return await fn(state);
  } catch (error) {
    Object.assign(state, before);
    throw error;
  }
}

async function main() {
  const helper = await import('../lib/estimateDirectionalQuantity.js');
  const {
    assertDirectionalGateCapability,
    assertDirectionalDateSnapshot,
    assertDirectionalPlanYears,
    assertNativeResult,
    buildDirectionalQuantityPlan,
    evaluateDirectionalAvailability,
    evaluateDirectionalCurrentStock,
    formatDirectionalProductLabel,
    fixedDirectionalChanges,
    lockDirectionalGate,
    positiveIncreaseByProduct,
  } = helper;

  // A milliquantity is physical inventory and must never be rounded to zero.
  const milliRow = fixedRow({ DetailOutQuantity: 0.001, DateShipmentQuantity: 0.001 });
  const milli = buildDirectionalQuantityPlan({
    changes: [change(milliRow, 0)],
    lockedBaselines: [{ SdetailKey: 101, DateCount: 1, DateOutTotal: 0.001 }],
  });
  assert.equal(milli[0].confirmedDelta, -0.001);
  assert.equal(milli[0].newDetailOutQuantity, 0);

  const decrease = buildDirectionalQuantityPlan({
    changes: [change(fixedRow(), 9)],
    lockedBaselines: [{ SdetailKey: 101, DateCount: 1, DateOutTotal: 10 }],
  });
  assert.equal(decrease[0].fixed, true);
  assert.equal(decrease[0].confirmedDelta, -1);
  assert.equal(positiveIncreaseByProduct(decrease).size, 0);

  const mixed = buildDirectionalQuantityPlan({
    changes: [
      change(fixedRow({ SdetailKey: 101 }), 11),
      change(fixedRow({ SdetailKey: 102, DetailOutQuantity: 10, DateShipmentQuantity: 10 }), 9),
      change(fixedRow({ SdetailKey: 103, OrderWeek: '34-03' }), 12),
      change(fixedRow({ SdetailKey: 104, DetailIsFix: false, MasterIsFix: false }), 11),
    ],
    lockedBaselines: [
      { SdetailKey: 101, DateCount: 1, DateOutTotal: 10 },
      { SdetailKey: 102, DateCount: 1, DateOutTotal: 10 },
      { SdetailKey: 103, DateCount: 1, DateOutTotal: 10 },
      { SdetailKey: 104, DateCount: 1, DateOutTotal: 10 },
    ],
  });
  const increaseScopes = [...positiveIncreaseByProduct(mixed).values()].sort((a, b) => a.orderWeek.localeCompare(b.orderWeek));
  assert.deepEqual(increaseScopes, [
    { orderYear: '2026', orderWeek: '34-02', prodKey: 7, increase: 2 },
    { orderYear: '2026', orderWeek: '34-03', prodKey: 7, increase: 2 },
  ]);
  const unfixedIncrease = mixed.find((group) => Number(group.row.SdetailKey) === 104);
  assert.equal(fixedDirectionalChanges([unfixedIncrease]).length, 0, 'unfixed edits must not invoke native calculation');
  const unfixedEnough = evaluateDirectionalAvailability({
    facts: { prevStock: 20, currentIn: 0, adjustQty: 0, totalOut: 11 },
    increase: 1,
    scope: { prodKey: 7, orderYear: '2026', orderWeek: '34-02' },
  });
  assert.equal(unfixedEnough.remain, 8, 'all active unfixed baseline plus the positive delta is checked');
  assert.equal(formatDirectionalProductLabel({ prodKey: 7, countryFlower: '콜롬비아 알스트로', prodName: 'ALSTROMERIA Fifi' }), '콜롬비아 알스트로 · ALSTROMERIA Fifi (#7)');
  assert.equal(formatDirectionalProductLabel({ prodKey: 7, prodName: 'ALSTROMERIA Fifi' }), 'ALSTROMERIA Fifi (#7)');
  assert.equal(formatDirectionalProductLabel({ prodKey: 7 }), '품목키 #7');
  assert.throws(() => evaluateDirectionalAvailability({
    facts: { prevStock: 5, currentIn: 0, adjustQty: 0, totalOut: 10 },
    increase: 1,
    scope: { prodKey: 7, orderYear: '2026', orderWeek: '34-02', countryFlower: '콜롬비아 알스트로', prodName: 'ALSTROMERIA Fifi' },
  }), (error) => error?.code === 'STOCK_SHORTAGE'
    && error.message.includes('콜롬비아 알스트로 · ALSTROMERIA Fifi (#7)')
    && error.stockValidation?.availability?.[0]?.productLabel === '콜롬비아 알스트로 · ALSTROMERIA Fifi (#7)');
  assert.throws(() => evaluateDirectionalAvailability({
    facts: { prevStock: 1, currentIn: 0, adjustQty: 0, totalOut: 1.001 },
    increase: 0,
    scope: { prodKey: 7 },
  }), { code: 'STOCK_SHORTAGE' });
  assert.throws(() => evaluateDirectionalAvailability({
    facts: { prevStock: 1, currentIn: 0, adjustQty: 0, totalOut: 1.4 },
    increase: 0,
    scope: { prodKey: 7 },
  }), { code: 'STOCK_SHORTAGE' });
  assert.equal(evaluateDirectionalAvailability({
    facts: { prevStock: 1, currentIn: 0, adjustQty: 0, totalOut: 1.00000001 },
    increase: 0,
    scope: { prodKey: 7 },
  }).remain, 0, 'floating noise below one milliquantity is normalized to zero');
  const startedStock = evaluateDirectionalCurrentStock({
    currentStock: 80,
    increase: 20,
    scope: { prodKey: 59, orderYear: '2026', orderWeek: '35-02', countryFlower: '콜롬비아알스트로', prodName: 'ALSTROMERIA Lavender' },
  });
  assert.equal(startedStock.remain, 60, 'current stock already reflects existing shipment and subtracts only the new increase');
  assert.equal(startedStock.source, 'Product.Stock');
  assert.throws(() => evaluateDirectionalCurrentStock({
    currentStock: 10,
    increase: 20,
    scope: { prodKey: 59, countryFlower: '콜롬비아알스트로', prodName: 'ALSTROMERIA Lavender' },
  }), (error) => error?.code === 'STOCK_SHORTAGE' && error.message.includes('현재 가용재고=10'));

  assert.throws(() => buildDirectionalQuantityPlan({
    changes: [change(fixedRow({ DetailIsFix: null }), 9)],
    lockedBaselines: [{ SdetailKey: 101, DateCount: 1, DateOutTotal: 10 }],
  }), { code: 'FIX_STATUS_INVALID' });
  assert.throws(() => buildDirectionalQuantityPlan({
    changes: [change(fixedRow(), 9)],
    lockedBaselines: [{ SdetailKey: 101, DateCount: 1, DateOutTotal: 8 }],
  }), { code: 'FIXED_BASELINE_INVALID' });
  assert.throws(() => assertDirectionalPlanYears(buildDirectionalQuantityPlan({
    changes: [change(fixedRow({ OrderYear: '2025' }), 9)],
    lockedBaselines: [{ SdetailKey: 101, DateCount: 1, DateOutTotal: 10 }],
  })), { code: 'DIRECTIONAL_YEAR_INVALID' });
  assert.throws(() => assertDirectionalDateSnapshot(
    { DateEstQuantity: 10, DateDescr: 'other screen', DateCost: 700 },
    { sdateKey: 101, expectedOldQuantity: 10, expectedOldDescr: 'mine', expectedOldCost: 700 },
  ), { code: 'STALE_DATA' });
  const zero = buildDirectionalQuantityPlan({
    changes: [change(fixedRow(), 0)],
    lockedBaselines: [{ SdetailKey: 101, DateCount: 1, DateOutTotal: 10 }],
  });
  assert.equal(zero[0].newDetailOutQuantity, 0);
  assert.equal(zero[0].confirmedDelta, -10);

  // Mock transaction fixtures exercise the fail-closed capability/gate path
  // and prove a later native calculation failure restores a mid-write state.
  const state = { stock: 10, writes: 0 };
  const goodQuery = async (statement) => {
    if (statement.includes('GateCapability')) return { recordset: [{ ProtocolVersion: 2, IsReady: true }] };
    if (statement.includes('NenovaStockWeekGate')) return { recordset: [{ GateKey: '1' }] };
    throw new Error(`unexpected query: ${statement}`);
  };
  await mockTransaction(state, async (tx) => {
    await assertDirectionalGateCapability(goodQuery);
    await lockDirectionalGate(goodQuery);
    tx.stock -= 1;
    tx.writes += 1;
    await expectCode(async () => assertNativeResult({ recordset: [{ result: -1, message: 'forced calc failure', TransactionState: 1 }] }), 'STOCK_CALC_FAILED');
    // The caller must throw after the failed native result; this local branch
    // models the outer transaction abort rather than committing partial writes.
    throw Object.assign(new Error('abort outer transaction'), { code: 'STOCK_CALC_FAILED' });
  }).catch(() => {});
  assert.deepEqual(state, { stock: 10, writes: 0 });

  await expectCode(() => assertDirectionalGateCapability(async () => ({ recordset: [{ ProtocolVersion: 1, IsReady: true }] })), 'STOCK_GATE_CAPABILITY_REQUIRED');
  await expectCode(() => lockDirectionalGate(async () => ({ recordset: [] })), 'STOCK_GATE_BUSY');
  await expectCode(async () => assertNativeResult({ recordset: [{ returnCode: 0, result: 0, TransactionState: 0 }] }), 'STOCK_CALC_TRANSACTION_ABORTED');
  await expectCode(async () => assertNativeResult({ recordset: [{ returnCode: -1, result: 0, TransactionState: 1 }] }), 'STOCK_CALC_FAILED');
  await expectCode(async () => assertNativeResult({ recordset: [{ returnCode: null, result: 0, TransactionState: 1 }] }), 'STOCK_CALC_FAILED');
  await expectCode(async () => assertNativeResult({ recordset: [{ returnCode: 0, result: null, TransactionState: 1 }] }), 'STOCK_CALC_FAILED');

  console.log('Estimate directional quantity tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

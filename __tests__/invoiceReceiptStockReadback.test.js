const assert = require('node:assert/strict');
const { test } = require('node:test');

const helperPromise = import('../lib/invoiceReceiptStockReadback.js');
const types = { Int: 'Int', NVarChar: 'NVarChar' };

function stockRow(overrides = {}) {
  return {
    StockKey: 2601,
    OrderYear: '2026',
    OrderWeek: '41-01',
    OrderYearWeek: '20264101',
    BusinessScopeCount: 1,
    NativeScopeCount: 1,
    ProdKey: 7201,
    PreviousMasterCount: 1,
    PreviousStockKey: 2501,
    PreviousStockCount: 1,
    PreviousStock: 30,
    WarehouseQuantity: 10.29,
    ShipmentQuantity: 3.07,
    ManualQuantity: -0.02,
    CurrentStockCount: 1,
    ActualStock: 37.2,
    ExpectedStock: 37.2,
    IsMatch: true,
    ...overrides,
  };
}

function response(rows = [stockRow()]) {
  return { recordsets: [
    [{ ProdKey: 7201, ActiveProductCount: 1 }],
    [{ SelectedMasterCount: 1, FutureMasterCount: rows.length }],
    rows,
  ] };
}

async function verify(queryFn, overrides = {}) {
  const { verifyInvoiceStockReadback } = await helperPromise;
  return verifyInvoiceStockReadback(
    queryFn,
    types,
    { orderYear: '2026', orderWeek: '41-01', ...overrides.document },
    overrides.keys ?? [7201],
  );
}

test('verifies selected and future-year ProductStock with the exact native SQL formula', async () => {
  const rows = [
    stockRow(),
    stockRow({ StockKey: 2701, OrderYear: '2027', OrderWeek: '01-01',
      OrderYearWeek: '20270101', PreviousStockKey: 2601, PreviousStock: 37.2,
      WarehouseQuantity: 2, ShipmentQuantity: 0.2, ManualQuantity: 0,
      ActualStock: 39, ExpectedStock: 39 }),
  ];
  let calls = 0;
  const queryFn = async (sql, params) => {
    calls += 1;
    assert.match(sql, /OrderYearWeek>=@startOrderYearWeek/);
    assert.match(sql, /TOP 1 prior\.OrderYearWeek/);
    assert.match(sql, /prior\.OrderYearWeek<scope\.OrderYearWeek/);
    assert.match(sql, /ROUND\(SUM\(vw\.OutQuantity\),2\)/);
    assert.match(sql, /ROUND\(SUM\(vs\.OutQuantity\),2\)/);
    assert.match(sql, /vs\.DetailFix=1/);
    assert.match(sql, /ROUND\(SUM\(sh\.AfterValue-sh\.BeforeValue\),2\)/);
    assert.match(sql, /ci\.Category=N'StockType'/);
    assert.match(sql, /SELECT ROUND\(ISNULL\(previousStock\.PreviousStock,0\)/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|MERGE)\s+dbo\./i);
    assert.deepEqual(params, {
      year: { type: 'NVarChar', value: '2026' },
      week: { type: 'NVarChar', value: '41-01' },
      p0: { type: 'Int', value: 7201 },
    });
    return { recordsets: [
      [{ ProdKey: 7201, ActiveProductCount: 1 }],
      [{ SelectedMasterCount: 1, FutureMasterCount: 2 }],
      rows,
    ] };
  };
  const result = await verify(queryFn);
  assert.equal(calls, 1);
  assert.equal(result.stockMasterCount, 2);
  assert.deepEqual(result.changedProdKeys, [7201]);
  assert.deepEqual(result.rows.map(row => [row.orderYear, row.orderWeek, row.actualStock]),
    [['2026', '41-01', 37.2], ['2027', '01-01', 39]]);
});

test('deduplicates and binds changed product keys without interpolating their values', async () => {
  const { verifyInvoiceStockReadback } = await helperPromise;
  const queryFn = async (sql, params) => {
    assert.match(sql, /\(0,@p0\),\(1,@p1\)/);
    assert.equal(params.p0.value, 7201);
    assert.equal(params.p1.value, 7202);
    return { recordsets: [
      [{ ProdKey: 7201, ActiveProductCount: 1 }, { ProdKey: 7202, ActiveProductCount: 1 }],
      [{ SelectedMasterCount: 1, FutureMasterCount: 1 }],
      [stockRow(), stockRow({ ProdKey: 7202 })],
    ] };
  };
  const result = await verifyInvoiceStockReadback(queryFn, types,
    { orderYear: '2026', orderWeek: '41-01' }, [7201, '7201', 7202]);
  assert.deepEqual(result.changedProdKeys, [7201, 7202]);
});

test('empty changed product scope is a no-query no-op', async () => {
  let called = false;
  const result = await verify(() => { called = true; }, { keys: [] });
  assert.equal(called, false);
  assert.deepEqual(result.rows, []);
  assert.equal(result.stockMasterCount, 0);
});

test('invalid year, week, product keys, and dependencies fail before SQL', async () => {
  const { verifyInvoiceStockReadback } = await helperPromise;
  let calls = 0;
  const queryFn = async () => { calls += 1; };
  for (const input of [
    [{ orderYear: '2025', orderWeek: '41-01' }, [7201]],
    [{ orderYear: '2026', orderWeek: '2026-41-01' }, [7201]],
    [{ orderYear: '2026', orderWeek: '41-01' }, [0]],
    [{ orderYear: '2026', orderWeek: '41-01' }, [1.5]],
    [{ orderYear: '2026', orderWeek: '41-01' }, [2147483648]],
  ]) await assert.rejects(verifyInvoiceStockReadback(queryFn, types, ...input));
  await assert.rejects(verifyInvoiceStockReadback(null, types,
    { orderYear: '2026', orderWeek: '41-01' }, [7201]), TypeError);
  assert.equal(calls, 0);
});

test('missing or inactive affected product fails closed', async () => {
  await assert.rejects(verify(async () => ({ recordsets: [
    [{ ProdKey: 7201, ActiveProductCount: 0 }],
    [{ SelectedMasterCount: 1, FutureMasterCount: 1 }],
    [stockRow()],
  ] })), { code: 'STOCK_READBACK_PRODUCT_SCOPE_CHANGED' });
});

for (const [label, row] of [
  ['business-scope StockMaster', { BusinessScopeCount: 2 }],
  ['native-key StockMaster', { NativeScopeCount: 2 }],
  ['nearest previous StockMaster', { PreviousMasterCount: 2 }],
  ['previous ProductStock', { PreviousStockCount: 2 }],
  ['current ProductStock', { CurrentStockCount: 2 }],
]) test(`duplicate ${label} fails closed`, async () => {
  await assert.rejects(verify(async () => response([stockRow(row)])), {
    code: 'STOCK_READBACK_DUPLICATE',
  });
});

test('missing selected StockMaster or current ProductStock fails closed', async () => {
  await assert.rejects(verify(async () => ({ recordsets: [
    [{ ProdKey: 7201, ActiveProductCount: 1 }],
    [{ SelectedMasterCount: 0, FutureMasterCount: 0 }],
    [],
  ] })), { code: 'STOCK_READBACK_MISSING' });
  await assert.rejects(verify(async () => response([
    stockRow({ CurrentStockCount: 0, ActualStock: null, IsMatch: false }),
  ])), { code: 'STOCK_READBACK_MISSING' });
});

test('SQL-native formula mismatch exposes only the bounded failed scope', async () => {
  await assert.rejects(verify(async () => response([
    stockRow({ ActualStock: 37.21, ExpectedStock: 37.2, IsMatch: false }),
  ])), error => {
    assert.equal(error.code, 'STOCK_READBACK_MISMATCH');
    assert.deepEqual(error.details, {
      stockKey: 2601,
      orderYear: '2026',
      orderWeek: '41-01',
      prodKey: 7201,
      expectedStock: 37.2,
      actualStock: 37.21,
    });
    return true;
  });
});

test('malformed or incomplete result sets are never accepted', async () => {
  for (const value of [null, {}, { recordset: [] }, { recordsets: [[], [], []] }]) {
    await assert.rejects(verify(async () => value), { code: 'STOCK_READBACK_RESULT_INVALID' });
  }
});

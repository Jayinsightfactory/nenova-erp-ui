const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const modulePromise = import('../lib/profitReportCountryAverage.mjs');

const snapshot = { orderYear: '2026', week: '31-02', stockKey: 31, snapshotAvailable: true };
const receipt = (extra = {}) => ({ Category: '태국', ProdKey: 608, ProdName: 'Den. White Bom',
  OrderYear: '2026', OrderWeek: '31-01', WdetailKey: 1,
  OutUnit: '단', EstUnit: '단', BunchQuantity: 10, SteamQuantity: 100, EstQuantity: 10,
  BoxQuantity: 0, TPrice: 35, SteamOf1Bunch: 0, SteamOf1Box: 0, BunchOf1Box: 10, ...extra });
const stock = (extra = {}) => ({ Category: '태국', ProdKey: 608, ProdName: 'Den. White Bom',
  OrderYear: '2026', OrderWeek: '31-02', StockKey: 31,
  Stock: 3, OutUnit: '단', EstUnit: '단', SteamOf1Bunch: 0, SteamOf1Box: 0, BunchOf1Box: 10, ...extra });
const calculate = async (extra = {}) => {
  const { normalizeCountryInventoryQuantities } = await modulePromise;
  return normalizeCountryInventoryQuantities({ major: '31', year: '2026', snapshot,
    purchases: [receipt()], stocks: [stock()], historicalReceipts: [receipt()], ...extra });
};

test('four-country units are explicit; actual Thai receipt establishes product 608 ratio 10', async () => {
  const { COUNTRY_AVERAGE_UNITS } = await modulePromise;
  assert.deepEqual(COUNTRY_AVERAGE_UNITS, { 네덜란드: '송이', 태국: '송이', 중국: '단', 에콰도르: '송이' });
  const result = (await calculate()).태국;
  assert.equal(result.eligible, true);
  assert.equal(result.purchaseQty, 100);
  assert.equal(result.stockQty, 30);
  assert.ok(result.sources.every(s => typeof s === 'string'));
  assert.ok(result.details[1].evidence.some(e => e.source === 'warehouse_actual_ratio'));
});

test('cross-year and future receipt ratios never enter a selected stock snapshot', async () => {
  const result = (await calculate({ historicalReceipts: [receipt({ OrderYear: '2025' }), receipt({ OrderWeek: '32-01' })] })).태국;
  assert.equal(result.eligible, false);
  assert.equal(result.stockQty, null);
  assert.equal(result.issues[0].code, 'missing_conversion');
  for (const OrderWeek of ['00-01', '31-00', '31-100', '54-01']) {
    assert.equal((await calculate({ historicalReceipts: [receipt({ OrderWeek })] })).태국.eligible, false, 'invalid legacy period is not conversion evidence');
  }
});

test('cross-year purchase and stock rows cannot contaminate totals', async () => {
  const result = (await calculate({ purchases: [receipt(), receipt({ OrderYear: '2025', SteamQuantity: 9000 })],
    stocks: [stock(), stock({ OrderYear: '2025', Stock: 9000 }), stock({ StockKey: 32, Stock: 9000 })] })).태국;
  assert.equal(result.purchaseQty, 100);
  assert.equal(result.stockQty, 30);
});

test('any unconvertible stock or purchase rejects a partial country average', async () => {
  const result = (await calculate({ stocks: [stock(), stock({ ProdKey: 999 })] })).태국;
  assert.equal(result.eligible, false);
  assert.equal(result.purchaseQty, null);
  assert.equal(result.stockQty, null);
  const badPurchase = (await calculate({ purchases: [receipt(), receipt({ ProdKey: 999, SteamQuantity: 0 })] })).태국;
  assert.equal(badPurchase.eligible, false);
  assert.equal(badPurchase.purchaseQty, null);
});

test('conflicting actual receipt ratios and valid master disagreement are rejected', async () => {
  const a = (await calculate({ historicalReceipts: [receipt(), receipt({ OrderWeek: '30-01', SteamQuantity: 120 })] })).태국;
  assert.equal(a.issues[0].code, 'ambiguous_conversion');
  const b = (await calculate({ stocks: [stock({ SteamOf1Bunch: 12 })] })).태국;
  assert.equal(b.issues[0].code, 'ambiguous_conversion');
});

test('specific physical quantity precedes legacy Est/Out fields in the same current master unit', async () => {
  const result = (await calculate({ purchases: [receipt({ EstUnit: '송이', EstQuantity: 110 })] })).태국;
  assert.equal(result.eligible, true);
  assert.equal(result.purchaseQty, 100);
  assert.equal(result.details[0].evidence[0].field, 'SteamQuantity');
});

test('mixed bunch/stem/box stocks normalize before addition and retain old NL188', async () => {
  const product = { Category: '네덜란드', SteamOf1Bunch: 10, SteamOf1Box: 100, BunchOf1Box: 10 };
  const result = (await calculate({ purchases: [receipt(product)], historicalReceipts: [], stocks: [
    stock({ ...product, ProdKey: 1, OutUnit: '송이', Stock: 188 }),
    stock({ ...product, ProdKey: 2, OutUnit: '단', Stock: 10 }),
    stock({ ...product, ProdKey: 3, OutUnit: '박스', Stock: 2 }),
  ] })).네덜란드;
  assert.equal(result.eligible, true);
  assert.equal(result.stockQty, 488);
});

test('Thai loose blooms stays in numerator-matched purchase denominator', async () => {
  const loose = receipt({ ProdKey: 630, ProdName: 'Den. white bom loose blooms', SteamQuantity: 1700,
    BunchQuantity: 17, EstQuantity: 17, SteamOf1Bunch: 100 });
  const result = (await calculate({ purchases: [receipt(), loose] })).태국;
  assert.equal(result.purchaseQty, 1800);
});

test('EC box sample uses its own 150-stem receipt, not a different 350-stem rose sample', async () => {
  const ec = receipt({ Category: '에콰도르', ProdKey: 3227, OutUnit: '박스', EstUnit: '박스',
    BoxQuantity: 1, EstQuantity: 1, BunchQuantity: 0, SteamQuantity: 150, BunchOf1Box: 0 });
  const rose = receipt({ Category: '에콰도르', ProdKey: 3240, SteamQuantity: 350, BunchQuantity: 35, EstQuantity: 35 });
  const options = { purchases: [ec, rose], stocks: [stock({ Category: '에콰도르', ProdKey: 3227, OutUnit: '박스', Stock: 1, BunchOf1Box: 0 })],
    historicalReceipts: [ec, { ...ec, OrderWeek: '29-01', WdetailKey: 2, EstQuantity: 6, BunchQuantity: 6 }, rose] };
  const result = (await calculate(options)).에콰도르;
  assert.equal(result.purchaseQty, 500);
  assert.equal(result.stockQty, 150);
  const noOwnEvidence = (await calculate({ ...options, historicalReceipts: [rose] })).에콰도르;
  assert.equal(noOwnEvidence.eligible, false);
});

test('negative stocks are preserved; explicit zero requires no invented ratio', async () => {
  assert.equal((await calculate({ stocks: [stock({ Stock: -3 })] })).태국.stockQty, -30);
  const zero = (await calculate({ stocks: [stock({ Stock: 0, OutUnit: null })], historicalReceipts: [] })).태국;
  assert.equal(zero.eligible, true);
  assert.equal(zero.stockQty, 0);
});

test('null stock is not zero, and absent real snapshot cannot masquerade as zero', async () => {
  assert.equal((await calculate({ stocks: [stock({ Stock: null })] })).태국.eligible, false);
  const result = (await calculate({ snapshot: { ...snapshot, snapshotAvailable: false } })).태국;
  assert.equal(result.reason, 'missing_snapshot');
  assert.equal(result.stockQty, null);
});

test('all-zero purchase with explicit zero amount is preserved, not a positive denominator', async () => {
  const result = (await calculate({ purchases: [receipt({ SteamQuantity: 0, BunchQuantity: 0, EstQuantity: 0, TPrice: 0 })] })).태국;
  assert.equal(result.reason, 'no_purchase');
  assert.equal(result.issues.length, 0);
  const priced = (await calculate({ purchases: [receipt({ SteamQuantity: 0, BunchQuantity: 0, EstQuantity: 0, TPrice: 5 })] })).태국;
  assert.equal(priced.issues[0].code, 'missing_purchase_quantity');
});

test('China remains bunch-based and aliases are accepted without stem multiplication', async () => {
  const cn = { Category: '중국', OutUnit: 'BUNCH', EstUnit: 'BUN' };
  const result = (await calculate({ purchases: [receipt(cn)], stocks: [stock(cn)] })).중국;
  assert.equal(result.purchaseQty, 10);
  assert.equal(result.stockQty, 3);
});

test('noninventory expense rows are excluded from purchase and stock together', async () => {
  const result = (await calculate({ purchases: [receipt(), receipt({ ProdName: 'SERVICE FEE', SteamQuantity: 900 })],
    stocks: [stock(), stock({ ProdName: 'GROSS WEIGHT', Stock: 999 })] })).태국;
  assert.equal(result.purchaseQty, 100);
  assert.equal(result.stockQty, 30);
});

test('snapshot zero residual is valid with purchases but missing year is not inferred', async () => {
  const result = (await calculate({ stocks: [] })).태국;
  assert.equal(result.eligible, true);
  assert.equal(result.stockQty, 0);
  assert.equal((await calculate({ year: undefined })).태국.reason, 'invalid_scope');
});

test('loader is SELECT-only and uses Q filter, selected year/snapshot, bounded exact-product history', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/profitReport.js'), 'utf8');
  const loader = source.slice(source.indexOf('export async function normalizedCountryInventoryQuantities('), source.indexOf('/** 차수별 과세환율'));
  assert.ok(loader.length > 1000);
  assert.doesNotMatch(loader, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC)\s/i);
  assert.match(loader, /latestStockSnapshotWeek\(major, orderYear\)/);
  assert.match(loader, /sm.StockKey=@stockKey AND sm.OrderYear=@yr AND sm.OrderWeek=@week/);
  assert.match(loader, /wm.OrderYear=@yr/);
  assert.match(loader, /<=@snapshotRank/);
  assert.match(loader, /STRING_SPLIT\(@prodKeys/);
  assert.equal((loader.match(/stockablePurchaseItemSql\('p'\)/g) || []).length, 3);
  assert.doesNotMatch(loader, /(?:wd|p)\.isDeleted|\.isFix\s*=/);
  assert.match(loader, /ROW_NUMBER\(\) OVER/);
  assert.match(loader, /counts.SnapshotRowCount DESC,sm.StockKey DESC/);
  assert.match(loader, /ranked.position=1/);
  assert.match(loader, /FROM ViewShipment vs WHERE vs.OrderYear=@yr/);
  assert.match(loader, /StockTypeMatches/);
});

const zeroSnapshot = (extra = {}) => ({ OrderYear: '2026', OrderWeek: '31-01', StockKey: 260,
  ProdKey: 1959, Stock: 0, SnapshotRowCount: 100, ...extra });
const cycle = (extra = {}) => ({ complete: true, orderYear: '2026', week: '31-02',
  snapshots: [zeroSnapshot()], shipments: [], adjustments: [], ...extra });
const nlReceipt = (extra = {}) => receipt({ Category: '네덜란드', ProdKey: 1959,
  ProdName: 'Tulip / Single Orange Juice', OutQuantity: 10, SteamOf1Bunch: 10,
  OrderWeek: '31-02', ...extra });
const nlStock = (extra = {}) => stock({ Category: '네덜란드', ProdKey: 1959,
  ProdName: 'Tulip / Single Orange Juice', SteamOf1Bunch: 10, Stock: 10, ...extra });
const oldBadNlReceipt = nlReceipt({ OrderWeek: '09-01', WdetailKey: 23766, SteamQuantity: 200 });
const nlCycleResult = async (extra = {}) => (await calculate({ purchases: [nlReceipt()], stocks: [nlStock()],
  historicalReceipts: [oldBadNlReceipt, nlReceipt()], cycleEvidence: cycle(), ...extra })).네덜란드;

test('NL31 depleted old ratio conflict does not poison a reconciled new 100-stem cycle', async () => {
  const result = await nlCycleResult();
  assert.equal(result.eligible, true);
  assert.equal(result.stockQty, 100);
  const evidence = result.details.find(d => d.phase === 'stock').evidence[0];
  assert.equal(evidence.source, 'zero_anchor_uniform_receipts');
  assert.equal(evidence.anchorWeek, '31-01');
  assert.equal(evidence.lots.length, 1);
});

test('NL29 same-ratio partial consumption is exactly 50 stems; no FIFO assumption', async () => {
  const current = nlReceipt({ OrderWeek: '29-02', WdetailKey: 35875 });
  const result = await nlCycleResult({ major: '29', snapshot: { ...snapshot, week: '29-02', stockKey: 258 },
    purchases: [current], historicalReceipts: [oldBadNlReceipt, current],
    stocks: [nlStock({ OrderWeek: '29-02', StockKey: 258, Stock: 5 })],
    cycleEvidence: cycle({ week: '29-02', snapshots: [zeroSnapshot({ OrderWeek: '29-01', StockKey: 250 })],
      shipments: [{ OrderYear: '2026', OrderWeek: '29-02', ProdKey: 1959, OutQuantity: 5, DetailFix: 1 }] }) });
  assert.equal(result.eligible, true);
  assert.equal(result.stockQty, 50);
});

test('NL09 inconsistent physical receipt plus corrective stock adjustment remains blocked', async () => {
  const other = nlReceipt({ OrderWeek: '09-01', WdetailKey: 23777, BunchQuantity: 25, OutQuantity: 25, SteamQuantity: 250, EstQuantity: 25 });
  const result = await nlCycleResult({ major: '09', snapshot: { ...snapshot, week: '09-03', stockKey: 103 },
    purchases: [oldBadNlReceipt, other], historicalReceipts: [oldBadNlReceipt, other],
    stocks: [nlStock({ OrderWeek: '09-03', StockKey: 103 })],
    cycleEvidence: cycle({ week: '09-03', snapshots: [zeroSnapshot({ OrderWeek: '08-02', StockKey: 97 })],
      shipments: [{ OrderYear: '2026', OrderWeek: '09-01', ProdKey: 1959, OutQuantity: 35, DetailFix: 1 }],
      adjustments: [{ OrderYear: '2026', OrderWeek: '09-01', ProdKey: 1959, BeforeValue: 65, AfterValue: 75, StockTypeMatches: 1 }] }) });
  assert.equal(result.eligible, false);
  assert.equal(result.issues[0].code, 'ambiguous_conversion');
});

function ecCycleInputs(major = '33', extra = {}) {
  const ecReceipt = (week, stems, key) => receipt({ Category: '에콰도르', ProdKey: 3227,
    ProdName: 'Ecuador/ Gysophila sample box', OrderWeek: week, WdetailKey: key,
    OutUnit: '박스', EstUnit: '박스', OutQuantity: 1, BoxQuantity: 1, BunchQuantity: 0,
    SteamQuantity: stems, EstQuantity: 0, SteamOf1Bunch: 0, SteamOf1Box: 0, BunchOf1Box: 0 });
  const week = `${major}-02`;
  return { major, snapshot: { ...snapshot, week, stockKey: 900 },
    purchases: [ecReceipt(`${major}-01`, 250, 1000)],
    stocks: [stock({ Category: '에콰도르', ProdKey: 3227, OutUnit: '박스', EstUnit: '박스',
      Stock: 2, OrderWeek: week, StockKey: 900, BunchOf1Box: 0 })],
    historicalReceipts: [ecReceipt('29-01', 150, 35556), ecReceipt('31-01', 150, 36698), ecReceipt('33-01', 250, 37271)],
    cycleEvidence: cycle({ week, snapshots: [zeroSnapshot({ OrderWeek: '30-02', StockKey: 259, ProdKey: 3227 })],
      adjustments: [{ OrderYear: '2026', OrderWeek: '29-02', ProdKey: 3227, BeforeValue: 1, AfterValue: 0, StockTypeMatches: 1 }] }), ...extra };
}

test('EC33~35 two untouched physical lots total 400 stems, not latest250 times2 or oldest150 times2', async () => {
  for (const major of ['33', '34', '35']) {
    const result = (await calculate(ecCycleInputs(major))).에콰도르;
    assert.equal(result.eligible, true);
    assert.equal(result.stockQty, 400);
    const evidence = result.details.find(d => d.phase === 'stock').evidence[0];
    assert.equal(evidence.source, 'zero_anchor_unconsumed_lots');
    assert.deepEqual(evidence.lots.map(l => l.warehouseDetailKey), [36698, 37271]);
  }
});

test('mixed-size lots with any consumption or adjustment cannot be guessed', async () => {
  for (const mode of ['shipment', 'adjustment', 'unfixed', 'net-zero-adjustment']) {
    const input = ecCycleInputs();
    const activity = { OrderYear: '2026', OrderWeek: '33-01', ProdKey: 3227 };
    if (mode === 'shipment' || mode === 'unfixed') {
      input.cycleEvidence.shipments = [{ ...activity, OutQuantity: 1, DetailFix: mode === 'shipment' ? 1 : 0 }];
      input.stocks[0].Stock = 1;
    } else {
      input.cycleEvidence.adjustments.push({ ...activity, BeforeValue: 2, AfterValue: 1, StockTypeMatches: 1 });
      if (mode === 'net-zero-adjustment') input.cycleEvidence.adjustments.push({ ...activity, BeforeValue: 1, AfterValue: 2, StockTypeMatches: 1 });
      else input.stocks[0].Stock = 1;
    }
    assert.equal((await calculate(input)).에콰도르.eligible, false, mode);
  }
});

test('cycle recovery requires exact OutUnit balance and no missing or malformed activity', async () => {
  for (const mode of ['balance', 'missing-out', 'invalid-week', 'negative-stock', 'null-stock', 'unknown-type-multiplicity']) {
    const input = ecCycleInputs();
    if (mode === 'balance') input.stocks[0].Stock = 3;
    if (mode === 'negative-stock') input.stocks[0].Stock = -2;
    if (mode === 'null-stock') input.stocks[0].Stock = null;
    if (mode === 'missing-out') input.historicalReceipts[1].OutQuantity = null;
    if (mode === 'invalid-week') input.historicalReceipts.push({ ...input.historicalReceipts[1], OrderWeek: '33-02A' });
    if (mode === 'unknown-type-multiplicity') input.cycleEvidence.adjustments.push({ OrderYear: '2026', OrderWeek: '33-01', ProdKey: 3227, BeforeValue: 2, AfterValue: 2, StockTypeMatches: 2 });
    assert.equal((await calculate(input)).에콰도르.eligible, false, mode);
  }
});

test('missing/foreign/future/same-target zero anchor cannot supply a stock-cycle reset', async () => {
  for (const changed of [[], [zeroSnapshot({ OrderYear: '2025' })], [zeroSnapshot({ OrderWeek: '32-01' })],
    [zeroSnapshot({ OrderWeek: '31-02' })], [zeroSnapshot({ ProdKey: 3240 })], [zeroSnapshot({ Stock: null })]]) {
    const result = await nlCycleResult({ cycleEvidence: cycle({ snapshots: changed }) });
    assert.equal(result.eligible, false);
  }
});

test('canonical master selection does not accept a smaller duplicate zero snapshot', async () => {
  const result = await nlCycleResult({ cycleEvidence: cycle({ snapshots: [zeroSnapshot(),
    zeroSnapshot({ StockKey: 261, Stock: 4, SnapshotRowCount: 101 })] }) });
  assert.equal(result.eligible, false);
});

test('unambiguous legacy conversion is preserved even when extra cycle inputs are invalid', async () => {
  const before = await calculate();
  const after = await calculate({ cycleEvidence: cycle({ snapshots: [], complete: false }) });
  assert.deepEqual(after, before);
});

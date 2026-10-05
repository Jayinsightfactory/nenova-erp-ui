const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const storeModule = require('../lib/weekdayWilsonStore.js');

const scope = { year: 2026, majorWeek: '40', custKey: 533 };
const input = (extra = {}) => ({ ...scope, prodKey: 77, orderWeek: '40-01', date: '2026-10-04',
  unit: '단', expectedTotal: 20, wilsonQuantity: 5, expectedRevision: 0, ...extra });
const raw = (extra = {}) => ({ OrderYear: 2026, OrderWeek: '40-01', CustKey: 533, ProdKey: 77,
  Date: '2026-10-04', OutUnit: 'BUNCH', Unit: '단', Quantity: 20, ProductActive: 1, CustomerMatch: 1, ...extra });

async function temporary(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'weekday-wilson-test-'));
  try { return await run(directory); }
  finally { assert.ok(directory.startsWith(path.join(os.tmpdir(), 'weekday-wilson-test-'))); await fs.rm(directory, { recursive: true, force: true }); }
}

async function fixture(directory, rows = [raw()]) {
  const helper = await import('../lib/weekdayWilson.js');
  const { normalizeWeekdayUnit } = await import('../lib/weekdayEstimateCompare.js');
  const { WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL } = await import('../lib/weekdayCustomerLink.js');
  const source = await fs.readFile(path.resolve(__dirname, '../pages/api/estimate/weekday-wilson.js'), 'utf8');
  const create = new Function('query', 'sql', 'withAuth', 'wilsonStore', 'verifyWeekdayWilsonRecord',
    'normalizeWeekdayUnit', 'WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL',
    source.replace(/^import .*;\r?\n/gm, '').replace(/export const /g, 'const ').replace(/export function /g, 'function ')
      .replace('export default withAuth(createWeekdayWilsonHandler());', '') + '\nreturn createWeekdayWilsonHandler;')(
    () => { throw Error('Real DB forbidden'); }, {}, value => value, storeModule, helper.verifyWeekdayWilsonRecord,
    normalizeWeekdayUnit, WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL);
  const calls = [];
  const store = storeModule.createWeekdayWilsonStore({ directory });
  const queryFn = async (statement, params) => {
    calls.push({ statement, params });
    assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP)\b/i.test(statement));
    if (statement.includes('FROM Customer')) return { recordset: [{ CustKey: 533 }] };
    assert.equal(params.year.value, 2026); assert.equal(params.majorWeek.value, '40'); assert.equal(params.custKey.value, 533);
    assert.ok(statement.includes(WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL));
    return { recordset: rows.filter(row => row.OrderYear === params.year.value
      && row.OrderWeek.slice(0, 2) === params.majorWeek.value && row.CustKey === params.custKey.value) };
  };
  const handler = create({ queryFn, store, types: { Int: 'Int', NVarChar: size => `nvarchar(${size})` } });
  const call = async (method = 'POST', body = input(), user = { userId: 'staff' }) => {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method, body, query: { year: '2026', majorWeek: '40', custKey: '533' }, user }, res);
    return res;
  };
  return { call, store, calls };
}

test('strict classification schema, zero clearing, three-decimal quantities and year identity', () => {
  assert.equal(storeModule.normalizeWilsonInput(input({ wilsonQuantity: 0 })).wilsonQuantity, 0);
  for (const extra of [{ wilsonQuantity: 21 }, { wilsonQuantity: -1 }, { wilsonQuantity: '5' },
    { expectedTotal: 1.0001 }, { date: '2026-02-30' }, { orderWeek: '41-01' }, { expectedRevision: undefined },
    { unit: 'unknown' }, { fakeERP: true }, { prodKey: '../escape' }]) {
    assert.throws(() => storeModule.normalizeWilsonInput(input(extra)));
  }
});

test('atomic persistence, per-day/per-year scope, revisions and exact lost-response retry', async () => temporary(async directory => {
  const store = storeModule.createWeekdayWilsonStore({ directory });
  const saved = await store.save(input(), 'staff');
  assert.equal(saved.revision, 1);
  assert.equal((await store.save(input(), 'staff')).revision, 1, 'lost response retry does not revise');
  await assert.rejects(store.save(input({ wilsonQuantity: 6 }), 'staff'), error => error.code === 'REVISION_CONFLICT');
  await store.save(input({ year: 2025 }), 'staff');
  await store.save(input({ date: '2026-10-03' }), 'staff');
  assert.equal((await store.list(scope)).length, 2);
  assert.equal((await store.list({ ...scope, year: 2025 })).length, 1);
  const cleared = await store.save(input({ wilsonQuantity: 0, expectedRevision: 1 }), 'staff');
  assert.equal(cleared.revision, 2); assert.equal(cleared.wilsonQuantity, 0);
  assert.equal((await store.get(storeModule.normalizeWilsonScope({ ...scope, prodKey: 77, orderWeek: '40-01', date: '2026-10-04' }, { product: true }))).wilsonQuantity, 0);
}));

test('concurrent writers cannot overwrite newer classification; tampered records fail closed', async () => temporary(async directory => {
  const one = storeModule.createWeekdayWilsonStore({ directory });
  const two = storeModule.createWeekdayWilsonStore({ directory });
  const outcomes = await Promise.allSettled([one.save(input(), 'one'), two.save(input({ wilsonQuantity: 6 }), 'two')]);
  assert.equal(outcomes.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(value => value.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const filename = (await fs.readdir(directory)).find(value => value.endsWith('.json'));
  const envelope = JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8'));
  envelope.record.wilsonQuantity = 7;
  await fs.writeFile(path.join(directory, filename), JSON.stringify(envelope));
  await assert.rejects(one.list(scope), error => error.code === 'WILSON_STORAGE_CORRUPT');
}));

test('helper flags ERP change, key ambiguity, missing/invalid sources and cross-year quantities', async () => {
  const { verifyWeekdayWilsonRecord, weekdayWilsonSplit } = await import('../lib/weekdayWilson.js');
  const record = input();
  assert.equal(verifyWeekdayWilsonRecord(record, [raw(), raw({ OrderYear: 2025, Quantity: 99 })]).status, 'CURRENT');
  assert.equal(verifyWeekdayWilsonRecord(record, [raw({ Quantity: 21 })]).status, 'STALE');
  for (const rows of [[], [raw({ Quantity: null })], [raw({ CustomerMatch: 0 })], [raw({ Unit: null })],
    [raw(), raw({ OrderWeek: '40-02' })], [raw({ ProductActive: 0 })]]) {
    assert.equal(verifyWeekdayWilsonRecord(record, rows).status, 'UNVERIFIED');
  }
  assert.equal(weekdayWilsonSplit(20, '단', record, record).general, 15);
  assert.equal(weekdayWilsonSplit(21, '단', record, record).general, null);
});

test('authenticated API saves classification only, retries lost response, and freshly flags stale GET', async () => temporary(async directory => {
  const rows = [raw(), raw({ OrderYear: 2025, Quantity: 1000 })];
  const api = await fixture(directory, rows);
  const saved = await api.call();
  assert.equal(saved.statusCode, 200); assert.equal(saved.body.erpChanged, false);
  assert.equal(saved.body.record.expectedTotal, 20);
  const retry = await api.call();
  assert.equal(retry.body.record.revision, 1);
  assert.equal((await api.call('GET')).body.records[0].status, 'CURRENT');
  rows[0].Quantity = 21;
  assert.equal((await api.call('GET')).body.records[0].status, 'STALE');
  assert.equal((await api.call()).statusCode, 409);
  assert.equal((await api.call('POST', input(), {})).statusCode, 401);
  assert.equal((await api.call('DELETE')).statusCode, 405);
  assert.ok(api.calls.every(value => !/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(value.statement)));
}));

test('API refuses other-year-only, missing date, mixed business weeks, wrong customer and unit sources', async () => {
  for (const rows of [[raw({ OrderYear: 2025 })], [raw({ Date: '2026-10-03' })], [raw(), raw({ OrderWeek: '40-02' })],
    [raw({ CustomerMatch: 0 })], [raw({ OutUnit: 'BOX' })], [raw({ Quantity: null })]]) {
    await temporary(async directory => {
      const api = await fixture(directory, rows);
      const res = await api.call();
      assert.equal(res.statusCode, 409); assert.equal(res.body.code, 'STALE_ERP_TOTAL');
      assert.deepEqual(await api.store.list(scope), []);
    });
  }
});

test('native cancellation may delete dates: explicit clear persists without asserting ERP zero', async () => temporary(async directory => {
  const rows = [raw()];
  const api = await fixture(directory, rows);
  assert.equal((await api.call()).statusCode, 200);
  rows.length = 0; // Native cancellation deleted ShipmentDate rather than creating a fake zero row.
  const cleared = await api.call('POST', input({ expectedTotal: 0, wilsonQuantity: 0, expectedRevision: 1 }));
  assert.equal(cleared.statusCode, 200); assert.equal(cleared.body.erpChanged, false);
  assert.equal(cleared.body.record.status, 'CLEARED'); assert.equal(cleared.body.record.revision, 2);
  assert.equal(Object.hasOwn(cleared.body.record, 'currentTotal'), false, 'absence must not become an ERP zero claim');
  const record = (await api.call('GET')).body.records[0];
  assert.equal(record.status, 'CLEARED');
  rows.push(raw({ Quantity: 30 })); // Future total cannot revive the old Wilson split.
  assert.equal((await api.call('GET')).body.records[0].status, 'CLEARED');
  assert.equal((await api.call('POST', input({ expectedTotal: 0, wilsonQuantity: 0, expectedRevision: 2 }))).statusCode, 409,
    'a new clear POST must not mistake currently positive ERP quantity for absence');
  const { weekdayWilsonSplit, verifyWeekdayWilsonRecord } = await import('../lib/weekdayWilson.js');
  assert.equal(weekdayWilsonSplit(30, '단', record, record).general, 30);
  assert.equal(weekdayWilsonSplit(30, '단', record, record).wilsonQuantity, 0);
  assert.equal(verifyWeekdayWilsonRecord(input(), [raw({ OrderYear: 2025 })]).status, 'UNVERIFIED');
  assert.ok(api.calls.every(call => !/\b(INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i.test(call.statement)));
}));

test('new zero-clear POST requires absence or unambiguous known zero with matching unit', async () => {
  const { verifyWeekdayWilsonRecord } = await import('../lib/weekdayWilson.js');
  const clearing = input({ expectedTotal: 0, wilsonQuantity: 0 });
  assert.equal(verifyWeekdayWilsonRecord(clearing, [raw({ Quantity: 0 })], { forSave: true }).status, 'CLEARED');
  for (const row of [raw({ Quantity: null }), raw({ Quantity: 0, Unit: '박스' }), raw({ Quantity: 0, CustomerMatch: 0 }),
    raw({ Quantity: 0, OrderWeek: '40-02' })]) {
    assert.equal(verifyWeekdayWilsonRecord(clearing, [row], { forSave: true }).status, 'UNVERIFIED');
  }
});

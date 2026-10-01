const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const storeModule = require('../lib/weekdayInitialBaselineStore.js');
const { SOURCE, WeekdayBaselineError, normalizeBaselineScope, canonicalRows, baselineDigest,
  createWeekdayInitialBaselineStore, validateBaselineRecord } = storeModule;
const sqlModulePromise = import('../lib/weekdayInitialBaselineSql.js');
const scope = { year: 2026, orderWeek: '38-02', custKey: 7 };
const allocation = { date: '2026-09-21', orderWeek: '38-02', quantity: 3.5, estimateQuantity: 56 };
const sampleRows = () => [{ prodKey: 101, prodName: 'Alstro', flowerName: '알스트로',
  unit: '단', quantity: 8, estUnit: '송이', shipmentDates: [{ ...allocation }] },
{ prodKey: 102, prodName: 'Order only', flowerName: null, unit: '박스', quantity: 0, estUnit: null, shipmentDates: [] }];
const recordFor = (customScope = scope, rows = sampleRows()) => ({ version: 1, ...customScope,
  source: SOURCE, confirmedAt: '2026-10-01T03:04:05.000Z', confirmedBy: 'tester',
  digest: baselineDigest(customScope, rows), rows });
const dbRows = () => [{ OrderYear: 2026, OrderWeek: '38-02', CustKey: 7,
  ProdKey: 101, ProdName: 'Alstro', FlowerName: '알스트로', OutUnit: 'BUNCH', EstUnit: 'STEM',
  Quantity: 8, DetailRows: 2, InvalidQuantityRows: 0,
  ShipmentDates: JSON.stringify([{ ...allocation, invalidRows: 0 }]) },
{ OrderYear: 2026, OrderWeek: '38-02', CustKey: 7, ProdKey: 102, ProdName: 'Order only',
  FlowerName: null, OutUnit: 'BOX', EstUnit: null, Quantity: 0, DetailRows: 0,
  InvalidQuantityRows: 0, ShipmentDates: '[]' }];
const codeIs = code => error => error instanceof WeekdayBaselineError && error.code === code;

async function temporaryStore(run) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'weekday-initial-baseline-'));
  try { return await run(createWeekdayInitialBaselineStore({ directory }), directory); }
  finally { await fs.promises.rm(directory, { recursive: true, force: true }); }
}

function loadHandler() {
  const filename = path.resolve(__dirname, '../pages/api/estimate/weekday-baseline.js');
  const source = fs.readFileSync(filename, 'utf8')
    .replace(/^import[^\n]+\n/gm, '')
    .replace('export function createWeekdayBaselineHandler', 'function createWeekdayBaselineHandler')
    .replace(/^export default .*$/m, '').replace(/^export const config.*$/m, '');
  return new Function('baselineStore', 'SOURCE', 'WeekdayBaselineError', 'normalizeBaselineScope', 'canonicalRows',
    `${source}\nreturn createWeekdayBaselineHandler;`)(storeModule, SOURCE, WeekdayBaselineError, normalizeBaselineScope, canonicalRows);
}

async function request(handler, { method = 'POST', action = 'preview', body = {}, query = {}, user = { userId: 'tester' } } = {}) {
  const res = { headers: {}, statusCode: null, payload: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; return this; } };
  await handler({ method, body: { ...scope, action, ...body }, query, user }, res);
  return res;
}

test('strict business scope prevents path traversal, omitted defaults and cross-year collisions', () => {
  assert.deepEqual(normalizeBaselineScope({ year: '2026', orderWeek: '38-02', custKey: '7' }), scope);
  for (const bad of [{ year: undefined }, { year: 0 }, { year: true }, { year: [] }, { year: '2026/../2025' },
    { custKey: 0 }, { custKey: -1 }, { custKey: true }, { custKey: 2.5 }, { orderWeek: '../38-02' },
    { orderWeek: '38' }, { orderWeek: ['38-02'] }]) {
    assert.throws(() => normalizeBaselineScope({ ...scope, ...bad }));
  }
  assert.notEqual(baselineDigest(scope, sampleRows()), baselineDigest({ ...scope, year: 2025 }, sampleRows()));
});

test('canonical digest captures dated allocations and distinct quantity units without reconciliation', () => {
  const rows = sampleRows();
  assert.notEqual(rows[0].quantity, rows[0].shipmentDates[0].quantity);
  assert.deepEqual(validateBaselineRecord(recordFor()).rows, rows);
  assert.equal(baselineDigest(scope, rows), baselineDigest(scope, rows.slice().reverse()));
  const changed = structuredClone(rows);
  changed[0].shipmentDates[0].quantity += 0.25;
  assert.notEqual(baselineDigest(scope, rows), baselineDigest(scope, changed));
  changed[0].shipmentDates[0].estimateQuantity += 1;
  assert.notEqual(baselineDigest(scope, rows), baselineDigest(scope, changed));
  changed[0].estUnit = '단';
  assert.notEqual(baselineDigest(scope, rows), baselineDigest(scope, changed));
  rows[0].shipmentDates.push({ ...allocation, date: '2026-09-22' });
  const reversed = structuredClone(rows);
  reversed[0].shipmentDates.reverse();
  assert.equal(baselineDigest(scope, rows), baselineDigest(scope, reversed));
});

test('invalid quantities, units, duplicate products/dates, empty and all-zero confirmation rejected', () => {
  for (const quantity of [null, undefined, '', '8', NaN, Infinity, -0.1]) {
    assert.throws(() => canonicalRows([{ ...sampleRows()[0], quantity }]));
  }
  for (const change of [{ unit: 'kg' }, { prodKey: 0 }, { estUnit: null }, { shipmentDates: null },
    { shipmentDates: [{ ...allocation, date: '2026-02-30' }] },
    { shipmentDates: [{ ...allocation, quantity: -1 }] },
    { shipmentDates: [{ ...allocation, estimateQuantity: null }] },
    { shipmentDates: [{ ...allocation }, { ...allocation }] }]) {
    assert.throws(() => canonicalRows([{ ...sampleRows()[0], ...change }]));
  }
  assert.throws(() => canonicalRows([sampleRows()[0], sampleRows()[0]]));
  assert.throws(() => baselineDigest(scope, [{ ...sampleRows()[0], shipmentDates: [{ ...allocation, orderWeek: '39-01' }] }]));
  assert.throws(() => canonicalRows([], { requirePositive: true }), codeIs('EMPTY_BASELINE'));
  assert.throws(() => canonicalRows([sampleRows()[1]], { requirePositive: true }), codeIs('EMPTY_BASELINE'));
  assert.throws(() => canonicalRows(Array.from({ length: 501 }, (_, i) => ({ ...sampleRows()[1], prodKey: i + 1 }))));
});

test('single SQL helper reads exact inventory and dated quantities; order-only zero is authoritative', async () => {
  const { readWeekdayInitialBaselineSnapshot, WEEKDAY_INITIAL_BASELINE_SQL } = await sqlModulePromise;
  let count = 0;
  const snapshot = await readWeekdayInitialBaselineSnapshot(scope, {
    sql: { Int: 'Int', NVarChar: n => `NVarChar(${n})` },
    query: async (statement, params) => {
      count += 1;
      assert.equal(statement, WEEKDAY_INITIAL_BASELINE_SQL);
      assert.deepEqual(Object.fromEntries(Object.entries(params).map(([key, value]) => [key, value.value])), scope);
      return { recordset: dbRows() };
    },
  });
  assert.equal(count, 1);
  assert.deepEqual(snapshot.rows, sampleRows());
  assert.equal(snapshot.canConfirm, true);
  assert.equal(snapshot.source, SOURCE);
  assert.match(WEEKDAY_INITIAL_BASELINE_SQL, /SUM\(sd\.OutQuantity\)/);
  assert.match(WEEKDAY_INITIAL_BASELINE_SQL, /sd\.CustKey = sm\.CustKey/);
  for (const alias of ['om', 'sm']) {
    assert.match(WEEKDAY_INITIAL_BASELINE_SQL, new RegExp(`${alias}\\.OrderYear = @year AND ${alias}\\.OrderWeek = @orderWeek AND ${alias}\\.CustKey = @custKey`));
  }
  assert.match(WEEKDAY_INITIAL_BASELINE_SQL, /sdd\.SdetailKey = sd\.SdetailKey/);
  assert.doesNotMatch(WEEKDAY_INITIAL_BASELINE_SQL, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC|ALTER|CREATE)\b|sd\.isDeleted|\.isFix|\.Amount|ISNULL\(sd\.OutQuantity/i);
});

test('ERP rowset fails closed for cross-year/customer/week, mixed invalid quantities, bad dates and >500 rows', async () => {
  const { snapshotFromBaselineRowset } = await sqlModulePromise;
  for (const nearMiss of [{ OrderYear: 2025 }, { CustKey: 8 }, { OrderWeek: '38-01' }]) {
    assert.throws(() => snapshotFromBaselineRowset(scope, [{ ...dbRows()[0], ...nearMiss }]), codeIs('ERP_SCOPE_MISMATCH'));
  }
  for (const bad of [{ OutUnit: 'kg' }, { Quantity: null }, { Quantity: '' }, { Quantity: -1 },
    { Quantity: Infinity }, { InvalidQuantityRows: 1 }, { InvalidQuantityRows: null },
    { DetailRows: null }, { DetailRows: 0, Quantity: 1 }]) {
    assert.throws(() => snapshotFromBaselineRowset(scope, [{ ...dbRows()[0], ...bad }]));
  }
  for (const badDate of [{ ...allocation, quantity: null, invalidRows: 1 },
    { ...allocation, quantity: 4, estimateQuantity: -1, invalidRows: 1 },
    { ...allocation, orderWeek: '39-01', invalidRows: 0 }]) {
    assert.throws(() => snapshotFromBaselineRowset(scope, [{ ...dbRows()[0], ShipmentDates: JSON.stringify([badDate]) }]));
  }
  assert.throws(() => snapshotFromBaselineRowset(scope, [{ ...dbRows()[0], ShipmentDates: 'broken' }]), codeIs('INVALID_ERP_DATES'));
  assert.throws(() => snapshotFromBaselineRowset(scope, []), codeIs('CUSTOMER_NOT_ACTIVE'));
  assert.throws(() => snapshotFromBaselineRowset(scope, Array.from({ length: 501 }, () => dbRows()[0])), codeIs('BASELINE_PRODUCT_LIMIT'));
  const empty = snapshotFromBaselineRowset(scope, [{ OrderYear: 2026, OrderWeek: '38-02', CustKey: 7,
    ProdKey: null, ProdName: null, FlowerName: null, OutUnit: null, EstUnit: null,
    Quantity: 0, DetailRows: 0, InvalidQuantityRows: 0, ShipmentDates: '[]' }]);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.canConfirm, false);
  assert.deepEqual(snapshotFromBaselineRowset(scope, [dbRows()[1]]).rows, [sampleRows()[1]]);
});

test('real filesystem capture survives restart and zero/deleted ERP data; scope identities remain independent', async () => temporaryStore(async (store, directory) => {
  assert.equal(await store.get(scope), null);
  assert.deepEqual(await store.list({ ...scope, orderWeeks: ['38-02'] }), []);
  const saved = await store.create(recordFor());
  assert.deepEqual(saved, recordFor());
  const restarted = createWeekdayInitialBaselineStore({ directory });
  assert.deepEqual(await restarted.get(scope), saved);
  const mutable = await restarted.get(scope);
  mutable.rows[0].shipmentDates[0].quantity = 999;
  assert.deepEqual(await restarted.get(scope), saved, 'returned object cannot mutate persistent record');
  for (const identity of [{ year: 2025 }, { custKey: 8 }, { orderWeek: '38-01' }]) {
    const other = { ...scope, ...identity };
    const rows = sampleRows().map(row => ({ ...row, shipmentDates: row.shipmentDates.map(date => ({ ...date, orderWeek: other.orderWeek })) }));
    assert.equal(await store.get(other), null);
    await store.create(recordFor(other, rows));
  }
  assert.equal((await store.list({ year: 2026, custKey: 7, orderWeeks: ['38-02', '38-02', '38-01'] })).length, 2);
  await assert.rejects(store.create(recordFor()), codeIs('BASELINE_ALREADY_CONFIRMED'));
  assert.deepEqual((await fs.promises.readdir(directory)).filter(name => name.endsWith('.tmp')), []);
}));

test('independent store instances race with exactly one immutable first confirmation', async () => temporaryStore(async (store, directory) => {
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => createWeekdayInitialBaselineStore({ directory }).create(recordFor())));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  for (const result of results.filter(result => result.status === 'rejected')) assert.equal(result.reason.code, 'BASELINE_ALREADY_CONFIRMED');
  assert.deepEqual(await store.get(scope), recordFor());
  assert.equal((await fs.promises.readdir(directory)).length, 1);
}));

test('hardlink publication arbitrates actual concurrent child processes', async () => temporaryStore(async (store, directory) => {
  const modulePath = path.resolve(__dirname, '../lib/weekdayInitialBaselineStore.js');
  const script = `const {createWeekdayInitialBaselineStore}=require(process.argv[1]);
    createWeekdayInitialBaselineStore({directory:process.argv[2]}).create(JSON.parse(process.argv[3]))
    .then(()=>process.stdout.write('CREATED')).catch(e=>{process.stdout.write(e.code || 'ERROR');if(e.code!=='BASELINE_ALREADY_CONFIRMED')process.exitCode=1;});`;
  const run = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, modulePath, directory, JSON.stringify(recordFor())], { windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout)));
  });
  const results = await Promise.all(Array.from({ length: 4 }, run));
  assert.equal(results.filter(result => result === 'CREATED').length, 1);
  assert.equal(results.filter(result => result === 'BASELINE_ALREADY_CONFIRMED').length, 3);
  assert.deepEqual(await store.get(scope), recordFor());
}));

test('invalid stored record or scope mismatch fails closed and never overwrites corruption', async () => temporaryStore(async (store, directory) => {
  await store.create(recordFor());
  const filename = path.join(directory, '2026_38-02_7.json');
  for (const corrupt of ['{broken', JSON.stringify({ ...recordFor(), version: 2 }),
    JSON.stringify({ ...recordFor(), digest: 'f'.repeat(64) }),
    JSON.stringify({ ...recordFor(), source: 'BROWSER_DRAFT' }),
    JSON.stringify(recordFor({ ...scope, year: 2025 })),
    JSON.stringify({ ...recordFor(), confirmedBy: '' }),
    JSON.stringify({ ...recordFor(), confirmedAt: 'invalid' })]) {
    await fs.promises.writeFile(filename, corrupt);
    await assert.rejects(store.get(scope), codeIs('BASELINE_STORAGE_CORRUPT'));
    await assert.rejects(store.create(recordFor()), codeIs('BASELINE_STORAGE_CORRUPT'));
    assert.equal(await fs.promises.readFile(filename, 'utf8'), corrupt);
  }
  await assert.rejects(store.get({ ...scope, orderWeek: '../escape' }), codeIs('INVALID_WEEK'));
}));

test('storage publication failure leaves no baseline or temporary file, retry remains possible', async () => temporaryStore(async (store, directory) => {
  const broken = createWeekdayInitialBaselineStore({ directory, io: { ...fs.promises,
    link: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } } });
  await assert.rejects(broken.create(recordFor()), codeIs('BASELINE_STORAGE_FAILED'));
  assert.equal(await store.get(scope), null);
  assert.deepEqual(await fs.promises.readdir(directory), []);
  await store.create(recordFor());
}));

test('post-publication read verifies disk contents and rejects corruption without replacing the target', async () => temporaryStore(async (store, directory) => {
  const corrupting = createWeekdayInitialBaselineStore({ directory, io: { ...fs.promises,
    link: async (from, to) => { await fs.promises.link(from, to); await fs.promises.writeFile(to, '{}'); } } });
  await assert.rejects(corrupting.create(recordFor()), codeIs('BASELINE_STORAGE_CORRUPT'));
  await assert.rejects(store.create(recordFor()), codeIs('BASELINE_STORAGE_CORRUPT'));
  assert.deepEqual(await fs.promises.readdir(directory), ['2026_38-02_7.json']);
}));

test('invalid record and oversize stored file are rejected without ghost defaults', async () => temporaryStore(async (store, directory) => {
  for (const record of [{ ...recordFor(), version: 2 }, { ...recordFor(), confirmedAt: null },
    { ...recordFor(), confirmedBy: null }, { ...recordFor(), source: 'BROWSER_DRAFT' },
    { ...recordFor(), rows: [] }, { ...recordFor(), rows: [{ ...sampleRows()[0], quantity: null }] }]) {
    await assert.rejects(store.create(record));
  }
  assert.deepEqual(await fs.promises.readdir(directory), []);
  await fs.promises.writeFile(path.join(directory, '2026_38-02_7.json'), ' '.repeat(storeModule.MAX_FILE_BYTES + 1));
  await assert.rejects(store.get(scope), codeIs('BASELINE_STORAGE_CORRUPT'));
}));

test('API frozen contract captures ERP only, returns dated baseline and GET never probes ERP', async () => temporaryStore(async (store) => {
  const { snapshotFromBaselineRowset } = await sqlModulePromise;
  let reads = 0;
  const handler = loadHandler()({ store, now: () => new Date('2026-10-01T03:04:05.000Z'),
    readSnapshot: async input => { reads += 1; return snapshotFromBaselineRowset(input, dbRows()); } });
  const preview = await request(handler, { body: { rows: [{ quantity: 999 }], source: 'BROWSER_DRAFT' } });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(preview.payload, { success: true, readOnly: true,
    preview: { ...scope, digest: recordFor().digest, rows: sampleRows() } });
  const confirm = await request(handler, { action: 'confirm', body: { expectedDigest: preview.payload.preview.digest, quantity: 999 } });
  assert.equal(confirm.statusCode, 201);
  assert.deepEqual(confirm.payload, { success: true, baseline: recordFor(), erpChanged: false });
  assert.equal(reads, 2);
  const get = await request(handler, { method: 'GET', query: { year: '2026', custKey: '7', orderWeeks: '38-02,38-01' } });
  assert.deepEqual(get.payload, { success: true, readOnly: true, baselines: [recordFor()] });
  assert.equal(reads, 2);
  const duplicate = await request(handler, { action: 'confirm', body: { expectedDigest: 'f'.repeat(64) } });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.payload.code, 'BASELINE_ALREADY_CONFIRMED');
  assert.equal(reads, 2, 'existing baseline remains immutable even if ERP unavailable');
  assert.equal(get.headers['Cache-Control'], 'no-store');
}));

test('API date-only change makes preview stale while OutQuantity remains unchanged', async () => temporaryStore(async (store) => {
  const { snapshotFromBaselineRowset } = await sqlModulePromise;
  let rows = dbRows();
  const handler = loadHandler()({ store, readSnapshot: async input => snapshotFromBaselineRowset(input, rows) });
  const preview = await request(handler);
  rows[0].ShipmentDates = JSON.stringify([{ ...allocation, quantity: 4, invalidRows: 0 }]);
  const stale = await request(handler, { action: 'confirm', body: { expectedDigest: preview.payload.preview.digest } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.payload.code, 'BASELINE_STALE_PREVIEW');
  assert.equal(await store.get(scope), null);
  rows = dbRows(); rows[0].Quantity = 9;
  assert.equal((await request(handler, { action: 'confirm', body: { expectedDigest: preview.payload.preview.digest } })).payload.code, 'BASELINE_STALE_PREVIEW');
}));

test('API missing user, invalid action/method/digest/scope, empty/all-zero and failed reads cannot confirm', async () => temporaryStore(async (store) => {
  const { snapshotFromBaselineRowset } = await sqlModulePromise;
  let reads = 0;
  let rows = [dbRows()[1]];
  const handler = loadHandler()({ store, readSnapshot: async input => { reads += 1; return snapshotFromBaselineRowset(input, rows); } });
  assert.equal((await request(handler, { user: undefined })).statusCode, 200, 'request harness default authenticated user');
  assert.equal((await request(handler, { user: null })).statusCode, 401);
  assert.equal((await request(handler, { action: 'erase' })).statusCode, 400);
  assert.equal((await request(handler, { method: 'DELETE' })).statusCode, 405);
  assert.equal((await request(handler, { body: { year: undefined } })).statusCode, 400);
  assert.equal((await request(handler, { action: 'confirm' })).payload.code, 'INVALID_EXPECTED_DIGEST');
  const zero = await request(handler);
  assert.equal((await request(handler, { action: 'confirm', body: { expectedDigest: zero.payload.preview.digest } })).payload.code, 'EMPTY_BASELINE');
  rows = [];
  assert.equal((await request(handler)).payload.code, 'CUSTOMER_NOT_ACTIVE');
  const failed = loadHandler()({ store, readSnapshot: async () => { throw new Error('offline'); } });
  assert.equal((await request(failed)).payload.code, 'BASELINE_READ_FAILED');
  assert.equal(await store.get(scope), null);
  assert.ok(reads > 0);
}));

test('API storage failures/corruption remain failures; module does not read credentials at import time', async () => temporaryStore(async (store, directory) => {
  const { snapshotFromBaselineRowset } = await sqlModulePromise;
  const brokenStore = { ...store, create: async () => { throw new WeekdayBaselineError('BASELINE_STORAGE_FAILED', 'failed', 500); } };
  const handler = loadHandler()({ store: brokenStore, readSnapshot: async input => snapshotFromBaselineRowset(input, dbRows()) });
  assert.equal((await request(handler, { action: 'confirm', body: { expectedDigest: recordFor().digest } })).payload.code, 'BASELINE_STORAGE_FAILED');
  await store.create(recordFor());
  await fs.promises.writeFile(path.join(directory, '2026_38-02_7.json'), '{}');
  assert.equal((await request(handler, { method: 'GET', query: { ...scope, orderWeeks: '38-02' } })).payload.code, 'BASELINE_STORAGE_CORRUPT');
  const source = fs.readFileSync(path.resolve(__dirname, '../pages/api/estimate/weekday-baseline.js'), 'utf8');
  assert.match(source, /export default withAuth\(createWeekdayBaselineHandler\(\)\)/);
  assert.doesNotMatch(source, /^import .*lib\/db|process\.env/gm);
}));

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const notes = require('../lib/weekdayPageNoteStore.js');

const root = path.resolve(__dirname, '..');
const identity = { year: 2026, majorWeek: '38', custKey: 7, prodKey: 101 };
const scope = { year: 2026, majorWeek: '38', custKey: 7 };
const early = { date: '2026-09-20', sourceYear: 2026, sourceOrderWeek: '39-01',
  quantity: 2.5, unit: '박스', confirmation: 'MANUAL_USER_DECLARATION' };
const input = (changes = {}) => ({ ...identity, note: '담당자 확인', earlyShipment: null, expectedRevision: 0, ...changes });
const code = expected => error => error instanceof notes.WeekdayPageNoteError && error.code === expected;

async function temporary(run) {
  const directory = await fs.promises.mkdtemp(path.join(__dirname, '.weekday-note-test-'));
  try { await run(directory); }
  finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(__dirname)}${path.sep}.weekday-note-test-`));
    await fs.promises.rm(resolved, { recursive: true, force: true });
  }
}

async function child(directory, payload) {
  return new Promise((resolve, reject) => {
    const process = spawn(global.process.execPath,
      [__filename, '--note-child', directory, Buffer.from(JSON.stringify(payload)).toString('base64')],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    process.stdout.on('data', chunk => { out += chunk; });
    process.stderr.on('data', chunk => { err += chunk; });
    process.on('error', reject);
    process.on('exit', status => status === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
  });
}

function periods(year = 2026, major = 38, anchor = '2026-09-17') {
  const days = [5, 6, 7, 1, 2, 3, 4];
  const rows = [];
  for (let i = -7; i < 14; i++) {
    const day = ((i % 7) + 7) % 7;
    const date = new Date(`${anchor}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    const week = major + Math.floor(i / 7) + (day >= 4 ? 1 : 0);
    rows.push({ BaseYmd: date.toISOString().slice(0, 10), WeekDay: days[day], OrderYearWeek: `${year}${String(week).padStart(2, '0')}` });
  }
  return rows;
}

async function apiFixture(directory, overrides = {}) {
  const { buildShippingCycles } = await import('../lib/weekdayEstimateCycle.js');
  const { normalizeWeekdayUnit } = await import('../lib/weekdayEstimateCompare.js');
  const { WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL } = await import('../lib/weekdayCustomerLink.js');
  const source = await fs.promises.readFile(path.join(root, 'pages/api/estimate/weekday-note.js'), 'utf8');
  const factory = new Function('query', 'sql', 'withAuth', 'pageNoteStore', 'baselineStore', 'buildShippingCycles', 'normalizeWeekdayUnit', 'WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL',
    source.replace(/^import .*;\r?\n/gm, '').replace(/export const /g, 'const ')
      .replace(/export function /g, 'function ').replace('export default withAuth(createWeekdayNoteHandler());', '')
      + '\nreturn createWeekdayNoteHandler;')(
    () => { throw new Error('Real DB forbidden'); }, {}, handler => handler, notes, {}, buildShippingCycles,
    normalizeWeekdayUnit, WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL);
  const calls = [];
  const baselineCalls = [];
  const queryFn = async (statement, params) => {
    calls.push({ statement, params });
    assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP)\b/i.test(statement));
    if (statement.includes('SELECT CustKey FROM Customer')) return { recordset: overrides.customer ?? [{ CustKey: 7 }] };
    if (statement.includes('FROM Product p')) {
      assert.equal(params.year.value, 2026);
      assert.equal(params.majorWeek.value, '38');
      assert.equal(params.custKey.value, 7);
      assert.equal(params.prodKey.value, 101);
      const fixtures = overrides.erpRows ?? [{ year: 2026, majorWeek: '38', custKey: 7, prodKey: 101 }];
      const matches = fixtures.some(row => row.year === params.year.value && row.majorWeek === params.majorWeek.value
        && row.custKey === params.custKey.value && row.prodKey === params.prodKey.value);
      return { recordset: overrides.product ?? [{ ProdKey: 101, OutUnit: 'BOX', InScope: matches ? 1 : 0 }] };
    }
    if (statement.includes('SUM(sdd.ShipmentQuantity)')) {
      assert.equal(params.year.value, 2026); assert.equal(params.majorWeek.value, '38');
      assert.equal(params.custKey.value, 7); assert.equal(params.prodKey.value, 101);
      assert.equal(typeof params.destinationDate.value, 'string');
      assert.match(statement, /sd\.CustKey=sm\.CustKey/);
      assert.ok(statement.includes(WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL));
      assert.match(statement, /CONVERT\(date,sdd\.ShipmentDtm\)=CONVERT\(date,@destinationDate,23\)/);
      const fixtures = overrides.dateRows ?? [{ ...identity, date: params.destinationDate.value, quantity: 3.5 }];
      const rows = fixtures.filter(row => row.year === params.year.value && row.majorWeek === params.majorWeek.value
        && row.custKey === params.custKey.value && row.prodKey === params.prodKey.value && row.date === params.destinationDate.value);
      return { recordset: overrides.dateResult ?? [{ DateRows: rows.length,
        ShipmentQuantity: rows.length ? rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0) : null,
        InvalidQuantityRows: rows.length ? rows.filter(row => row.quantity == null || row.quantity < 0
          || row.detailCustKey != null && Number(row.detailCustKey) !== row.custKey).length : null }] };
    }
    if (statement.includes('FROM PeriodDay')) {
      const key = params.yearWeek.value;
      return { recordset: overrides.calendar?.[key] ?? (key === '202638' || key === '202639' ? periods() : []) };
    }
    throw new Error('Unexpected query');
  };
  const store = notes.createWeekdayPageNoteStore({ directory });
  const handler = factory({ queryFn, types: { Int: 'Int', NVarChar: size => `nvarchar(${size})` }, store,
    baselines: overrides.baselines ?? { get: async value => { baselineCalls.push(value); return overrides.baseline ?? null; } } });
  const call = async (body = input(), method = 'POST', user = { userId: 'staff' }, query = { year: '2026', majorWeek: '38', custKey: '7' }) => {
    const res = { headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key] = value; },
      status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method, body, query, user }, res);
    return res;
  };
  return { call, calls, baselineCalls, store, source };
}

if (process.argv[2] === '--note-child') {
  notes.createWeekdayPageNoteStore({ directory: process.argv[3] })
    .save(JSON.parse(Buffer.from(process.argv[4], 'base64').toString()), 'child')
    .then(record => process.stdout.write(JSON.stringify({ revision: record.revision })))
    .catch(error => process.stdout.write(JSON.stringify({ code: error.code })));
} else {
  test('strict input: no coercion, unknown fields, traversal, invalid dates or silent defaults', () => {
    assert.equal(notes.normalizeNoteInput(input({ note: '', expectedRevision: 0 })).note, '');
    assert.deepEqual(notes.normalizeNoteScope({ year: '2026', majorWeek: '38', custKey: '7' }, { query: true }), scope);
    const bad = [
      { year: 0 }, { year: false }, { year: '2026' }, { year: 2026.5 }, { year: 1999 },
      { majorWeek: '../38' }, { majorWeek: '3' }, { majorWeek: '00' }, { majorWeek: '54' },
      { custKey: false }, { custKey: 0 }, { custKey: [] }, { prodKey: '../101' }, { prodKey: 2147483648 },
      { expectedRevision: false }, { expectedRevision: '0' }, { expectedRevision: -1 }, { expectedRevision: 0.1 },
      { expectedRevision: Number.MAX_SAFE_INTEGER }, { note: false }, { note: null }, { note: 'x'.repeat(1001) },
      { note: '\0' }, { earlyShipment: false }, { earlyShipment: undefined }, { updatedBy: 'spoof' },
    ];
    for (const change of bad) assert.throws(() => notes.normalizeNoteInput(input(change)), notes.WeekdayPageNoteError);
    for (const field of Object.keys(input())) {
      const value = input(); delete value[field]; assert.throws(() => notes.normalizeNoteInput(value));
    }
    for (const change of [{ date: '2026-02-30' }, { date: '2026-09-20/../' }, { quantity: 0 },
      { quantity: false }, { quantity: '2' }, { quantity: Infinity }, { quantity: NaN }, { quantity: -1 },
      { sourceYear: '2026' }, { sourceYear: 0 }, { sourceOrderWeek: '54-01' }, { sourceOrderWeek: '39-00' },
      { sourceOrderWeek: '../39-01' }, { unit: 'BOX' }, { confirmation: true }, { allocation: 'ERP' }]) {
      assert.throws(() => notes.normalizeNoteInput(input({ earlyShipment: { ...early, ...change } })));
    }
    for (const query of [{ ...scope, year: ['2026'] }, { ...scope, year: '0002026' }, { ...scope, custKey: false },
      { ...scope, filePath: '../../' }]) assert.throws(() => notes.normalizeNoteScope(query, { query: true }));
  });

  test('persistent CAS, restart, clearing and repeated clearing retain audit revisions', async () => temporary(async directory => {
    let timestamp = 0;
    const store = notes.createWeekdayPageNoteStore({ directory, now: () => new Date(1780000000000 + timestamp++) });
    const first = await store.save(input({ earlyShipment: early }), 'staff');
    assert.equal(first.revision, 1);
    assert.equal(first.updatedBy, 'staff');
    assert.deepEqual(first.earlyShipment, early);
    assert.deepEqual(await notes.createWeekdayPageNoteStore({ directory }).get(identity), first);
    await assert.rejects(store.save(input(), 'staff'), code('REVISION_CONFLICT'));
    await assert.rejects(store.save(input({ expectedRevision: 2 }), 'staff'), code('REVISION_CONFLICT'));
    const cleared = await store.save(input({ note: '', expectedRevision: 1 }), 'staff2');
    const repeated = await store.save(input({ note: '', expectedRevision: 2 }), 'staff3');
    assert.equal(cleared.revision, 2); assert.equal(repeated.revision, 3);
    assert.equal(repeated.note, ''); assert.equal(repeated.earlyShipment, null);
    assert.equal(repeated.updatedBy, 'staff3'); assert.notEqual(cleared.updatedAt, repeated.updatedAt);
    for (const user of ['', false, undefined, ' staff', 'bad\0']) await assert.rejects(store.save(input(), user), code('UNAUTHENTICATED'));
    assert.equal((await store.get(identity)).revision, 3);
  }));

  test('same identity list is deterministic and isolated by year, customer, major and product', async () => temporary(async directory => {
    const store = notes.createWeekdayPageNoteStore({ directory });
    assert.deepEqual(await store.list(scope), []);
    for (const change of [{}, { prodKey: 2 }, { year: 2025 }, { custKey: 70 }, { majorWeek: '39' }]) await store.save(input(change), 'staff');
    assert.deepEqual((await store.list(scope)).map(row => row.prodKey), [2, 101]);
    assert.equal((await store.list({ ...scope, year: 2025 })).length, 1);
    assert.equal(await store.get({ ...identity, prodKey: 3 }), null);
  }));

  test('concurrent same-process stores and cross-process writers enforce exactly one CAS winner', async () => temporary(async directory => {
    const writers = Array.from({ length: 8 }, () => notes.createWeekdayPageNoteStore({ directory }));
    const first = await Promise.allSettled(writers.map(store => store.save(input(), 'staff')));
    assert.equal(first.filter(item => item.status === 'fulfilled').length, 1);
    assert.ok(first.filter(item => item.status === 'rejected').every(item => item.reason.code === 'REVISION_CONFLICT'));
    const second = await Promise.all(Array.from({ length: 6 }, () => child(directory, input({ expectedRevision: 1 }))));
    assert.equal(second.filter(item => item.revision === 2).length, 1);
    assert.equal(second.filter(item => item.code === 'REVISION_CONFLICT').length, 5);
    assert.equal((await writers[0].get(identity)).revision, 2);
    assert.deepEqual(await fs.promises.readdir(directory), ['2026_38_7_101.json']);
  }));

  test('existing wx lock is never stolen; timeout does not remove another writer lock', async () => temporary(async directory => {
    const lock = path.join(directory, '2026_38_7_101.json.lock');
    await fs.promises.writeFile(lock, 'existing-owner', { flag: 'wx' });
    const store = notes.createWeekdayPageNoteStore({ directory, lockTimeoutMs: 25, lockRetryMs: 5 });
    await assert.rejects(store.save(input(), 'staff'), code('NOTE_LOCKED'));
    assert.equal(await fs.promises.readFile(lock, 'utf8'), 'existing-owner');
    assert.equal(await store.get(identity), null);
  }));

  test('corruption, digest tampering, identity swap and oversized files fail closed', async () => temporary(async directory => {
    const store = notes.createWeekdayPageNoteStore({ directory });
    await store.save(input(), 'staff');
    const file = path.join(directory, '2026_38_7_101.json');
    const original = await fs.promises.readFile(file, 'utf8');
    const changed = JSON.parse(original); changed.record.note = 'tampered';
    const swapped = JSON.parse(original); swapped.record.year = 2025; swapped.digest = notes.noteDigest(swapped.record);
    const missing = JSON.parse(original); delete missing.record.earlyShipment;
    for (const text of ['{broken', JSON.stringify(changed), JSON.stringify(swapped), JSON.stringify(missing), 'x'.repeat(notes.MAX_FILE_BYTES + 1)]) {
      await fs.promises.writeFile(file, text);
      await assert.rejects(store.get(identity), code('NOTE_STORAGE_CORRUPT'));
      await assert.rejects(store.list(scope), code('NOTE_STORAGE_CORRUPT'));
      await assert.rejects(store.save(input({ expectedRevision: 1 }), 'staff'), code('NOTE_STORAGE_CORRUPT'));
      assert.equal(await fs.promises.readFile(file, 'utf8'), text);
    }
    await fs.promises.writeFile(file, original);
    const symlinkIO = { ...fs.promises, lstat: async value => value === file
      ? { isFile: () => true, isSymbolicLink: () => true, size: 10 } : fs.promises.lstat(value) };
    await assert.rejects(notes.createWeekdayPageNoteStore({ directory, io: symlinkIO }).get(identity), code('NOTE_STORAGE_CORRUPT'));
  }));

  test('atomic publication failure preserves prior bytes and cleans own temp/lock', async () => temporary(async directory => {
    const store = notes.createWeekdayPageNoteStore({ directory });
    const prior = await store.save(input(), 'staff');
    const io = { ...fs.promises, rename: async () => { throw Object.assign(new Error('injected failure'), { code: 'EIO' }); } };
    await assert.rejects(notes.createWeekdayPageNoteStore({ directory, io }).save(input({ expectedRevision: 1, note: 'new' }), 'staff'), code('NOTE_STORAGE_FAILED'));
    assert.deepEqual(await store.get(identity), prior);
    assert.deepEqual(await fs.promises.readdir(directory), ['2026_38_7_101.json']);
  }));

  test('authenticated API exact GET/POST contract and conflict response; all SQL SELECT-only', async () => temporary(async directory => {
    const api = await apiFixture(directory);
    assert.match(api.source, /export default withAuth\(createWeekdayNoteHandler\(\)\)/);
    const beforeAuth = api.calls.length;
    assert.equal((await api.call(input(), 'POST', null)).statusCode, 401);
    assert.equal((await api.call(input(), 'POST', { userId: 'staff', accountActive: false })).statusCode, 401);
    assert.equal(api.calls.length, beforeAuth, 'unauthenticated requests do not touch DB or files');
    const saved = await api.call();
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(Object.keys(saved.body).sort(), ['erpChanged', 'note', 'success']);
    assert.equal(saved.body.erpChanged, false);
    assert.equal(saved.body.note.updatedBy, 'staff');
    const get = await api.call(null, 'GET');
    assert.deepEqual(get.body, { success: true, notes: [saved.body.note], readOnly: true });
    assert.equal(get.headers['Cache-Control'], 'no-store');
    const stale = await api.call(); assert.equal(stale.statusCode, 409);
    assert.equal(stale.body.code, 'REVISION_CONFLICT'); assert.equal(stale.body.currentRevision, saved.body.note.revision);
    const method = await api.call(null, 'DELETE'); assert.equal(method.statusCode, 405);
    assert.equal(method.headers.Allow, 'GET, POST');
    const before = api.calls.length;
    assert.equal((await api.call(input({ expectedRevision: false }))).statusCode, 400);
    assert.equal(api.calls.length, before);
  }));

  test('existing withAuth wrapper rejects missing/expired tokens before handler execution', async () => {
    const authSource = await fs.promises.readFile(path.join(root, 'lib/auth.js'), 'utf8');
    const start = authSource.indexOf('export function withAuth(handler)');
    const end = authSource.indexOf('// getServerSideProps', start);
    const withAuth = new Function('jwt', 'getJwtSecret', 'trackApiCall', 'applyEffectiveWebAccess',
      authSource.slice(start, end).replace('export function', 'function') + '\nreturn withAuth;')(
      { verify: token => { if (token !== 'fixture-valid') throw new Error('invalid'); return { userId: 'verified-user' }; } },
      () => 'test-only-fixture', () => {}, user => user);
    let handled = 0;
    const authenticated = withAuth(async (req, res) => { handled++; return res.status(200).json({ userId: req.user.userId }); });
    for (const [headers, expected] of [[{}, 401], [{ authorization: 'Bearer fixture-expired' }, 401],
      [{ authorization: 'Bearer fixture-valid' }, 200]]) {
      const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; },
        status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
      await authenticated({ headers, url: '/api/estimate/weekday-note' }, res);
      assert.equal(res.statusCode, expected);
      if (expected === 200) assert.equal(res.body.userId, 'verified-user');
    }
    assert.equal(handled, 1);
  });

  test('baseline-only notes use actual validated immutable get export; corrupt baseline fails closed', async () => temporary(async directory => {
    const baselineModule = require('../lib/weekdayInitialBaselineStore.js');
    const baselines = baselineModule.createWeekdayInitialBaselineStore({ directory: path.join(directory, 'baselines') });
    const baselineScope = { year: 2026, orderWeek: '38-01', custKey: 7 };
    const rows = [{ prodKey: 101, prodName: 'Original', flowerName: null, unit: '박스', quantity: 3.5,
      estUnit: '박스', shipmentDates: [{ date: early.date, orderWeek: '38-01', quantity: 3.5, estimateQuantity: 3.5 }] }];
    await baselines.create({ version: 1, ...baselineScope, source: baselineModule.SOURCE, rows,
      confirmedBy: 'staff', confirmedAt: '2026-10-01T03:00:00.000Z', digest: baselineModule.baselineDigest(baselineScope, rows) });
    const api = await apiFixture(directory, { erpRows: [], baselines });
    assert.equal((await api.call()).statusCode, 200);
    await fs.promises.writeFile(path.join(directory, 'baselines', '2026_38-01_7.json'), '{}');
    const denied = await api.call(input({ expectedRevision: 1 }));
    assert.equal(denied.statusCode, 500); assert.equal(denied.body.code, 'BASELINE_STORAGE_CORRUPT');
    assert.equal((await api.store.get(identity)).revision, 1);
  }));

  test('API requires active Customer/Product and scoped ERP record or validated baseline only', async () => temporary(async directory => {
    for (const overrides of [{ customer: [] }, { product: [] }, { erpRows: [{ ...identity, year: 2025 }] },
      { erpRows: [{ ...identity, custKey: 8 }] }, { erpRows: [{ ...identity, majorWeek: '39' }] },
      { erpRows: [{ ...identity, prodKey: 102 }] }]) {
      const api = await apiFixture(directory, overrides);
      assert.equal((await api.call()).statusCode, 404);
      assert.equal(await api.store.get(identity), null);
    }
    const api = await apiFixture(directory, { erpRows: [], baseline: { year: 2026, orderWeek: '38-01', custKey: 7, rows: [{ prodKey: 101 }] } });
    assert.equal((await api.call()).statusCode, 200);
    assert.deepEqual(api.baselineCalls, [
      { year: 2026, orderWeek: '38-01', custKey: 7 }, { year: 2026, orderWeek: '38-02', custKey: 7 }]);
    const wrong = await apiFixture(directory, { erpRows: [], baseline: { year: 2025, orderWeek: '38-01', custKey: 7, rows: [{ prodKey: 101 }] } });
    assert.equal((await wrong.call(input({ expectedRevision: 1 }))).statusCode, 404, 'existing note is not ERP/baseline scope proof');
    const inactive = await apiFixture(directory, { product: [], baseline: { year: 2026, orderWeek: '38-01', custKey: 7, rows: [{ prodKey: 101 }] } });
    assert.equal((await inactive.call(input({ expectedRevision: 1 }))).statusCode, 404,
      'baseline cannot bypass active Product validation');
  }));

  test('manual early source39/delivery38 is preserved; earlier/equal source is rejected by actual destination subweek', async () => temporary(async directory => {
    const api = await apiFixture(directory);
    const saved = await api.call(input({ earlyShipment: early }));
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.body.note.earlyShipment, early);
    assert.equal('allocation' in saved.body.note, false);
    for (const patch of [{ sourceOrderWeek: '37-02' }, { sourceOrderWeek: '38-01' }, { sourceYear: 2025 },
      { date: '2026-09-21', sourceOrderWeek: '38-02' }, { date: '2026-09-21', sourceOrderWeek: '38-01' }]) {
      const result = await api.call(input({ earlyShipment: { ...early, ...patch }, expectedRevision: 1 }));
      assert.equal(result.statusCode, 400); assert.equal(result.body.code, 'NOT_FUTURE_SOURCE');
    }
    assert.equal((await api.call(input({ earlyShipment: { ...early, sourceOrderWeek: '38-02' }, expectedRevision: 1 }))).statusCode, 200,
      'same-major later subweek is a future declaration, not automatic allocation');
  }));

  test('calendar absence/duplication/missing day blocks with NEEDS_REDESIGN, outside-cycle date rejects', async () => temporary(async directory => {
    for (const calendar of [{ '202638': [] }, { '202638': [...periods(), periods()[7]] },
      { '202638': periods().filter(row => row.BaseYmd !== '2026-09-21') }, { '202639': [] }]) {
      const api = await apiFixture(directory, { calendar });
      const result = await api.call(input({ earlyShipment: early }));
      assert.equal(result.statusCode, 409); assert.equal(result.body.code, 'NEEDS_REDESIGN');
      assert.equal(await api.store.get(identity), null);
    }
    const api = await apiFixture(directory);
    const result = await api.call(input({ earlyShipment: { ...early, date: '2026-09-24' } }));
    assert.equal(result.statusCode, 400); assert.equal(result.body.code, 'INVALID_EARLY_DATE');
  }));

  test('early source full subweek must exist in selected/source calendar days; 39-99 fails closed', async () => temporary(async directory => {
    const api = await apiFixture(directory);
    for (const sourceOrderWeek of ['39-99', '39-03', '38-99']) {
      const result = await api.call(input({ earlyShipment: { ...early, sourceOrderWeek } }));
      assert.equal(result.statusCode, 400);
      assert.equal(result.body.code, 'INVALID_EARLY_SOURCE_WEEK');
      assert.equal(await api.store.get(identity), null, 'invalid source suffix never publishes a note');
    }
    assert.equal(api.calls.some(call => call.statement.includes('SUM(sdd.ShipmentQuantity)')), false,
      'full source-week verification precedes destination quantity validation');
    const sameMajor = await api.call(input({ earlyShipment: { ...early, sourceOrderWeek: '38-02' } }));
    assert.equal(sameMajor.statusCode, 200);
    assert.equal(sameMajor.body.note.earlyShipment.sourceOrderWeek, '38-02');
    const nextMajor = await api.call(input({ earlyShipment: early, expectedRevision: 1 }));
    assert.equal(nextMajor.statusCode, 200);
    assert.equal(nextMajor.body.note.earlyShipment.sourceOrderWeek, '39-01');
  }));

  test('early unit must match normalized authoritative Product.OutUnit (unknown unit fails)', async () => temporary(async directory => {
    for (const [outUnit, unit] of [['BOX', '박스'], ['Bunch', '단'], ['STEM', '송이']]) {
      const api = await apiFixture(directory, { product: [{ ProdKey: 101, InScope: 1, OutUnit: outUnit }] });
      const current = await api.store.get(identity);
      const result = await api.call(input({ earlyShipment: { ...early, unit }, expectedRevision: current?.revision ?? 0 }));
      assert.equal(result.statusCode, 200); assert.equal(result.body.note.earlyShipment.unit, unit);
    }
    for (const outUnit of ['단', null, '', 'mystery']) {
      const api = await apiFixture(directory, { product: [{ ProdKey: 101, InScope: 1, OutUnit: outUnit }] });
      const result = await api.call(input({ earlyShipment: early, expectedRevision: 3 }));
      assert.equal(result.statusCode, 400); assert.equal(result.body.code, 'EARLY_UNIT_MISMATCH');
      assert.equal(api.calls.some(call => call.statement.includes('SUM(sdd.ShipmentQuantity)')), false);
    }
  }));

  test('early amount uses only actual saved date quantity, rejects zero/null/missing/over and cross-identity near misses', async () => temporary(async directory => {
    const positive = await apiFixture(directory, { dateRows: [
      { ...identity, date: early.date, quantity: 1 }, { ...identity, date: early.date, quantity: 1.5 },
      { ...identity, year: 2025, date: early.date, quantity: 999 },
    ] });
    const ok = await positive.call(input({ earlyShipment: early }));
    assert.equal(ok.statusCode, 200, 'exact saved total is allowed');
    const nativeNull = await apiFixture(path.join(directory, 'native-null'), { dateResult: [{ DateRows: 1, ShipmentQuantity: 2.5, InvalidQuantityRows: 0 }] });
    assert.equal((await nativeNull.call(input({ earlyShipment: early }))).statusCode, 200,
      'native NULL detail customer remains valid saved date quantity');
    for (const detailCustKey of [0, 8]) {
      const wrongLink = await apiFixture(path.join(directory, `wrong-${detailCustKey}`), { dateResult: [{ DateRows: 1, ShipmentQuantity: 2.5, InvalidQuantityRows: 1 }] });
      const rejected = await wrongLink.call(input({ earlyShipment: early }));
      assert.equal(rejected.statusCode, 409);
      assert.equal(rejected.body.code, 'EARLY_DATE_QUANTITY_UNVERIFIED');
    }
    for (const dateRows of [[], [{ ...identity, date: early.date, quantity: 0 }],
      [{ ...identity, date: early.date, quantity: null }], [{ ...identity, date: early.date, quantity: -1 }],
      [{ ...identity, year: 2025, date: early.date, quantity: 100 }],
      [{ ...identity, majorWeek: '39', date: early.date, quantity: 100 }],
      [{ ...identity, custKey: 8, date: early.date, quantity: 100 }],
      [{ ...identity, prodKey: 102, date: early.date, quantity: 100 }],
      [{ ...identity, date: '2026-09-21', quantity: 100 }]]) {
      const api = await apiFixture(directory, { dateRows });
      const result = await api.call(input({ earlyShipment: early, expectedRevision: 1 }));
      assert.equal(result.statusCode, 409); assert.equal(result.body.code, 'EARLY_DATE_QUANTITY_UNVERIFIED');
      assert.equal((await api.store.get(identity)).revision, 1);
    }
    const over = await apiFixture(directory, { dateRows: [{ ...identity, date: early.date, quantity: 2.49 }] });
    const denied = await over.call(input({ earlyShipment: early, expectedRevision: 1 }));
    assert.equal(denied.statusCode, 400); assert.equal(denied.body.code, 'EARLY_QUANTITY_EXCEEDS_SAVED');
    for (const quantity of [null, undefined, '', false, NaN, Infinity]) {
      const api = await apiFixture(directory, { dateResult: [{ DateRows: 1, ShipmentQuantity: quantity, InvalidQuantityRows: 0 }] });
      const result = await api.call(input({ earlyShipment: early, expectedRevision: 1 }));
      assert.equal(result.body.code, 'EARLY_DATE_QUANTITY_UNVERIFIED');
    }
    const numeric = await apiFixture(directory, { dateResult: [{ DateRows: '2', ShipmentQuantity: '2.500', InvalidQuantityRows: '0' }] });
    assert.equal((await numeric.call(input({ earlyShipment: early, expectedRevision: 1 }))).statusCode, 200);
    const baselineOnly = await apiFixture(directory, { erpRows: [], dateRows: [],
      baseline: { year: 2026, orderWeek: '38-01', custKey: 7, rows: [{ prodKey: 101 }] } });
    assert.equal((await baselineOnly.call(input({ earlyShipment: early, expectedRevision: 2 }))).body.code, 'EARLY_DATE_QUANTITY_UNVERIFIED',
      'baseline-only cancelled products may have notes but not fake positive early shipment');
  }));

  test('cross-year future source requires real next-year calendar and preserves identity year', async () => temporary(async directory => {
    const api = await apiFixture(directory, { calendar: { '202701': periods(2027, 1, '2027-01-07') } });
    const value = { ...early, sourceYear: 2027, sourceOrderWeek: '01-01' };
    const result = await api.call(input({ earlyShipment: value }));
    assert.equal(result.statusCode, 200); assert.equal(result.body.note.year, 2026);
    assert.equal(result.body.note.earlyShipment.sourceYear, 2027);
    const missing = await apiFixture(directory);
    const denied = await missing.call(input({ earlyShipment: value, expectedRevision: 1 }));
    assert.equal(denied.body.code, 'NEEDS_REDESIGN');
  }));
}

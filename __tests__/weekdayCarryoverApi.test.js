const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const carries = require('../lib/weekdayCarryoverStore.js');
const baselineModule = require('../lib/weekdayInitialBaselineStore.js');
const root = path.resolve(__dirname, '..');
const selected = { year: 2026, majorWeek: '38', custKey: 7 };
const identity = { ...selected, prodKey: 101 };
const payload = (patch = {}) => ({ ...identity, unit: '박스', quantity: 5, reason: '수동 마감 확인', expectedRevision: 0, ...patch });
const queryScope = { year: '2026', majorWeek: '38', custKey: '7' };
const product = (key = 101, unit = 'BOX') => ({ ProdKey: key, ProdName: `Product ${key}`, FlowerName: null, OutUnit: unit });

async function temporary(run) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'weekday-carryover-api-test-'));
  try { await run(directory); }
  finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(`${path.resolve(os.tmpdir())}${path.sep}weekday-carryover-api-test-`));
    await fs.promises.rm(resolved, { recursive: true, force: true });
  }
}

function periods(cycles = [
  { year: 2026, majorWeek: '37', startDate: '2026-09-10' },
  { year: 2026, majorWeek: '38', startDate: '2026-09-17' },
  { year: 2026, majorWeek: '39', startDate: '2026-09-24' },
]) {
  return cycles.flatMap((cycle, index) => Array.from({ length: 7 }, (_, day) => {
    const date = new Date(`${cycle.startDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + day);
    const next = cycles[index + 1] ?? { year: cycle.year, majorWeek: String(Number(cycle.majorWeek) + 1).padStart(2, '0') };
    const key = day >= 4 ? next : cycle;
    return { BaseYmd: `${date.toISOString().slice(0, 10)} 00:00:00.000`, WeekDay: [5, 6, 7, 1, 2, 3, 4][day],
      OrderYearWeek: `${key.year}${key.majorWeek}` };
  }));
}

function erpRow(patch = {}) {
  const orderWeek = patch.OrderWeek ?? '38-01';
  const amount = patch.Quantity ?? 8;
  return { OrderYear: 2026, majorWeek: orderWeek.slice(0, 2), OrderWeek: orderWeek, CustKey: 7,
    ...product(), Quantity: amount, DetailRows: 1, InvalidQuantityRows: 0,
    ShipmentDates: JSON.stringify([{ date: '2026-09-17', orderWeek, quantity: amount, invalidRows: 0 }]), ...patch };
}

function baseline(year = 2026, week = '38-01', key = 101, quantity = 10, unit = '박스') {
  return { year, orderWeek: week, custKey: 7, rows: [{ prodKey: key, prodName: `Original ${key}`,
    flowerName: null, quantity, unit, estUnit: unit, shipmentDates: [] }] };
}

async function fixture(directory, overrides = {}) {
  const { buildShippingCycles, dateKey, shiftDate } = await import('../lib/weekdayEstimateCycle.js');
  const { normalizeWeekdayUnit } = await import('../lib/weekdayEstimateCompare.js');
  const source = await fs.promises.readFile(path.join(root, 'pages/api/estimate/weekday-carryover.js'), 'utf8');
  const factory = new Function('query', 'sql', 'withAuth', 'carryoverStore', 'baselineStore', 'buildShippingCycles', 'dateKey', 'shiftDate', 'normalizeWeekdayUnit',
    source.replace(/^import .*;\r?\n/gm, '').replace(/export const /g, 'const ').replace(/export function /g, 'function ')
      .replace('export default withAuth(createWeekdayCarryoverHandler());', '') + '\nreturn createWeekdayCarryoverHandler;')(
    () => { throw new Error('Actual DB/network forbidden in fixture'); }, {}, handler => handler, carries, baselineModule,
    buildShippingCycles, dateKey, shiftDate, normalizeWeekdayUnit);
  const calls = [], baselineCalls = [];
  const activeProducts = overrides.products ?? [product(), product(102), product(103)];
  const store = overrides.store ?? carries.createWeekdayCarryoverStore({ directory: path.join(directory, 'carries') });
  const rawPeriods = overrides.periods ?? periods();
  const rows = overrides.erpRows ?? [erpRow()];
  const queryFn = async (statement, bindings) => {
    calls.push({ statement, bindings });
    assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(statement), 'all SQL is SELECT-only');
    if (statement.includes('SELECT CustKey FROM Customer')) return { recordset: overrides.customer ?? [{ CustKey: bindings.custKey.value }] };
    if (statement.includes('AS InScope')) {
      const p = activeProducts.find(item => item.ProdKey === bindings.prodKey.value);
      const eligible = rows.some(row => row.OrderYear === bindings.year.value && row.majorWeek === bindings.majorWeek.value
        && row.CustKey === bindings.custKey.value && row.ProdKey === bindings.prodKey.value);
      return { recordset: overrides.productScope ?? (p ? [{ ...p, InScope: eligible ? 1 : 0 }] : []) };
    }
    if (statement.includes('JOIN OPENJSON(@prodKeys)')) {
      const keys = JSON.parse(bindings.prodKeys.value);
      return { recordset: activeProducts.filter(item => keys.includes(item.ProdKey)) };
    }
    if (statement.includes('FROM PeriodDay')) {
      if (bindings.yearWeek) {
        const anchors = rawPeriods.filter(row => String(row.OrderYearWeek) === bindings.yearWeek.value && row.WeekDay === 5);
        return { recordset: rawPeriods.filter(row => anchors.some(anchor => {
          const diff = (Date.parse(row.BaseYmd.replace(' ', 'T') + 'Z') - Date.parse(anchor.BaseYmd.replace(' ', 'T') + 'Z')) / 86400000;
          return diff >= -7 && diff < 14;
        })) };
      }
      return { recordset: rawPeriods.filter(row => row.BaseYmd.slice(0, 10) >= bindings.firstDate.value
        && row.BaseYmd.slice(0, 10) < bindings.afterLastDate.value) };
    }
    if (statement.includes('WITH cycles AS')) {
      const cycles = JSON.parse(bindings.cycles.value);
      const result = cycles.flatMap(cycle => {
        const matches = rows.filter(row => row.OrderYear === cycle.year && row.majorWeek === cycle.majorWeek
          && row.CustKey === bindings.custKey.value && activeProducts.some(item => item.ProdKey === row.ProdKey));
        return matches.length ? matches : [{ OrderYear: cycle.year, majorWeek: cycle.majorWeek, CustKey: bindings.custKey.value,
          OrderWeek: null, ProdKey: null, ProdName: null, FlowerName: null, OutUnit: null,
          Quantity: 0, DetailRows: 0, InvalidQuantityRows: 0, ShipmentDates: '[]' }];
      });
      return { recordset: overrides.bulkTransform ? overrides.bulkTransform(result, bindings) : result };
    }
    throw new Error('Unexpected fixture query');
  };
  const handler = factory({ queryFn, types: { Int: 'int', MAX: 'max', NVarChar: size => `nvarchar(${size})` }, store,
    baselines: overrides.baselines ?? { get: async scope => {
      baselineCalls.push(scope);
      return (overrides.snapshots ?? []).find(item => item.year === scope.year && item.orderWeek === scope.orderWeek && item.custKey === scope.custKey) ?? null;
    } } });
  const call = async (method = 'GET', body = payload(), user = { userId: 'staff' }, query = queryScope) => {
    const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; } };
    await handler({ method, body, user, query }, res);
    return res;
  };
  return { call, calls, baselineCalls, store, source };
}

test('exact authenticated GET/POST schema, no auth/scope I/O and explicit current revision conflict', async () => temporary(async directory => {
  const api = await fixture(directory);
  assert.match(api.source, /export default withAuth\(createWeekdayCarryoverHandler\(\)\)/);
  for (const user of [null, {}, { userId: 'staff', accountActive: false }]) assert.equal((await api.call('POST', payload(), user)).statusCode, 401);
  for (const body of [payload({ startDate: '2025-01-02' }), payload({ expectedRevision: false }), payload({ quantity: null })]) {
    assert.equal((await api.call('POST', body)).statusCode, 400);
  }
  assert.equal((await api.call('GET', null, { userId: 'staff' }, { ...queryScope, prodKey: '101' })).statusCode, 400);
  assert.equal(api.calls.length, 0);
  const saved = await api.call('POST');
  assert.equal(saved.statusCode, 200); assert.deepEqual(Object.keys(saved.body).sort(), ['erpChanged', 'record', 'success']);
  assert.equal(saved.body.erpChanged, false); assert.equal(saved.body.record.startDate, '2026-09-17');
  assert.equal(saved.body.record.updatedBy, 'staff');
  const stale = await api.call('POST');
  assert.equal(stale.statusCode, 409); assert.equal(stale.body.code, 'REVISION_CONFLICT'); assert.equal(stale.body.currentRevision, 1);
  const get = await api.call();
  assert.equal(get.statusCode, 200); assert.deepEqual(Object.keys(get.body).sort(), ['context', 'readOnly', 'records', 'success']);
  assert.equal(get.body.context.custKey, 7); assert.equal(get.body.readOnly, true);
  assert.deepEqual(get.body.records, [saved.body.record]);
  assert.ok(get.body.context.inputs.every(input => input.custKey === 7));
  assert.equal(get.headers['Cache-Control'], 'no-store');
  const unsupported = await api.call('DELETE'); assert.equal(unsupported.statusCode, 405); assert.equal(unsupported.headers.Allow, 'GET, POST');
}));

test('no manual seed reads exactly visible three cycles and GET creates no runtime files', async () => temporary(async directory => {
  const api = await fixture(directory);
  const response = await api.call(); assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.context.cycles.map(cycle => cycle.majorWeek), ['37', '38', '39']);
  assert.deepEqual(response.body.records, []);
  const middle = response.body.context.inputs.find(input => input.majorWeek === '38');
  assert.equal(middle.basis, 8); assert.equal(middle.allocated, 8); assert.equal(middle.provisional, true); assert.equal(middle.valid, true);
  assert.ok(response.body.context.inputs.every(input => input.unit === '박스'));
  assert.equal(api.calls.filter(call => call.statement.includes('WITH cycles AS')).length, 1);
  assert.equal(api.calls.filter(call => call.bindings.firstDate).length, 0);
  assert.deepEqual(await fs.promises.readdir(directory), []);
}));

test('manual 37 closing5, baseline38=10/allocated8,39=4/allocated3; explicit 0/negative are preserved', async () => temporary(async directory => {
  const { buildWeekdayCarryoverLedger } = await import('../lib/weekdayCarryover.js');
  const api = await fixture(directory, { snapshots: [baseline(2026, '38-01', 101, 10), baseline(2026, '39-01', 101, 4)],
    erpRows: [erpRow(), erpRow({ OrderWeek: '39-01', Quantity: 3,
      ShipmentDates: JSON.stringify([{ date: '2026-09-24', orderWeek: '39-01', quantity: 3, invalidRows: 0 }]) })] });
  await api.store.save(payload({ majorWeek: '37' }), 'staff', { startDate: '2026-09-10' });
  const result = await api.call(); assert.equal(result.statusCode, 200);
  const inputs = result.body.context.inputs;
  assert.equal(inputs.find(input => input.majorWeek === '38').basis, 10);
  assert.equal(inputs.find(input => input.majorWeek === '38').allocated, 8);
  assert.equal(inputs.find(input => input.majorWeek === '39').basis, 4);
  assert.equal(inputs.find(input => input.majorWeek === '39').allocated, 3);
  assert.equal(result.body.records[0].quantity, 5);
  const ledger = buildWeekdayCarryoverLedger(result.body.context, result.body.records);
  assert.equal(ledger.get('2026|37|101').closing, 5);
  assert.equal(ledger.get('2026|38|101').closing, 7);
  assert.equal(ledger.get('2026|39|101').closing, 8);
  for (const [quantity, expectedRevision] of [[0, 1], [-2, 2]]) {
    await api.store.save(payload({ majorWeek: '37', quantity, expectedRevision }), 'staff', { startDate: '2026-09-10' });
    assert.equal((await api.call()).body.records[0].quantity, quantity);
  }
}));

test('per-product latest prior seed chooses earliest relevant anchor; stale old/future/inactive records do not extend range', async () => temporary(async directory => {
  const cycles = Array.from({ length: 11 }, (_, index) => {
    const date = new Date('2026-07-16T00:00:00Z'); date.setUTCDate(date.getUTCDate() + 7 * index);
    return { year: 2026, majorWeek: String(29 + index).padStart(2, '0'), startDate: date.toISOString().slice(0, 10) };
  });
  const api = await fixture(directory, { periods: periods(cycles) });
  for (const [majorWeek, prodKey, startDate] of [['01', 101, '2020-01-02'], ['35', 101, '2026-08-27'],
    ['36', 101, '2026-09-03'], ['34', 102, '2026-08-20'], ['40', 103, '2026-10-01'], ['02', 999, '2020-01-09']]) {
    await api.store.save(payload({ majorWeek, prodKey }), 'staff', { startDate });
  }
  const result = await api.call(); assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.context.cycles.map(cycle => cycle.majorWeek), ['34', '35', '36', '37', '38', '39']);
  assert.deepEqual(result.body.records.map(record => `${record.majorWeek}/${record.prodKey}`), ['34/102', '35/101', '36/101']);
  assert.equal(api.calls.find(call => call.bindings.firstDate).bindings.firstDate.value, '2026-08-20');
  assert.equal(api.calls.filter(call => call.statement.includes('WITH cycles AS')).length, 1);
  assert.equal(result.body.context.inputs.some(input => input.prodKey === 999 || input.prodKey === 103), false);
}));

test('manual/baseline-only products remain visible with active current Product metadata; inactive products excluded', async () => temporary(async directory => {
  const api = await fixture(directory, { erpRows: [], products: [product(101), product(102, 'BUNCH')],
    snapshots: [baseline(2026, '38-01', 102, 10, '단'), baseline(2026, '38-01', 999, 20)] });
  // Combine baseline rows so the same immutable scope has one record.
  const snapshots = [baseline(2026, '38-01', 102, 10, '단')]; snapshots[0].rows.push(baseline(2026, '38-01', 999, 20).rows[0]);
  const actual = await fixture(directory, { erpRows: [], products: [product(101), product(102, 'BUNCH')], snapshots, store: api.store });
  await actual.store.save(payload({ quantity: 0 }), 'staff', { startDate: '2026-09-17' });
  const result = await actual.call(); assert.equal(result.statusCode, 200);
  assert.deepEqual([...new Set(result.body.context.inputs.map(input => input.prodKey))], [101, 102]);
  const manual = result.body.context.inputs.find(input => input.prodKey === 101 && input.majorWeek === '38');
  assert.equal(manual.basis, 0); assert.equal(manual.allocated, 0); assert.equal(manual.prodName, 'Product 101');
  const historical = result.body.context.inputs.find(input => input.prodKey === 102 && input.majorWeek === '38');
  assert.equal(historical.basis, 10); assert.equal(historical.unit, '단'); assert.equal(historical.prodName, 'Product 102');
  assert.equal(result.body.records[0].quantity, 0);
}));

test('baseline priority is per suffix, missing suffix uses unconfirmed ERP preview, explicit absence is zero', async () => temporary(async directory => {
  const api = await fixture(directory, { snapshots: [baseline(2026, '38-01', 101, 10)], erpRows: [erpRow(),
    erpRow({ OrderWeek: '38-02', Quantity: 2,
      ShipmentDates: JSON.stringify([{ date: '2026-09-21', orderWeek: '38-02', quantity: 2, invalidRows: 0 }]) })] });
  const result = await api.call(); assert.equal(result.statusCode, 200);
  const value = result.body.context.inputs.find(input => input.majorWeek === '38');
  assert.equal(value.basis, 12); assert.equal(value.allocated, 10); assert.equal(value.provisional, true);
  const empty = await fixture(directory, { erpRows: [], snapshots: [baseline(2026, '38-01', 101, 10), baseline(2026, '38-02', 102, 1)] });
  const zero = (await empty.call()).body.context.inputs.find(input => input.prodKey === 101 && input.majorWeek === '38');
  assert.equal(zero.basis, 10); assert.equal(zero.allocated, 0); assert.equal(zero.provisional, false);
}));

test('negative/null/unknown units and malformed/outside/mismatched dates produce explicit invalid/null context', async () => temporary(async directory => {
  const bad = [
    [{ Quantity: null }, 'INVALID_ERP_QUANTITY'], [{ Quantity: -1 }, 'INVALID_ERP_QUANTITY'],
    [{ Quantity: false }, 'INVALID_ERP_QUANTITY'], [{ InvalidQuantityRows: 1 }, 'INVALID_ERP_QUANTITY'],
    [{ DetailRows: null }, 'INVALID_ERP_QUANTITY'], [{ DetailRows: 0 }, 'INVALID_ERP_QUANTITY'],
    [{ OutUnit: 'unknown' }, 'UNKNOWN_UNIT'], [{ ShipmentDates: 'null' }, 'INVALID_ERP_DATES'],
    [{ ShipmentDates: '{}' }, 'INVALID_ERP_DATES'], [{ ShipmentDates: '{broken' }, 'INVALID_ERP_DATES'],
    [{ ShipmentDates: '[]' }, 'ERP_DATE_TOTAL_MISMATCH'],
    [{ ShipmentDates: JSON.stringify([{ date: '2026-09-24', orderWeek: '38-01', quantity: 8, invalidRows: 0 }]) }, 'DATE_OUTSIDE_CYCLE'],
    [{ ShipmentDates: JSON.stringify([{ date: '2026-09-17', orderWeek: '37-01', quantity: 8, invalidRows: 0 }]) }, 'INVALID_ERP_DATES'],
    [{ ShipmentDates: JSON.stringify([{ date: '2026-02-30', orderWeek: '38-01', quantity: 8, invalidRows: 0 }]) }, 'INVALID_ERP_DATES'],
    [{ ShipmentDates: JSON.stringify([{ date: '2026-09-17', orderWeek: '38-01', quantity: -8, invalidRows: 0 }]) }, 'INVALID_ERP_DATES'],
    [{ ShipmentDates: JSON.stringify([{ date: '2026-09-17', orderWeek: '38-01', quantity: 8, invalidRows: 1 }]) }, 'INVALID_ERP_DATES'],
    [{ OrderWeek: '38-03' }, 'UNSUPPORTED_SUBWEEK'],
  ];
  for (const [patch, expected] of bad) {
    const row = erpRow(patch);
    const api = await fixture(directory, { erpRows: [row], products: [product(101, row.OutUnit)] });
    const result = await api.call(); assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    const value = result.body.context.inputs.find(input => input.majorWeek === '38');
    assert.equal(value.valid, false, expected); assert.equal(value.basis, null); assert.equal(value.allocated, null);
    assert.ok(value.error.includes(expected), value.error);
  }
  const mismatch = await fixture(directory, { snapshots: [baseline(2026, '38-01', 101, 10, '단')] });
  assert.match((await mismatch.call()).body.context.inputs.find(input => input.majorWeek === '38').error, /BASELINE_UNIT_MISMATCH/);
}));

test('GET rejects failed/incomplete/scoped-inconsistent SELECT and file adapter errors instead of missing-zero fallback', async () => temporary(async directory => {
  for (const transform of [() => [], result => result.filter(row => row.majorWeek !== '37'),
    result => result.map(row => ({ ...row, CustKey: 8 })), result => result.map(row => ({ ...row, OrderYear: 2025 })),
    result => [...result, result.find(row => row.ProdKey !== null)],
    result => [...result, { ...result.find(row => row.ProdKey === null), majorWeek: '38' }],
    result => result.map(row => row.ProdKey === null ? { ...row, Quantity: null } : row)]) {
    const api = await fixture(directory, { bulkTransform: transform });
    assert.equal((await api.call()).statusCode, 409);
  }
  const corrupt = await fixture(directory, { baselines: { get: async () => { throw new baselineModule.WeekdayBaselineError('BASELINE_STORAGE_CORRUPT', 'broken', 500); } } });
  assert.equal((await corrupt.call()).body.code, 'BASELINE_STORAGE_CORRUPT');
  const missingQuery = await fixture(directory, { bulkTransform: () => { throw new Error('failed SELECT'); } });
  assert.equal((await missingQuery.call()).statusCode, 500);
  const crossCustomer = await fixture(directory, { store: { listCustomer: async () => [{
    ...await carries.createWeekdayCarryoverStore({ directory: path.join(directory, 'foreign') }).save(payload({ custKey: 8 }), 'staff', { startDate: '2026-09-17' }),
  }] } });
  assert.equal((await crossCustomer.call()).body.code, 'CARRYOVER_SCOPE_MISMATCH');
}));

test('explicit ERP zero and order-only/no-date absence remain valid zeros without inventing a manual seed', async () => temporary(async directory => {
  const { buildWeekdayCarryoverLedger } = await import('../lib/weekdayCarryover.js');
  for (const row of [erpRow({ Quantity: 0, ShipmentDates: '[]' }), erpRow({ Quantity: 0, DetailRows: 0, ShipmentDates: '[]' }),
    erpRow({ Quantity: 0, ShipmentDates: JSON.stringify([{ date: '2026-09-17', orderWeek: '38-01', quantity: 0, invalidRows: 0 }]) })]) {
    const api = await fixture(directory, { erpRows: [row] });
    const result = await api.call(); assert.equal(result.statusCode, 200);
    const value = result.body.context.inputs.find(input => input.majorWeek === '38');
    assert.equal(value.basis, 0); assert.equal(value.allocated, 0); assert.equal(value.valid, true);
    const ledger = buildWeekdayCarryoverLedger(result.body.context, result.body.records);
    assert.equal(ledger.get('2026|38|101').active, false);
  }
}));

test('exact 104-cycle context is accepted in one bulk read; 105 cycles fail without silent cutoff', async () => temporary(async directory => {
  const cycles = Array.from({ length: 105 }, (_, index) => {
    const date = new Date('2024-01-04T00:00:00Z'); date.setUTCDate(date.getUTCDate() + index * 7);
    return { year: 2024 + Math.floor(index / 52), majorWeek: String(index % 52 + 1).padStart(2, '0'), startDate: date.toISOString().slice(0, 10) };
  });
  const center = cycles[103];
  const api = await fixture(directory, { periods: periods(cycles), erpRows: [] });
  await api.store.save(payload({ year: cycles[1].year, majorWeek: cycles[1].majorWeek }), 'staff', { startDate: cycles[1].startDate });
  const scope = { year: String(center.year), majorWeek: center.majorWeek, custKey: '7' };
  const accepted = await api.call('GET', null, { userId: 'staff' }, scope);
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body)); assert.equal(accepted.body.context.cycles.length, 104);
  assert.equal(api.calls.filter(call => call.statement.includes('WITH cycles AS')).length, 1);
  const other = await fixture(directory, { periods: periods(cycles), erpRows: [],
    store: carries.createWeekdayCarryoverStore({ directory: path.join(directory, 'over-limit') }) });
  await other.store.save(payload({ year: cycles[0].year, majorWeek: cycles[0].majorWeek }), 'staff', { startDate: cycles[0].startDate });
  assert.equal((await other.call('GET', null, { userId: 'staff' }, scope)).body.code, 'CARRYOVER_CONTEXT_LIMIT');
  assert.equal(other.calls.some(call => call.statement.includes('WITH cycles AS')), false);
}));

test('calendar unique Thursday, full seven actual contiguous weekdays and historical gaps fail closed', async () => temporary(async directory => {
  const original = periods();
  for (const rows of [[], original.filter(row => row.BaseYmd.slice(0, 10) !== '2026-09-21'),
    [...original, original[7]], [...original, original[8]],
    original.map((row, index) => index === 8 ? { ...row, WeekDay: 7 } : row)]) {
    const api = await fixture(directory, { periods: rows });
    const result = await api.call(); assert.equal(result.statusCode, 409); assert.equal(result.body.code, 'INVALID_CALENDAR');
  }
  const cycles = [{ year: 2026, majorWeek: '35', startDate: '2026-08-27' },
    { year: 2026, majorWeek: '36', startDate: '2026-09-03' },
    { year: 2026, majorWeek: '37', startDate: '2026-09-10' },
    { year: 2026, majorWeek: '38', startDate: '2026-09-17' }, { year: 2026, majorWeek: '39', startDate: '2026-09-24' }];
  const api = await fixture(directory, { periods: periods(cycles).filter(row => row.BaseYmd.slice(0, 10) !== '2026-09-05') });
  await api.store.save(payload({ majorWeek: '35' }), 'staff', { startDate: '2026-08-27' });
  assert.equal((await api.call()).body.code, 'INVALID_CALENDAR');
}));

test('104-week bound rejects earliest necessary seed without truncation; future manual records ignored', async () => temporary(async directory => {
  const api = await fixture(directory);
  await api.store.save(payload({ year: 2020, majorWeek: '01' }), 'staff', { startDate: '2020-01-02' });
  const result = await api.call(); assert.equal(result.statusCode, 409); assert.equal(result.body.code, 'CARRYOVER_CONTEXT_LIMIT');
  assert.equal(api.calls.some(call => call.statement.includes('WITH cycles AS')), false);
  const future = await fixture(directory, { store: carries.createWeekdayCarryoverStore({ directory: path.join(directory, 'future') }) });
  await future.store.save(payload({ majorWeek: '40' }), 'staff', { startDate: '2026-10-01' });
  const ignored = await future.call(); assert.equal(ignored.statusCode, 200); assert.deepEqual(ignored.body.records, []);
  assert.equal(ignored.body.context.cycles.length, 3);
}));

test('cross-year actual PeriodDay identities retained; prior-year same major never leaks into scoped ERP source', async () => temporary(async directory => {
  const api = await fixture(directory, { erpRows: [erpRow(), erpRow({ OrderYear: 2025, Quantity: 999 })] });
  assert.equal((await api.call()).body.context.inputs.find(input => input.majorWeek === '38').basis, 8);
  const cycles = [{ year: 2026, majorWeek: '52', startDate: '2026-12-24' },
    { year: 2026, majorWeek: '53', startDate: '2026-12-31' }, { year: 2027, majorWeek: '01', startDate: '2027-01-07' }];
  const cross = await fixture(directory, { periods: periods(cycles), erpRows: [], snapshots: [baseline(2027, '01-01', 101, 4)] });
  await cross.store.save(payload({ majorWeek: '52' }), 'staff', { startDate: '2026-12-24' });
  const result = await cross.call('GET', null, { userId: 'staff' }, { ...queryScope, majorWeek: '53' });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.context.cycles.map(cycle => `${cycle.year}/${cycle.majorWeek}`), ['2026/52', '2026/53', '2027/01']);
  assert.equal(result.body.context.inputs.find(input => input.year === 2027).basis, 4);
}));

test('POST eligibility requires active customer/product/current unit, year+major+customer ERP or baseline only', async () => temporary(async directory => {
  for (const overrides of [{ customer: [] }, { products: [] }, { products: [product(101, 'unknown')] },
    { products: [product(101, 'BUNCH')] }, { erpRows: [] }, { erpRows: [erpRow({ OrderYear: 2025 })] },
    { erpRows: [erpRow({ OrderWeek: '39-01' })] }, { erpRows: [erpRow({ CustKey: 8 })] },
    { erpRows: [erpRow({ ProdKey: 102 })] }]) {
    const api = await fixture(directory, overrides);
    const result = await api.call('POST'); assert.ok([400, 404].includes(result.statusCode), JSON.stringify(result.body));
    assert.equal(await api.store.get(identity), null);
  }
  const api = await fixture(directory, { erpRows: [], snapshots: [baseline()] });
  assert.equal((await api.call('POST', payload({ quantity: 0 }))).statusCode, 200);
  const noScope = await fixture(directory, { erpRows: [], store: api.store });
  const denied = await noScope.call('POST', payload({ expectedRevision: 1 }));
  assert.equal(denied.statusCode, 404); assert.equal(denied.body.code, 'PRODUCT_OUT_OF_SCOPE');
  assert.equal((await api.store.get(identity)).quantity, 0, 'existing manual cannot authorize later POST scope');
  const inactive = await fixture(directory, { erpRows: [], products: [], snapshots: [baseline()], store: api.store });
  assert.equal((await inactive.call('POST', payload({ expectedRevision: 1 }))).body.code, 'INACTIVE_PRODUCT');
}));

test('real immutable baseline reader corrupt file rejects baseline-only POST before carryover save', async () => temporary(async directory => {
  const baselines = baselineModule.createWeekdayInitialBaselineStore({ directory: path.join(directory, 'baselines') });
  const record = baseline();
  await baselines.create({ version: 1, ...record, source: baselineModule.SOURCE, confirmedAt: '2026-10-01T03:00:00.000Z',
    confirmedBy: 'staff', digest: baselineModule.baselineDigest(record, record.rows) });
  const api = await fixture(directory, { baselines, erpRows: [] });
  assert.equal((await api.call('POST', payload({ quantity: -1 }))).statusCode, 200);
  await fs.promises.writeFile(path.join(directory, 'baselines', '2026_38-01_7.json'), '{}');
  const result = await api.call('POST', payload({ expectedRevision: 1 }));
  assert.equal(result.statusCode, 500); assert.equal(result.body.code, 'BASELINE_STORAGE_CORRUPT');
  assert.equal((await api.store.get(identity)).revision, 1);
}));

test('bulk SQL has customer/year/week scope, active filters, no sd.isDeleted, no N+1/DDL/truncation', async () => temporary(async directory => {
  const api = await fixture(directory);
  await api.call();
  const bulk = api.calls.find(call => call.statement.includes('WITH cycles AS'));
  assert.ok(bulk); assert.equal(bulk.bindings.custKey.value, 7);
  assert.deepEqual(JSON.parse(bulk.bindings.cycles.value), [{ year: 2026, majorWeek: '37' }, { year: 2026, majorWeek: '38' }, { year: 2026, majorWeek: '39' }]);
  assert.match(bulk.statement, /om\.OrderYear=c\.\[year\]/); assert.match(bulk.statement, /sm\.OrderYear=c\.\[year\]/);
  assert.match(bulk.statement, /sd\.CustKey=sm\.CustKey/); assert.match(bulk.statement, /ISNULL\(od\.isDeleted,0\)=0/);
  assert.match(bulk.statement, /ISNULL\(p\.isDeleted,0\)=0/); assert.match(bulk.statement, /FOR JSON PATH,INCLUDE_NULL_VALUES/);
  assert.doesNotMatch(bulk.statement, /\bTOP\b|sd\.isDeleted|ISNULL\(sd\.OutQuantity|ISNULL\(sdd\.ShipmentQuantity/);
  assert.equal(api.calls.filter(call => call.statement.includes('WITH cycles AS')).length, 1);
  assert.equal(api.baselineCalls.length, 6);
}));

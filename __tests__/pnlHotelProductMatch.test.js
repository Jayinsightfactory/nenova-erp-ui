const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');

function compileModule(filename, mocks = {}) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = transformSync(source, {
    filename,
    jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  }).code;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = request => (Object.prototype.hasOwnProperty.call(mocks, request) ? mocks[request] : originalRequire(request));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const hotel = 'hotel_012345abcdef';
const other = 'hotel_abcdef012345';
const stateApi = compileModule(path.join(root, 'lib/shillaPnlProductMatchState.js'));
const pureMatch = compileModule(path.join(root, 'lib/shillaPnlHotelMatch.js'));
const row = (key, partnerCode = hotel, orderYear = '2026', prodKey = null) => ({
  ItemKey: key, PnlKey: key + 100, MajorWeek: 12, PartnerCode: partnerCode, OrderYear: orderYear,
  ItemName: '장미', Unit: '단', Qty: 2, SalePrice: 3000, SaleAmount: 6000, IsCustom: 0, ProdKey: prodKey,
});
function harness() {
  const state = { rows: [row(1), row(2), row(3, other), row(4, hotel, '2025')], calls: [], active: true, fail: false, inactiveProduct: false };
  const sql = new Proxy({}, { get: (_, key) => key });
  const run = async (statement, params = {}) => {
    state.calls.push({ statement, params });
    if (!/sp_getapplock/.test(statement)) {
      for (const [, name] of statement.matchAll(/@([A-Za-z][A-Za-z0-9_]*)/g)) {
        assert(Object.prototype.hasOwnProperty.call(params, name), `SQL parameter @${name} must be bound: ${statement}`);
      }
    }
    const scopeRows = state.rows.filter(item => item.PartnerCode === params.pc?.value && item.OrderYear === params.yr?.value);
    if (/sp_getapplock/.test(statement)) return { recordset: [{ LockResult: 0 }] };
    if (/SELECT m.PnlKey/.test(statement)) return { recordset: scopeRows.filter(item => !/m.PnlKey=@pnlKey/.test(statement) || item.PnlKey === params.pnlKey.value) };
    if (/FROM WebRaumPnlItem AS i/.test(statement)) return { recordset: params.itemKey ? state.rows.filter(item => item.ItemKey === params.itemKey.value && item.PnlKey === params.pnlKey.value) : scopeRows };
    if (/FROM Product AS p/.test(statement)) return { recordset: state.inactiveProduct ? [] : [{ ProdKey: params.prodKey.value }] };
    if (/UPDATE WebRaumPnlItem/.test(statement)) { state.rows.find(item => item.ItemKey === params.itemKey.value).ProdKey = params.prodKey.value; return { recordset: [] }; }
    if (/UPDATE WebRaumPnl/.test(statement)) { if (state.fail) throw new Error('audit failure'); return { recordset: [] }; }
    throw new Error('Unexpected SQL: ' + statement);
  };
  const core = compileModule(path.join(root, 'lib/shillaPnlProductMatch.js'), {
    './db.js': { sql, withTransaction: async callback => {
      const before = structuredClone(state.rows);
      try { return await callback(run); } catch (error) { state.rows = before; throw error; }
    } },
    './shillaPnlProductMatchState.js': stateApi,
    './shillaPnlHotelMatch.js': pureMatch,
  });
  const api = compileModule(path.join(root, 'lib/pnlHotelProductMatch.js'), {
    './shillaPnlProductMatch.js': core,
    './pnlHotelRegistry.js': { requirePnlPartner: async code => {
      if (!state.active || ![hotel, other, 'shilla', 'raum', 'choimun'].includes(code)) throw Object.assign(new Error('inactive'), { code: 'INACTIVE' });
      return { code, customHotel: code.startsWith('hotel_') };
    } },
  });
  return { state, api };
}
const request = overrides => ({ partnerCode: hotel, orderYear: '2026', major: 12, pnlKey: 101, itemKey: 1, prodKey: 777, applySameHotel: true, expected: row(1), ...overrides });

function importHarness() {
  const state = { calls: [], rows: [row(1, hotel, '2026', 777), row(2, other, '2026', 888), row(3, hotel, '2025', 999)], existing: false, fail: false };
  const descriptor = code => ({ code, kind: 'custom-hotel', customHotel: true, label: code, sheetMode: 'single', erpSync: false });
  const run = async (statement, params = {}) => {
    state.calls.push({ statement, params });
    if (/sp_getapplock/.test(statement)) return { recordset: [{ LockResult: 0 }] };
    if (/SELECT TOP 1 PnlKey FROM WebRaumPnl WHERE/.test(statement)) return { recordset: state.existing ? [{ PnlKey: 101 }] : [] };
    if (/SELECT ItemKey, ProdKey/.test(statement)) return { recordset: [state.rows[0]] };
    if (/SELECT.*?m.OrderYear, i.ItemName|SELECT i.ItemName, i.Unit/s.test(statement)) {
      assert.match(statement, /OrderYear=@yr AND m.PartnerCode=@pc/);
      return { recordset: state.rows.filter(item => item.PartnerCode === params.pc.value && item.OrderYear === params.yr.value) };
    }
    if (/SELECT p.ProdKey FROM Product/.test(statement)) return { recordset: [{ ProdKey: params.prodKey.value }] };
    if (/INSERT INTO WebRaumPnl \(/.test(statement)) return { recordset: [{ PnlKey: 102 }] };
    return { recordset: [] };
  };
  const api = compileModule(path.join(root, 'lib/raumPnl.js'), {
    './db': { query: run, sql: new Proxy({}, { get: (_, key) => key }), withTransaction: callback => callback(run) },
    './parseMappings': {}, './displayName': {}, './catalogArrival': {}, './catalogUnitMatch': {},
    './raumPnlMonthly': { normalizeRaumAssignedMonth: value => value, resolveRaumNenovaPct: value => Number(value ?? 80) },
    './raumPnlUploadDiff': { diffRaumPnlUpload: () => ({ hasChanges: false }) },
    './raumPnlCost': {}, './raumPnlConsignedCost': { fillConsignedCostsFromOrdinary: items => items },
    './raumPnlPartner': { resolvePnlPartner: descriptor, defaultPnlTitle: () => 'Hotel 12' },
    './pnlHotelRegistry': { requirePnlPartner: async code => descriptor(code) },
    './raumPnlParse': {}, './shillaPnlHotelMatch': pureMatch,
  });
  return { state, api };
}

async function main() {
  let { state, api } = harness();
  const saved = await api.savePnlHotelProductMatch(request());
  assert.equal(saved.changedItemCount, 2);
  assert.deepEqual(state.rows.map(item => item.ProdKey), [777, 777, null, null], 'hotel and prior-year rows are isolated');
  assert.equal(state.calls[0].params.resource.value, `hotel-pnl-year:${hotel}:2026`);
  for (const call of state.calls.filter(call => /PartnerCode=@pc/.test(call.statement))) assert.equal(call.params.pc.value, hotel);
  const writes = state.calls.filter(call => /^\s*UPDATE/.test(call.statement));
  assert(writes.every(call => /UPDATE WebRaumPnl(?:Item)?\s/.test(call.statement)));
  await assert.rejects(api.savePnlHotelProductMatch(request()), error => error.code === 'STALE_ITEM');

  ({ state, api } = harness()); state.rows[1].ProdKey = 888;
  await assert.rejects(api.savePnlHotelProductMatch(request()), error => error.code === 'GROUP_MAPPING_CONFLICT');
  assert.equal(state.rows[0].ProdKey, null);
  ({ state, api } = harness()); state.fail = true;
  await assert.rejects(api.savePnlHotelProductMatch(request()), /audit failure/);
  assert.equal(state.rows[0].ProdKey, null, 'parent failure rolls back product mapping');
  ({ state, api } = harness()); state.inactiveProduct = true;
  await assert.rejects(api.savePnlHotelProductMatch(request()), error => error.code === 'INVALID_PRODUCT');
  ({ state, api } = harness()); state.active = false;
  await assert.rejects(api.savePnlHotelProductMatch(request()), error => error.code === 'INACTIVE');
  assert.equal(state.calls.length, 0);
  ({ state, api } = harness());
  await assert.rejects(api.savePnlHotelProductMatch(request({ partnerCode: '' })), error => error.code === 'PNL_PARTNER_REQUIRED');
  for (const partnerCode of ['raum', 'choimun']) {
    await assert.rejects(api.savePnlHotelProductMatch(request({ partnerCode })), error => error.code === 'PNL_HOTEL_MAPPING_SCOPE_INVALID');
  }
  await assert.rejects(api.savePnlHotelProductMatch(request({ orderYear: '2025' })), error => error.code === 'STALE_SCOPE');
  assert.equal(state.rows[0].ProdKey, null);

  const fixture = importHarness();
  const item = { name: '장미', unit: '단', qty: 2, price: 3000, supply: 6000, prodKey: null, isCustom: false };
  const batches = [hotel, other].map(partnerCode => ({ partnerCode, orderYear: '2026', major: 12, verification: [], items: [item] }));
  const preview = await fixture.api.prepareRaumPnlImportPreview(batches);
  assert.deepEqual(preview.batches.map(batch => batch.items[0].prodKey), [777, 888], 'future upload learns only same hotel/year');
  const prior = await fixture.api.prepareRaumPnlImportPreview([{ ...batches[0], orderYear: '2025' }]);
  assert.equal(prior.batches[0].items[0].prodKey, 999);
  const next = await fixture.api.prepareRaumPnlImportPreview([{ ...batches[0], orderYear: '2027' }]);
  assert.equal(next.batches[0].items[0].prodKey, null);
  await fixture.api.saveRaumPnlImportBatch({ batches: preview.batches, expectedSnapshots: preview.snapshots });
  assert(fixture.state.calls.some(call => call.params.resource?.value === `hotel-pnl-year:${hotel}:2026`));
  const inserts = fixture.state.calls.filter(call => /INSERT INTO WebRaumPnlItem/.test(call.statement));
  assert.deepEqual(inserts.map(call => call.params.pk.value), [777, 888]);
  fixture.state.rows[0].ProdKey = 1000;
  await assert.rejects(fixture.api.saveRaumPnlImportBatch({ batches: preview.batches, expectedSnapshots: preview.snapshots }), /매칭 보존 결과가 미리보기 이후 변경/);

  fixture.state.existing = true;
  const before = fixture.state.calls.length;
  await assert.rejects(fixture.api.saveRaumPnl({ partnerCode: hotel, orderYear: '2026', major: 12, verification: [], items: [{ ...item, itemKey: 1, prodKey: 777 }] }), error => error.code === 'PNL_HOTEL_MAPPING_STALE');
  assert(!fixture.state.calls.slice(before).some(call => /^\s*(UPDATE|DELETE|INSERT)/.test(call.statement)), 'stale full save rejected before any DML');
  fixture.api.assertHotelFullSaveMappings([{ ...item, itemKey: 1, prodKey: 1000 }], [fixture.state.rows[0]]);
  assert.throws(() => fixture.api.assertHotelFullSaveMappings([], [fixture.state.rows[0]]), error => error.code === 'PNL_HOTEL_MAPPING_STALE');
  assert.throws(() => fixture.api.assertHotelFullSaveMappings([{ ...item, itemKey: 1, prodKey: 1000 }], [{ ...fixture.state.rows[0], ProdKey: null }]), error => error.code === 'PNL_HOTEL_MAPPING_STALE');
  console.log('Hotel scoped product mapping, import reuse, cross-year isolation and stale full-save tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

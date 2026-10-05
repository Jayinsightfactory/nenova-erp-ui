const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');
function compile(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const code = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' },
  }).code;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = request => Object.hasOwn(mocks, request) ? mocks[request] : original(request);
  loaded._compile(code, filename);
  return loaded.exports;
}

const period = compile('lib/raumPnlPeriod.js');
const snapshot = rows => rows.map(row => ({ itemKey: Number(row.itemKey ?? row.ItemKey), costPrice: row.costPrice ?? row.CostPrice ?? null }))
  .sort((a, b) => a.itemKey - b.itemKey);
const costPolicy = {
  raumPnlCostIdentity: row => `prod:${row.prodKey ?? row.ProdKey}|unit:${row.unit ?? row.Unit}`,
  raumPnlCostSnapshot: snapshot,
  sameRaumPnlCostSnapshot: (a, b) => JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b)),
};

async function main() {
  const db = {
    sql: { Int: 'Int', Float: 'Float', NVarChar: length => `NVarChar(${length})` },
    withTransaction: async callback => {
      const staged = [];
      const result = await callback(async (statement, params) => {
        db.calls.push({ statement, params });
        if (/FROM WebRaumPnl AS m WITH/.test(statement)) {
          const exact = params.yr.value === '2026' && params.pc.value === 'shilla'
            && params.major.value === '39-2' && params.pnlKey.value === 61;
          return { recordset: exact ? [{ PnlKey: 61, MajorWeek: '39-2' }] : [] };
        }
        if (/FROM WebRaumPnlItem AS i WITH/.test(statement)) return { recordset: db.items };
        if (/^UPDATE WebRaumPnlItem/.test(statement.trim())) staged.push(['item', params.itemKey.value, params.cost.value]);
        if (/^UPDATE WebRaumPnl\b/.test(statement.trim())) staged.push(['parent', params.pnlKey.value, params.major.value]);
        return { recordset: [] };
      });
      db.committed.push(...staged);
      return result;
    },
    calls: [], committed: [], items: [{ ItemKey: 612, ProdKey: 2330, Unit: '단', CostPrice: null }],
  };
  const cost = compile('lib/raumPnlPurchaseCost.js', {
    './db.js': db, './raumPnlCostComparison.js': costPolicy, './raumPnlPeriod.js': period,
  });
  const update = (overrides = {}) => ({ pnlKey: 61, major: '39-2', identity: 'prod:2330|unit:단',
    expected: [{ itemKey: 612, costPrice: null }], costPrice: 0, ...overrides });
  assert.equal(cost.normalizeRaumPurchaseCostUpdates([update()], 'shilla')[0].major, '39-2');
  assert.equal(cost.normalizeRaumPurchaseCostUpdates([update({ major: '39' })], 'shilla')[0].major, 39);
  for (const invalid of ['39-0', '39-02', '39-10', '39-2-1', '39-2x']) {
    assert.throws(() => cost.normalizeRaumPurchaseCostUpdates([update({ major: invalid })], 'shilla'), /차수/);
  }
  assert.throws(() => cost.normalizeRaumPurchaseCostUpdates([update()], 'raum'), /차수/);
  assert.throws(() => cost.normalizeSharedRaumPurchaseCostUpdates([update()]), /차수/);
  const saved = await cost.saveRaumPnlPurchaseCosts({ orderYear: '2026', partnerCode: 'shilla', updates: [update()], actor: 'tester' });
  assert.equal(saved.changedRows, 1);
  assert.deepEqual(db.committed, [['item', 612, 0], ['parent', 61, '39-2']]);
  assert.equal(db.calls.find(call => call.params?.major)?.params.major.type, 'NVarChar(4)');
  db.items = [{ ...db.items[0], CostPrice: 0 }];
  db.committed.length = 0;
  await cost.saveRaumPnlPurchaseCosts({ orderYear: '2026', partnerCode: 'shilla',
    updates: [update({ expected: [{ itemKey: 612, costPrice: 0 }], costPrice: null })] });
  assert.deepEqual(db.committed, [['item', 612, null], ['parent', 61, '39-2']], 'explicit zero and null remain distinct');
  db.calls.length = 0; db.committed.length = 0;
  await assert.rejects(cost.saveRaumPnlPurchaseCosts({ orderYear: '2025', partnerCode: 'shilla', updates: [update()] }), error => error.code === 'STALE_SCOPE');
  await assert.rejects(cost.saveRaumPnlPurchaseCosts({ orderYear: '2026', partnerCode: 'raum', updates: [update()] }), /차수/);
  assert.deepEqual(db.committed, [], 'cross-year and shared-hotel near misses write nothing');
  db.items = [{ ...db.items[0], CostPrice: 5 }];
  await assert.rejects(cost.saveRaumPnlPurchaseCosts({ orderYear: '2026', partnerCode: 'shilla', updates: [update()] }), error => error.code === 'STALE_COST');
  assert.deepEqual(db.committed, [], 'stale snapshot rolls back before item and parent writes');

  const state = compile('lib/shillaPnlProductMatchState.js');
  const hotel = compile('lib/shillaPnlHotelMatch.js');
  const bulk = compile('lib/shillaPnlBulkMatchState.js', {
    './shillaPnlProductMatchState.js': state, './shillaPnlHotelMatch.js': hotel, './raumPnlPeriod.js': period,
  });
  const row = (pnlKey, major, itemKey) => ({ PnlKey: pnlKey, MajorWeek: major, ItemKey: itemKey,
    ItemName: '왁스 화이트', Unit: '단', Qty: 0, SalePrice: 0, SaleAmount: 0, ProdKey: null, IsCustom: 0 });
  const grouped = bulk.buildShillaBulkMatchGroups([row(60, '39', 601), row(61, '39-2', 612)], []);
  assert.deepEqual(grouped[0].majors, ['39-2', 39]);
  assert.deepEqual(grouped[0].expected.members.map(member => member.major), [39, '39-2']);
  assert.equal(bulk.sameShillaBulkExpectedMembers(grouped[0].expected.members,
    { members: [row(60, '39', 601), row(61, '39', 612)] }), false, 'period change invalidates whole group snapshot');
  assert.throws(() => bulk.buildShillaBulkMatchGroups([row(61, '39-10', 612)], []), /차수/);

  const matchDb = { sql: db.sql, calls: [], withTransaction: async callback => callback(async (statement, params) => {
    matchDb.calls.push({ statement, params });
    if (/sp_getapplock/.test(statement)) return { recordset: [{ LockResult: 0 }] };
    if (/FROM WebRaumPnl AS m WITH/.test(statement)) {
      const exact = params.yr.value === '2026' && params.major.value === '39-2' && params.pnlKey.value === 61;
      return { recordset: exact ? [{ PnlKey: 61, MajorWeek: '39-2' }] : [] };
    }
    if (/FROM WebRaumPnlItem AS i WITH/.test(statement)) return { recordset: [{
      ItemKey: 612, ItemName: '왁스 화이트', Unit: '단', Qty: 0, SalePrice: 0,
      SaleAmount: 0, ProdKey: null, IsCustom: 0,
    }] };
    if (/FROM Product AS p WITH/.test(statement)) return { recordset: [{ ProdKey: 2330 }] };
    return { rowsAffected: [1], recordset: [] };
  }) };
  const match = compile('lib/shillaPnlProductMatch.js', {
    './db.js': matchDb, './raumPnlPeriod.js': period,
    './shillaPnlProductMatchState.js': state, './shillaPnlHotelMatch.js': hotel,
  });
  const matchRequest = { partnerCode: 'shilla', orderYear: '2026', major: '39-2', pnlKey: 61, itemKey: 612,
    prodKey: 2330, expected: { itemKey: 612, name: '왁스 화이트', unit: '단', qty: 0,
      salePrice: 0, saleAmount: 0, prodKey: null, isCustom: false } };
  assert.equal(match.normalizeShillaPnlProductMatchRequest(matchRequest).major, '39-2');
  for (const invalid of ['39-0', '39-02', '39-10']) assert.throws(() => match.normalizeShillaPnlProductMatchRequest({ ...matchRequest, major: invalid }), /차수/);
  const matched = await match.saveShillaPnlProductMatch(matchRequest);
  assert.deepEqual(matched.affectedMajors, ['39-2']);
  const masterCall = matchDb.calls.find(call => call.statement === match.SHILLA_PNL_PRODUCT_MATCH_SQL.master);
  const parentCall = matchDb.calls.find(call => call.statement === match.SHILLA_PNL_PRODUCT_MATCH_SQL.parentWrite);
  assert.equal(masterCall.params.major.type, 'NVarChar(4)');
  assert.equal(masterCall.params.major.value, '39-2');
  assert.equal(parentCall.params.major.value, '39-2', 'parent audit remains in exact sub-period');
  matchDb.calls.length = 0;
  await assert.rejects(match.saveShillaPnlProductMatch({ ...matchRequest, orderYear: '2025' }), error => error.code === 'STALE_SCOPE');
  assert.equal(matchDb.calls.some(call => /^\s*UPDATE\b/.test(call.statement)), false);

  const mixedRows = [row(60, '39', 601), row(61, '39-2', 612)];
  const sameHotelDb = { sql: db.sql, calls: [], committed: [], failParent: false };
  let sameHotelMatch;
  sameHotelDb.withTransaction = async callback => {
    const staged = [];
    const result = await callback(async (statement, params) => {
      sameHotelDb.calls.push({ statement, params });
      if (statement === sameHotelMatch.SHILLA_PNL_PRODUCT_MATCH_SQL.yearLock) return { recordset: [{ LockResult: 0 }] };
      if (statement === sameHotelMatch.SHILLA_PNL_PRODUCT_MATCH_SQL.groupMasters) return { recordset: mixedRows.map(({ PnlKey, MajorWeek }) => ({ PnlKey, MajorWeek })) };
      if (statement === sameHotelMatch.SHILLA_PNL_PRODUCT_MATCH_SQL.groupItems) return { recordset: mixedRows };
      if (statement === sameHotelMatch.SHILLA_PNL_PRODUCT_MATCH_SQL.product) return { recordset: [{ ProdKey: 2330 }] };
      if (statement === sameHotelMatch.SHILLA_PNL_PRODUCT_MATCH_SQL.itemWrite) staged.push(['item', params.pnlKey.value, params.itemKey.value]);
      if (statement === sameHotelMatch.SHILLA_PNL_PRODUCT_MATCH_SQL.parentWrite) {
        if (sameHotelDb.failParent && params.pnlKey.value === 61) throw new Error('same-hotel audit failure');
        staged.push(['parent', params.pnlKey.value, params.major.value]);
      }
      return { rowsAffected: [1], recordset: [] };
    });
    sameHotelDb.committed.push(...staged);
    return result;
  };
  sameHotelMatch = compile('lib/shillaPnlProductMatch.js', {
    './db.js': sameHotelDb, './raumPnlPeriod.js': period,
    './shillaPnlProductMatchState.js': state, './shillaPnlHotelMatch.js': hotel,
  });
  const sameHotelResult = await sameHotelMatch.saveShillaPnlProductMatch({ ...matchRequest, applySameHotel: true });
  assert.deepEqual(sameHotelResult.affectedMajors, [39, '39-2']);
  assert.deepEqual(sameHotelDb.committed, [['item', 60, 601], ['item', 61, 612], ['parent', 60, '39'], ['parent', 61, '39-2']]);
  assert.deepEqual(sameHotelDb.calls.filter(call => call.statement === sameHotelMatch.SHILLA_PNL_PRODUCT_MATCH_SQL.parentWrite)
    .map(call => [call.params.major.type, call.params.major.value]), [['NVarChar(4)', '39'], ['NVarChar(4)', '39-2']]);
  sameHotelDb.committed.length = 0; sameHotelDb.failParent = true;
  await assert.rejects(sameHotelMatch.saveShillaPnlProductMatch({ ...matchRequest, applySameHotel: true }), /audit failure/);
  assert.deepEqual(sameHotelDb.committed, [], 'same-hotel parent failure rolls back both period writes');

  const bulkDb = { sql: db.sql, calls: [], committed: [], failParent: false };
  let bulkMatch;
  bulkDb.withTransaction = async callback => {
    const staged = [];
    const result = await callback(async (statement, params) => {
      bulkDb.calls.push({ statement, params });
      if (statement === bulkMatch.SHILLA_PNL_BULK_MATCH_SQL.yearLock) return { recordset: [{ LockResult: 0 }] };
      if (statement === bulkMatch.SHILLA_PNL_BULK_MATCH_SQL.masters) return { recordset: mixedRows.map(({ PnlKey, MajorWeek }) => ({ PnlKey, MajorWeek })) };
      if (statement === bulkMatch.SHILLA_PNL_BULK_MATCH_SQL.items) return { recordset: mixedRows };
      if (statement === bulkMatch.SHILLA_PNL_BULK_MATCH_SQL.product) return { recordset: [{ ProdKey: 2330 }] };
      if (statement === bulkMatch.SHILLA_PNL_BULK_MATCH_SQL.itemWrite) staged.push(['item', params.pnlKey.value, params.itemKey.value]);
      if (statement === bulkMatch.SHILLA_PNL_BULK_MATCH_SQL.parentWrite) {
        if (bulkDb.failParent && params.pnlKey.value === 61) throw new Error('bulk audit failure');
        staged.push(['parent', params.pnlKey.value, params.major.value]);
      }
      return { rowsAffected: [1], recordset: [] };
    });
    bulkDb.committed.push(...staged);
    return result;
  };
  bulkMatch = compile('lib/shillaPnlBulkMatch.js', {
    './db.js': bulkDb, './raumPnlPeriod.js': period, './shillaPnlBulkMatchState.js': bulk,
  });
  const bulkRequest = { partnerCode: 'shilla', orderYear: '2026', action: 'MATCH_SELECTED_GROUPS', confirmed: true,
    groups: [{ groupKey: grouped[0].groupKey, prodKey: 2330, expected: grouped[0].expected }] };
  const bulkResult = await bulkMatch.saveShillaBulkMatch(bulkRequest);
  assert.deepEqual(bulkResult.affectedMajors, [39, '39-2']);
  assert.deepEqual(bulkDb.committed, [['item', 60, 601], ['item', 61, 612], ['parent', 60, '39'], ['parent', 61, '39-2']]);
  assert.deepEqual(bulkDb.calls.filter(call => call.statement === bulkMatch.SHILLA_PNL_BULK_MATCH_SQL.parentWrite)
    .map(call => [call.params.major.type, call.params.major.value]), [['NVarChar(4)', '39'], ['NVarChar(4)', '39-2']]);
  bulkDb.committed.length = 0; bulkDb.failParent = true;
  await assert.rejects(bulkMatch.saveShillaBulkMatch(bulkRequest), /audit failure/);
  assert.deepEqual(bulkDb.committed, [], 'bulk parent failure rolls back both period writes');

  const comparison = compile('lib/raumPnlCostComparisonServer.js', {
    './db.js': { sql: db.sql, query: async () => ({ recordset: [
      { PnlKey: 61, ItemKey: 612, OrderYear: '2026', MajorWeek: '39-2', PartnerCode: 'shilla', CostPrice: 0 },
      { PnlKey: 60, ItemKey: 601, OrderYear: '2026', MajorWeek: '39', PartnerCode: 'shilla', CostPrice: null },
    ] }) }, './raumPnlPeriod.js': period,
  });
  const comparisonRows = await comparison.loadRaumPnlCostComparisonRows({ orderYear: '2026', partnerCode: 'shilla' });
  assert.deepEqual(comparisonRows.map(row => [row.major, row.costPrice]), [['39-2', 0], [39, null]]);
  assert.match(comparison.RAUM_PNL_COST_COMPARISON_SQL, /SUBSTRING\(m\.MajorWeek/);
  assert.match(comparison.RAUM_PNL_COST_COMPARISON_SQL, /i\.Seq ASC, i\.ItemKey ASC/);
  assert.match(comparison.RAUM_PNL_PURCHASE_COST_COMPARISON_SQL, /ORDER BY TRY_CONVERT\(INT, m\.MajorWeek\) DESC/,
    'Raum/Choimun shared numeric order is unchanged');

  const history = compile('lib/pnlHotelCostHistory.js', {
    './db.js': { sql: db.sql }, './raumPnlPeriod.js': period,
    './pnlHotelRegistry.js': { listPnlHotels: async () => [{ code: 'shilla', label: '신라호텔' }] },
  });
  const historyResult = await history.loadPnlHotelCostHistory({ orderYear: '2026' }, async () => ({ recordset: [
    { PnlKey: 61, ItemKey: 612, OrderYear: '2026', MajorWeek: '39-2', PartnerCode: 'shilla', CostPrice: 0 },
    { PnlKey: 60, ItemKey: 601, OrderYear: '2026', MajorWeek: '39', PartnerCode: 'shilla', CostPrice: null },
    { PnlKey: 62, ItemKey: 613, OrderYear: '2025', MajorWeek: '39-2', PartnerCode: 'shilla', CostPrice: 7 },
  ] }));
  assert.deepEqual(historyResult.rows.map(row => [row.major, row.costPrice]), [['39-2', 0]]);
  assert.match(history.HOTEL_PNL_COST_HISTORY_SQL, /SUBSTRING\(m\.MajorWeek/);

  const arrival = await import('../lib/raumPnlArrivalReference.js');
  const source = { ArrivalLineKey: 1, OrderYear: '2026', OrderWeek: '40-1', ProdKey: 2330,
    ArrivalUnit: '단', SelectedArrivalCostKRW: 100, SourceFileName: 'a.xlsx', SheetName: 'Sheet1', SourceRow: 2 };
  const items = [{ itemKey: 612, prodKey: 2330, unit: '단' }];
  const refs = arrival.buildRaumPnlArrivalReferences(items, [source, { ...source, OrderYear: '2025', ArrivalLineKey: 2 }], '39-2', '2026');
  assert.deepEqual(refs[612].map(ref => ref.week), ['40-1']);
  assert.equal(refs[612][0].requestedMajor, 39, 'ERP reference derives base major, not suffix as -02');
  let arrivalParams;
  await arrival.loadRaumPnlArrivalReferences({ orderYear: '2026', major: '39-2', items }, async (_sql, params) => {
    arrivalParams = params; return { recordset: [source] };
  });
  assert.equal(arrivalParams.major.value, 39);
  assert.deepEqual(arrival.buildRaumPnlArrivalReferences(items, [source], '39-10', '2026'), {});

  const customer = compile('lib/pnlHotelCustomerMap.js', {
    './db.js': { sql: db.sql }, './raumPnlPeriod.js': period,
    './pnlHotelRegistry.js': { requirePnlPartner: async code => ({ code }) },
  });
  const calls = [];
  const referenceQuery = async (statement, params) => {
    calls.push({ statement, params });
    if (/WebPnlHotelCustomerMap/.test(statement)) return { recordset: [{ CustKey: 446, Revision: 1, Active: 1 }] };
    return { recordset: [] };
  };
  await customer.loadHotelCustomerShipments('shilla', '2026', '39-2', referenceQuery);
  assert.equal(calls.at(-1).params.week.value, '39-%');
  assert.equal(calls.at(-1).params.yr.value, '2026');
  await assert.rejects(customer.loadHotelCustomerShipments('raum', '2026', '39-2', referenceQuery), /신라호텔/);
  await assert.rejects(customer.loadHotelCustomerShipments('shilla', '2026', '39-10', referenceQuery), /차수/);
  console.log('Shilla 39 vs 39-2 period scopes, stale snapshots, cost DTO and read-reference fixtures passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

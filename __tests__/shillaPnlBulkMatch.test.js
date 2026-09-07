const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');
function compile(filename, mocks = {}) {
  const compiled = transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' },
  }).code;
  const loaded = new Module(filename, module); loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = request => (Object.prototype.hasOwnProperty.call(mocks, request) ? mocks[request] : original(request));
  loaded._compile(compiled, filename); return loaded.exports;
}

function load() {
  const hotelApi = compile(path.join(root, 'lib/shillaPnlHotelMatch.js'));
  const snapshotApi = compile(path.join(root, 'lib/shillaPnlProductMatchState.js'));
  const stateApi = compile(path.join(root, 'lib/shillaPnlBulkMatchState.js'), {
    './shillaPnlHotelMatch.js': hotelApi,
    './shillaPnlProductMatchState.js': snapshotApi,
  });
  const state = { queryRows: [], calls: [], transactionCalls: [], lockResult: 0, rows: [], failParent: false, committed: [], itemAffected: 1 };
  const db = {
    sql: new Proxy({}, { get: (_target, property) => String(property) }),
    query: async (statement, params) => { state.calls.push({ statement, params }); return { recordset: state.queryRows }; },
    withTransaction: async callback => {
      const staged = [];
      try {
        const result = await callback(async (statement, params) => {
          state.transactionCalls.push({ statement, params });
          if (/sp_getapplock/i.test(statement)) return state.lockResult === 'missing' ? { recordset: [] } : { recordset: [{ LockResult: state.lockResult }] };
          if (/FROM WebRaumPnl AS m WITH/.test(statement)) return { recordset: [{ PnlKey: 101, MajorWeek: 35 }, { PnlKey: 99, MajorWeek: 30 }, { PnlKey: 77, MajorWeek: 31 }] };
          if (/FROM WebRaumPnlItem AS i WITH/.test(statement)) return { recordset: state.rows };
          if (/FROM Product AS p WITH/.test(statement)) return { recordset: params.prodKey.value === 181 ? [{ ProdKey: 181, ProdName: '송이' }] : [] };
          if (/^\s*UPDATE WebRaumPnlItem/i.test(statement)) { staged.push([params.pnlKey.value, params.itemKey.value, params.prodKey.value]); return { rowsAffected: [state.itemAffected] }; }
          if (/^\s*UPDATE WebRaumPnl\b/i.test(statement)) { if (state.failParent) throw new Error('parent audit failure'); return { rowsAffected: [1] }; }
          return { recordset: [] };
        });
        state.committed.push(...staged); return result;
      } catch (cause) { state.rolledBack = (state.rolledBack || 0) + 1; throw cause; }
    },
  };
  const api = compile(path.join(root, 'lib/shillaPnlBulkMatch.js'), {
    './db.js': db, './shillaPnlBulkMatchState.js': stateApi,
  });
  const handler = compile(path.join(root, 'pages/api/raum/shilla-bulk-mapping.js'), {
    '../../../lib/auth': { withAuth: fn => fn }, '../../../lib/shillaPnlBulkMatch.js': api,
  }).default;
  return { api, stateApi, state, handler };
}
function row(overrides = {}) {
  return { PnlKey: 101, MajorWeek: 35, ItemKey: 1001, ItemName: '장미 · 쉬머', Unit: '단', Qty: 16, SalePrice: 10800, SaleAmount: 172800, ProdKey: null, IsCustom: 0, ...overrides };
}
function response() { return { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

async function main() {
  const { api, stateApi, state, handler } = load();
  assert.match(api.SHILLA_PNL_BULK_MATCH_SQL.getRows, /OrderYear=@yr[\s\S]*PartnerCode='shilla'[\s\S]*isDeleted/i);
  assert.match(api.SHILLA_PNL_BULK_MATCH_SQL.items, /UPDLOCK, HOLDLOCK[\s\S]*OrderYear=@yr[\s\S]*PartnerCode='shilla'/i);
  assert.match(api.SHILLA_PNL_BULK_MATCH_SQL.itemWrite, /ProdKey IS NULL/i);
  assert.match(api.SHILLA_PNL_BULK_MATCH_SQL.parentWrite, /OrderYear=@yr[\s\S]*MajorWeek=@major[\s\S]*PartnerCode='shilla'/i);
  const rows = [
    row(), row({ PnlKey: 99, MajorWeek: 30, ItemKey: 901, ItemName: ' 장미   · 쉬머 ', ProdKey: 181, ActiveProdKey: 181, ProdName: '송이' }),
    row({ PnlKey: 77, MajorWeek: 31, ItemKey: 771, ItemName: '국화', Unit: '단' }),
    row({ PnlKey: 66, MajorWeek: 29, ItemKey: 661, ItemName: '', Unit: '단' }),
    row({ PnlKey: 55, MajorWeek: 28, ItemKey: 551, ItemName: '장미 · 쉬머', Unit: '박스' }),
    row({ PnlKey: 44, MajorWeek: 27, ItemKey: 441, ItemName: '장미 · 쉬머', IsCustom: 1 }),
  ];
  const groups = stateApi.buildShillaBulkMatchGroups(rows, [{ ProdKey: 181, ProdName: '송이' }]);
  assert.equal(groups.length, 3, 'unit/custom/blank identity near misses do not join');
  assert.equal(groups.find(group => group.label === '장미 · 쉬머' && group.unit === '단').expected.members.some(member => member.prodKey === 181), true, 'snapshot includes mapped sibling');
  assert.equal(stateApi.countShillaBulkUngroupedRows(rows), 1);
  const zero = stateApi.buildShillaBulkMatchGroups([row({ Qty: 0, SalePrice: 0, SaleAmount: 0 })], []);
  assert.deepEqual(zero[0].expected.members[0], { pnlKey: 101, major: 35, itemKey: 1001, name: '장미 · 쉬머', unit: '단', qty: 0, salePrice: 0, saleAmount: 0, prodKey: null, isCustom: false }, 'zero quantity and prices remain an exact snapshot value');
  const conflicting = stateApi.buildShillaBulkMatchGroups([row(), row({ PnlKey: 98, ItemKey: 902, ProdKey: 181 }), row({ PnlKey: 97, ItemKey: 903, ProdKey: 182 })], [{ ProdKey: 181 }]);
  assert.equal(conflicting[0].suggestion.status, 'conflict', 'multiple or inactive mapped siblings are never suggested');

  state.queryRows = rows;
  const read = await api.loadShillaBulkMatchGroups({ partnerCode: 'shilla', orderYear: '2026' });
  assert.equal(read.ungroupedCount, 1); assert.match(read.notice, /품목명 또는 단위/);
  assert.equal(state.calls.length, 1, 'GET uses one SELECT only');
  assert.equal(state.calls[0].params.yr.value, '2026', 'GET passes the explicit selected year');
  assert.doesNotMatch(state.calls[0].statement, /UPDLOCK|\bUPDATE\s|\bINSERT\s|\bDELETE\s|sp_getapplock/i);
  const res = response(); await handler({ method: 'GET', query: { partnerCode: 'shilla', orderYear: '2026' }, user: {} }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.success, true);

  const baselineRows = rows.filter(current => current.PnlKey !== 66 && current.PnlKey !== 55 && current.PnlKey !== 44);
  state.rows = baselineRows;
  const bulkGroup = read.groups.find(group => group.label === '장미 · 쉬머' && group.unit === '단');
  const secondGroup = read.groups.find(group => group.label === '국화');
  const payload = { partnerCode: 'shilla', orderYear: '2026', action: 'MATCH_SELECTED_GROUPS', confirmed: true,
    groups: [{ groupKey: bulkGroup.groupKey, prodKey: 181, expected: bulkGroup.expected }, { groupKey: secondGroup.groupKey, prodKey: 181, expected: secondGroup.expected }] };
  const saved = await api.saveShillaBulkMatch({ ...payload, actor: 'tester' });
  assert.deepEqual(saved, { changedGroupCount: 2, changedItemCount: 2, affectedMajors: [31, 35] });
  assert.deepEqual(state.committed, [[77, 771, 181], [101, 1001, 181]], 'only null rows are updated in ItemKey order');
  const lock = state.transactionCalls.findIndex(call => call.statement === api.SHILLA_PNL_BULK_MATCH_SQL.yearLock);
  const masters = state.transactionCalls.findIndex(call => call.statement === api.SHILLA_PNL_BULK_MATCH_SQL.masters);
  const items = state.transactionCalls.findIndex(call => call.statement === api.SHILLA_PNL_BULK_MATCH_SQL.items);
  const product = state.transactionCalls.findIndex(call => call.statement === api.SHILLA_PNL_BULK_MATCH_SQL.product);
  assert.ok(lock < masters && masters < items && items < product, 'lock order is year → masters → items → Product');

  // Every malformed app-lock return fails closed before a write.
  for (const lockResult of [null, false, '', '0', 'missing', -1]) {
    state.lockResult = lockResult; state.transactionCalls.length = 0;
    await assert.rejects(api.saveShillaBulkMatch({ ...payload, actor: 'tester' }), error => error.code === 'SHILLA_YEAR_LOCK_UNAVAILABLE');
    assert.equal(state.transactionCalls.some(call => /^\s*UPDATE/i.test(call.statement)), false);
  }
  state.lockResult = 0;

  // Added/removed/moved/source-changed members all invalidate the complete
  // snapshot before writes; a same-name row from another selected year cannot
  // satisfy the @yr-bound query.
  for (const changedRows of [
    [...baselineRows, row({ PnlKey: 88, MajorWeek: 34, ItemKey: 881 })],
    baselineRows.filter(current => current.ItemKey !== 901),
    baselineRows.map(current => current.ItemKey === 1001 ? { ...current, MajorWeek: 34 } : current),
    baselineRows.map(current => current.ItemKey === 1001 ? { ...current, Qty: 17 } : current),
    baselineRows.map(current => current.ItemKey === 901 ? { ...current, ProdKey: 3170 } : current),
  ]) {
    state.rows = changedRows; state.transactionCalls.length = 0;
    await assert.rejects(api.saveShillaBulkMatch({ ...payload, actor: 'tester' }), error => error.code === 'STALE_GROUP');
    assert.equal(state.transactionCalls.some(call => /^\s*UPDATE/i.test(call.statement)), false);
  }
  state.rows = baselineRows;

  // Product failure names the selected group; parent failure rolls back both
  // staged item writes rather than committing the first group.
  await assert.rejects(api.saveShillaBulkMatch({ ...payload, groups: [{ ...payload.groups[0], prodKey: 999 }], actor: 'tester' }), error => error.code === 'INVALID_PRODUCT' && /장미 · 쉬머/.test(error.message));
  state.failParent = true; state.committed.length = 0;
  await assert.rejects(api.saveShillaBulkMatch({ ...payload, actor: 'tester' }), /parent audit failure/);
  assert.deepEqual(state.committed, []); assert.ok(state.rolledBack > 0);
  state.failParent = false;
  state.itemAffected = 0; state.committed.length = 0;
  await assert.rejects(api.saveShillaBulkMatch({ ...payload, actor: 'tester' }), error => error.code === 'STALE_WRITE');
  assert.deepEqual(state.committed, [], 'unexpected affected-row count rolls every staged item back');
  state.itemAffected = 1;

  for (const bad of [{ confirmed: 'true' }, { action: 'match' }, { groups: [] }, { partnerCode: 'raum' }]) {
    assert.throws(() => stateApi.normalizeShillaBulkMatchRequest({ ...payload, ...bad }), /필요|지원|선택|신라호텔/);
  }
  assert.throws(() => stateApi.normalizeShillaBulkMatchRequest({ ...payload, groups: Array.from({ length: 201 }, (_, index) => ({ ...payload.groups[0], groupKey: `g-${index}` })) }), /최대 200개/);
  assert.throws(() => stateApi.normalizeShillaBulkMatchRequest({ ...payload, groups: [payload.groups[0], payload.groups[0]] }), /중복/);
  const post = response(); await handler({ method: 'POST', body: payload, user: { userName: 'tester' } }, post);
  assert.equal(post.statusCode, 200); assert.equal(post.body.success, true);
  const method = response(); await handler({ method: 'PUT', user: {} }, method); assert.equal(method.statusCode, 405);
  console.log('Shilla bulk unmatched matching tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

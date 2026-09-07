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

function loadApi() {
  const stateFilename = path.join(root, 'lib/shillaPnlProductMatchState.js');
  const stateApi = compileModule(stateFilename);
  const state = {
    calls: [], handler: async () => ({ recordset: [] }), rolledBack: 0,
    committedItemProdKey: null, committedParentWrites: 0, failParentWrite: false,
  };
  const db = {
    sql: new Proxy({}, { get: (_target, key) => String(key) }),
    withTransaction: async callback => {
      const staged = { itemProdKey: undefined, parentWrite: false };
      try {
        const result = await callback(async (statement, params) => {
          state.calls.push({ statement, params });
          if (/^\s*UPDATE\s+WebRaumPnlItem\b/i.test(statement)) {
            staged.itemProdKey = params.prodKey.value;
            return { recordset: [] };
          }
          if (/^\s*UPDATE\s+WebRaumPnl\b/i.test(statement)) {
            if (state.failParentWrite) throw new Error('simulated parent write failure');
            staged.parentWrite = true;
            return { recordset: [] };
          }
          return state.handler(statement, params);
        });
        if (staged.itemProdKey !== undefined) state.committedItemProdKey = staged.itemProdKey;
        if (staged.parentWrite) state.committedParentWrites += 1;
        return result;
      } catch (error) {
        state.rolledBack += 1;
        throw error;
      }
    },
  };
  const api = compileModule(path.join(root, 'lib/shillaPnlProductMatch.js'), {
    './db.js': db,
    './shillaPnlProductMatchState.js': stateApi,
  });
  return { api, state };
}

function loadHttpHandler(saveShillaPnlProductMatch) {
  return compileModule(path.join(root, 'pages/api/raum/shilla-item-mapping.js'), {
    '../../../lib/auth': { withAuth: handler => handler },
    '../../../lib/shillaPnlProductMatch.js': { saveShillaPnlProductMatch },
  }).default;
}

function expected(overrides = {}) {
  return {
    itemKey: 456,
    name: '호접 · 화이트',
    unit: '8스팀',
    qty: 324,
    price: 20000,
    supply: 6480000,
    prodKey: null,
    isCustom: false,
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    partnerCode: 'shilla', orderYear: '2026', major: 35, pnlKey: 123, itemKey: 456,
    prodKey: 3170, expected: expected(), ...overrides,
  };
}

async function main() {
  const { api, state } = loadApi();
  const source = fs.readFileSync(path.join(root, 'pages/api/raum/shilla-item-mapping.js'), 'utf8');

  // Detail UI calls these fields price/supply. They canonicalize to the database names
  // without changing null or explicit zero semantics.
  assert.deepEqual(api.shillaPnlProductMatchSnapshot(expected({ qty: 0, price: 0, supply: null })), {
    itemKey: 456, name: '호접 · 화이트', unit: '8스팀', qty: 0,
    salePrice: 0, saleAmount: null, prodKey: null, isCustom: false,
  });
  assert.equal(api.sameShillaPnlProductMatchSnapshot(expected({ price: 0 }), expected({ price: null })), false);
  assert.throws(() => api.shillaPnlProductMatchSnapshot({ ...expected(), supply: undefined }), /판매금액 값이 비어 있습니다|판매금액 값이 없습니다/);
  assert.throws(() => api.normalizeShillaPnlProductMatchRequest(request({ partnerCode: 'raum' })), /신라호텔/);
  assert.throws(() => api.normalizeShillaPnlProductMatchRequest(request({ orderYear: '26' })), /네 자리/);
  for (const prodKey of [undefined, 0, -1, 1.5, 'abc', true, [], {}]) {
    assert.throws(() => api.normalizeShillaPnlProductMatchRequest(request({ prodKey })), /전산 품목번호/);
  }
  assert.deepEqual(api.normalizeShillaPnlProductMatchRequest(request({ prodKey: null })).prodKey, null);
  assert.throws(() => api.normalizeShillaPnlProductMatchRequest(request({ itemKey: 457 })), /품목 연결 기준/);

  const httpCalls = [];
  const httpHandler = loadHttpHandler(async payload => {
    httpCalls.push(payload);
    return { changed: true, itemKey: payload.itemKey };
  });
  const response = () => ({ statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const methodResponse = response();
  await httpHandler({ method: 'GET', user: {} }, methodResponse);
  assert.equal(methodResponse.statusCode, 405, 'handler rejects non-POST before invoking the saver');
  assert.equal(httpCalls.length, 0);
  const postResponse = response();
  await httpHandler({ method: 'POST', body: request(), user: { userName: 'tester' } }, postResponse);
  assert.equal(postResponse.statusCode, 200);
  assert.equal(postResponse.body.success, true);
  assert.equal(httpCalls[0].actor, 'tester', 'withAuth boundary passes the authenticated actor to the saver');

  const current = {
    ItemKey: 456, ItemName: '호접 · 화이트', Unit: '8스팀', Qty: 324,
    SalePrice: 20000, SaleAmount: 6480000, ProdKey: null, IsCustom: 0,
  };
  state.handler = async statement => {
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.master) return { recordset: [{ PnlKey: 123 }] };
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.item) return { recordset: [current] };
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.product) return { recordset: [{ ProdKey: 3170 }] };
    return { recordset: [] };
  };
  const saved = await api.saveShillaPnlProductMatch({ ...request(), actor: 'x'.repeat(80) });
  assert.deepEqual(saved, { changed: true, pnlKey: 123, itemKey: 456, prodKey: 3170 });
  const writes = state.calls.filter(call => /^\s*UPDATE\b/i.test(call.statement));
  assert.equal(writes.length, 2, 'match writes exactly the source-row ProdKey and scoped parent timestamp');
  assert.equal(writes[0].params.prodKey.value, 3170);
  assert.equal(writes[1].params.actor.value.length, 50, 'UpdatedBy NVARCHAR(50) receives a bounded actor');

  // Same saved mapping is a successful no-op: product can still be validated but no item/parent write occurs.
  current.ProdKey = 3170;
  state.calls.length = 0;
  const noop = await api.saveShillaPnlProductMatch({ ...request({ expected: expected({ prodKey: 3170 }) }), actor: 'tester' });
  assert.equal(noop.changed, false);
  assert.equal(state.calls.filter(call => /^\s*UPDATE\b/i.test(call.statement)).length, 0);

  // Unmatch skips Product SELECT and writes only the null ProdKey plus parent timestamp.
  current.ProdKey = 3170;
  state.calls.length = 0;
  const unmatched = await api.saveShillaPnlProductMatch({ ...request({ prodKey: null, expected: expected({ prodKey: 3170 }) }), actor: 'tester' });
  assert.equal(unmatched.changed, true);
  assert.equal(state.calls.some(call => call.statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.product), false);
  assert.equal(state.calls.find(call => call.statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.itemWrite).params.prodKey.value, null);

  // Scope execution fixture: a matching 2026/35/123 master is distinct from the
  // same MajorWeek in 2025, another PnlKey, and another ItemKey.
  current.ProdKey = null;
  state.handler = async (statement, params) => {
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.master) {
      const exact = params.yr.value === '2026' && params.major.value === 35 && params.pnlKey.value === 123;
      return { recordset: exact ? [{ PnlKey: 123 }] : [] };
    }
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.item) {
      return { recordset: params.itemKey.value === 456 ? [current] : [] };
    }
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.product) return { recordset: [{ ProdKey: 3170 }] };
    return { recordset: [] };
  };
  for (const [label, payload, code] of [
    ['prior-year same major', request({ orderYear: '2025' }), 'STALE_SCOPE'],
    ['wrong PnlKey', request({ pnlKey: 124 }), 'STALE_SCOPE'],
    ['wrong ItemKey', request({ itemKey: 457, expected: expected({ itemKey: 457 }) }), 'STALE_ITEM'],
  ]) {
    state.calls.length = 0;
    await assert.rejects(api.saveShillaPnlProductMatch(payload), error => error.code === code, label);
    assert.equal(state.calls.filter(call => /^\s*UPDATE\b/i.test(call.statement)).length, 0, `${label} must not write`);
  }

  // Each protected source field independently invalidates the snapshot; CostPrice is
  // deliberately absent from the source snapshot so independent cost edits may proceed.
  for (const [field, value] of Object.entries({
    ItemName: '호접 · 핑크', Unit: '단', Qty: 325, SalePrice: 20001, SaleAmount: 6480001, ProdKey: 3171,
  })) {
    state.calls.length = 0;
    state.handler = async (statement, params) => {
      if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.master) return { recordset: [{ PnlKey: 123 }] };
      if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.item) return { recordset: [{ ...current, [field]: value }] };
      if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.product) return { recordset: [{ ProdKey: 3170 }] };
      return { recordset: [] };
    };
    await assert.rejects(api.saveShillaPnlProductMatch(request()), error => error.code === 'STALE_ITEM', `${field} stale fixture`);
    assert.equal(state.calls.filter(call => /^\s*UPDATE\b/i.test(call.statement)).length, 0, `${field} stale fixture must not write`);
  }
  state.handler = async statement => {
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.master) return { recordset: [{ PnlKey: 123 }] };
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.item) return { recordset: [{ ...current, CostPrice: 999999 }] };
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.product) return { recordset: [{ ProdKey: 3170 }] };
    return { recordset: [] };
  };
  state.calls.length = 0;
  assert.equal((await api.saveShillaPnlProductMatch(request())).changed, true, 'CostPrice-only changes are outside the match snapshot');

  // The fake transaction stages the item write; a parent timestamp failure rolls it
  // back rather than leaving a partially mapped source row.
  state.committedItemProdKey = null;
  state.committedParentWrites = 0;
  state.failParentWrite = true;
  state.calls.length = 0;
  await assert.rejects(api.saveShillaPnlProductMatch(request()), /simulated parent write failure/);
  assert.equal(state.committedItemProdKey, null, 'parent failure rolls back the staged item ProdKey update');
  assert.equal(state.committedParentWrites, 0, 'parent failure is not committed');
  assert.ok(state.rolledBack > 0);
  state.failParentWrite = false;

  // Deleted Products still reject after an otherwise exact source-row lock.
  state.handler = async statement => {
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.master) return { recordset: [{ PnlKey: 123 }] };
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.item) return { recordset: [current] };
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.product) return { recordset: [] };
    return { recordset: [] };
  };
  await assert.rejects(api.saveShillaPnlProductMatch(request()), error => error.code === 'INVALID_PRODUCT');
  state.handler = async statement => {
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.master) return { recordset: [{ PnlKey: 123 }] };
    if (statement === api.SHILLA_PNL_PRODUCT_MATCH_SQL.item) return { recordset: [{ ...current, IsCustom: 1 }] };
    return { recordset: [] };
  };
  await assert.rejects(api.saveShillaPnlProductMatch(request({ prodKey: null, expected: expected({ isCustom: true }) })), error => error.code === 'CUSTOM_ITEM_NOT_MATCHABLE');

  const writeSql = [api.SHILLA_PNL_PRODUCT_MATCH_SQL.itemWrite, api.SHILLA_PNL_PRODUCT_MATCH_SQL.parentWrite].join('\n');
  assert.match(api.SHILLA_PNL_PRODUCT_MATCH_SQL.master, /OrderYear=@yr[\s\S]*MajorWeek=@major[\s\S]*PartnerCode='shilla'/);
  assert.match(api.SHILLA_PNL_PRODUCT_MATCH_SQL.master, /UPDLOCK, HOLDLOCK/);
  assert.match(api.SHILLA_PNL_PRODUCT_MATCH_SQL.product, /p\.isDeleted=0/);
  assert.match(api.SHILLA_PNL_PRODUCT_MATCH_SQL.product, /WITH \(HOLDLOCK\)/);
  for (const target of writeSql.matchAll(/\bUPDATE\s+([\w.]+)/gi)) assert.match(target[1], /^WebRaumPnl(?:Item)?$/);
  for (const forbidden of ['WebRaumItemMap', 'WebRaumCostPrice', 'Product', 'OrderDetail', 'ShipmentDetail', 'Estimate', 'StockHistory', 'WebProfitReport']) {
    assert.doesNotMatch(writeSql, new RegExp(`(?:UPDATE|INSERT|DELETE|MERGE)\\s+(?:dbo\\.)?${forbidden}`, 'i'));
  }
  assert.match(source, /withAuth/);
  assert.match(source, /req\.method !== 'POST'/);
  assert.match(source, /saveShillaPnlProductMatch/);
  assert.doesNotMatch(source, /saveRaumItemMap/);
  console.log('Shilla P&L row product-match tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

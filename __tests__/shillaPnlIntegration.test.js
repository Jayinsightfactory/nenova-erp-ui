const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');

function loadRaumPnl() {
  const filename = path.join(root, 'lib', 'raumPnl.js');
  const source = fs.readFileSync(filename, 'utf8');
  const state = {
    queryCalls: [],
    transactionCalls: [],
    learnedCalls: [],
    queryHandler: async () => ({ recordset: [] }),
    transactionHandler: async () => ({ recordset: [] }),
    lockResult: 0,
  };
  const partner = code => {
    const key = String(code == null || code === '' ? 'raum' : code).trim().toLowerCase();
    if (!['raum', 'choimun', 'shilla'].includes(key)) throw new Error('invalid partner');
    return { code: key, label: key === 'shilla' ? '신라호텔' : key, erpSync: key !== 'shilla' };
  };
  const mocks = {
    './db': {
      query: async (statement, params) => {
        state.queryCalls.push({ statement, params });
        return state.queryHandler(statement, params);
      },
      withTransaction: async callback => callback(async (statement, params) => {
        state.transactionCalls.push({ statement, params });
        if (/sp_getapplock/i.test(statement)) return { recordset: [{ LockResult: state.lockResult }] };
        return state.transactionHandler(statement, params);
      }),
      sql: new Proxy({}, { get: (_target, property) => String(property) }),
    },
    './parseMappings': { loadMappings: () => [], getMapping: () => null, findMappingFuzzy: () => null },
    './displayName': { scoreMatch: () => 0 },
    './catalogArrival': { getArrivalCostsWithFallback: async () => ({ map: {} }) },
    './catalogUnitMatch': { resolveCatalogArrivalDisplay: () => ({}) },
    './raumPnlMonthly': {
      normalizeRaumAssignedMonth: value => value,
      resolveRaumNenovaPct: (value, fallback = 80) => (value == null || value === '' ? fallback : Number(value)),
    },
    './raumPnlUploadDiff': { diffRaumPnlUpload: () => ({ hasChanges: false }) },
    './raumPnlCost': {
      learnManualRaumCost: async (...args) => { state.learnedCalls.push(args); },
      saveRaumConsignedRecord: async () => {},
      saveRaumItemMapRecord: async () => {},
    },
    './raumPnlConsignedCost': { fillConsignedCostsFromOrdinary: items => items },
    './raumPnlPartner': {
      resolvePnlPartner: partner,
      defaultPnlTitle: (code, major) => `${partner(code).label} ${Number(major)}차`,
    },
    './raumPnlParse': { parseRaumQuoteWorkbook: () => {}, parseRaumQuoteWorkbookGroups: () => {} },
  };

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
  return { api: loaded.exports, state };
}

function canonicalItem(overrides = {}) {
  return {
    name: '장미', unit: '단', qty: 1,
    price: 200, supply: 200, costPrice: 100,
    costSource: 'shilla', consigned: false,
    byBranch: { 신라호텔: 1 }, ...overrides,
  };
}

async function main() {
  const { api, state } = loadRaumPnl();

  assert.equal(api.requireExplicitShillaNenovaPct(0), 0, '명시적 0%는 기본값으로 바뀌면 안 된다.');
  assert.equal(api.requireExplicitShillaNenovaPct('0'), 0);
  assert.equal(api.requireExplicitShillaNenovaPct(100), 100);
  for (const invalid of [undefined, null, '', ' ', -1, 101, 'invalid']) {
    assert.throws(() => api.requireExplicitShillaNenovaPct(invalid), error =>
      ['SHILLA_PNL_RATIO_REQUIRED', 'SHILLA_PNL_RATIO_INVALID'].includes(error.code));
  }

  assert.throws(
    () => api.assertCanonicalShillaImportItems([{ name: '장미', buyPrice: 100, sellPrice: 200, sellAmount: 200 }]),
    error => error.code === 'SHILLA_PNL_CANONICAL_ITEM_REQUIRED',
    'raw parser 행은 API의 단일 canonical adapter를 거치지 않으면 저장할 수 없어야 한다.',
  );
  const zeroCanonical = canonicalItem({ price: 0, supply: 0, costPrice: 0 });
  assert.equal(api.assertCanonicalShillaImportItems([zeroCanonical])[0], zeroCanonical);

  const oldDifferentUnit = [{
    ItemName: '장미', Unit: '단', SalePrice: 200, SaleAmount: 200,
    CostPrice: 77, CostSource: 'manual', ProdKey: 10,
    IsCustom: 0, IsConsigned: 0, Seq: 1, Qty: 1,
  }];
  const shillaDifferentUnit = api.mergePnlImportedItems(
    [canonicalItem({ unit: '박스', costPrice: 120 })], oldDifferentUnit, 'shilla',
  );
  assert.equal(shillaDifferentUnit.items[0].costPrice, 120,
    'Shilla import identity는 단위를 포함해 다른 단위의 수동 비용을 가져오면 안 된다.');
  const raumExistingIdentity = api.mergePnlImportedItems(
    [canonicalItem({ unit: '박스', costPrice: 120 })], oldDifferentUnit, 'raum',
  );
  assert.equal(raumExistingIdentity.items[0].costPrice, 77,
    'Raum의 기존 품명+판매단가 identity 동작은 변경하지 않는다.');

  const sameNameTwoUnits = [
    { ...oldDifferentUnit[0], Unit: '단', CostPrice: 70 },
    { ...oldDifferentUnit[0], Unit: '박스', CostPrice: 80 },
  ];
  const preserved = api.mergePnlImportedItems([
    canonicalItem({ unit: '단', costPrice: 100 }),
    canonicalItem({ unit: '박스', costPrice: 110 }),
  ], sameNameTwoUnits, 'shilla');
  assert.deepEqual(preserved.items.map(item => item.costPrice), [70, 80],
    '재가져오기는 Shilla 단위별 기존 수동 비용을 보존해야 한다.');

  const preservedMapping = api.mergePnlImportedItems([
    canonicalItem({ name: '호접 · 화이트', unit: '8스팀', price: 20000, supply: 6480000, prodKey: null }),
  ], [{
    ItemName: '호접 · 화이트', Unit: '8스팀', SalePrice: 20000, SaleAmount: 6480000,
    CostPrice: 11233, CostSource: 'manual', ProdKey: 3170,
    IsCustom: 0, IsConsigned: 0, Seq: 1, Qty: 324,
  }], 'shilla');
  assert.equal(preservedMapping.items[0].prodKey, 3170,
    'row-scoped Shilla Product mapping survives exact reimport even when canonical incoming prodKey is null.');
  assert.equal(preservedMapping.items[0].unit, '8스팀', 'reimport never converts the original Shilla unit.');

  assert.equal(api.shouldLearnRaumPnlManualCost('shilla', canonicalItem({ costSource: 'manual' }), 0), false);
  assert.equal(api.shouldLearnRaumPnlManualCost('raum', canonicalItem({ costSource: 'manual' }), 0), true);

  await assert.rejects(
    api.saveRaumPnl({ partnerCode: 'shilla', orderYear: 2026, major: 7, items: [zeroCanonical] }),
    error => error.code === 'SHILLA_PNL_WHOLE_DOCUMENT_SAVE_BLOCKED',
  );
  assert.equal(state.queryCalls.length, 0, 'Shilla 일반 전체 저장 차단은 schema/DB 접근보다 먼저 실행되어야 한다.');

  const baseBatch = {
    orderYear: '2026', major: '07', partnerCode: 'shilla',
    verification: [{ ok: true }], items: [zeroCanonical], nenovaPct: 0,
  };
  await assert.rejects(
    api.saveRaumPnlImportBatch({ batches: [{ ...baseBatch, nenovaPct: null }] }),
    error => error.code === 'SHILLA_PNL_RATIO_REQUIRED',
  );
  assert.equal(state.queryCalls.length, 0, 'Shilla 비율 누락은 DB 접근 전에 거부되어야 한다.');

  state.lockResult = -1;
  await assert.rejects(api.saveRaumPnlImportBatch({ batches: [baseBatch] }), error => error.code === 'SHILLA_YEAR_LOCK_UNAVAILABLE');
  state.lockResult = 0;

  let masterInsert;
  let itemInsert;
  state.transactionHandler = async (statement, params) => {
    if (/SELECT \* FROM WebRaumPnl WITH/.test(statement)) return { recordset: [] };
    if (/INSERT INTO WebRaumPnl \(/.test(statement)) {
      masterInsert = { statement, params };
      return { recordset: [{ PnlKey: 51 }] };
    }
    if (/INSERT INTO WebRaumPnlItem/.test(statement)) itemInsert = { statement, params };
    return { recordset: [] };
  };
  const saved = await api.saveRaumPnlImportBatch({
    batches: [baseBatch], sourceFile: 'shilla.xlsx', actor: 'tester',
    expectedSnapshots: { 'shilla:2026-07': { version: 'new' } },
  });
  assert.equal(saved[0].pnlKey, 51);
  assert.equal(masterInsert.params.pct.value, 0, '신규 Shilla 마스터는 명시적 0%를 그대로 저장해야 한다.');
  assert.equal(itemInsert.params.cp.value, 0);
  assert.equal(itemInsert.params.sp.value, 0);
  assert.equal(itemInsert.params.sa.value, 0);
  assert.equal(state.learnedCalls.length, 0, 'Shilla import는 전역 WebRaumCostPrice 학습 경로를 호출하면 안 된다.');

  let existingUpdate;
  state.transactionHandler = async (statement, params) => {
    if (/SELECT \* FROM WebRaumPnl WITH/.test(statement)) {
      return { recordset: [{ PnlKey: 77, CreatedAt: 'stable-version', NenovaPct: 60 }] };
    }
    if (/SELECT \* FROM WebRaumPnlItem WITH/.test(statement)) return { recordset: [] };
    if (/UPDATE WebRaumPnl SET QuoteDate/.test(statement)) existingUpdate = { statement, params };
    return { recordset: [] };
  };
  await api.saveRaumPnlImportBatch({
    batches: [{ ...baseBatch, nenovaPct: 80 }], sourceFile: 'shilla-new.xlsx', actor: 'tester',
    expectedSnapshots: { 'shilla:2026-07': { version: '77:stable-version' } },
  });
  assert.doesNotMatch(existingUpdate.statement, /NenovaPct/, '재가져오기는 기존 Shilla 마스터 비율을 덮어쓰면 안 된다.');
  assert.equal(Object.prototype.hasOwnProperty.call(existingUpdate.params, 'pct'), false);
  assert.equal(state.learnedCalls.length, 0);

  // Preview and final save share the same unique-active mapping inference. The
  // candidate is a saved Shilla row only; other hotel/year, deleted Product and
  // a conflicting key never enter the pure helper's candidate result.
  const uploadBatch = {
    ...baseBatch,
    major: '08',
    items: [canonicalItem({ name: '송이 특', unit: '단', qty: 0, price: 0, supply: 0, prodKey: null })],
  };
  state.queryHandler = async statement => {
    if (statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.preview) {
      return { recordset: [{ OrderYear: '2026', ItemName: ' 송이  특 ', Unit: ' 단 ', IsCustom: 0, ProdKey: 181 }] };
    }
    return { recordset: [] };
  };
  const preview = await api.prepareRaumPnlImportPreview([uploadBatch]);
  assert.equal(preview.batches[0].items[0].prodKey, 181);
  assert.equal(preview.batches[0].autoMatchedCount, 1);
  assert.equal(preview.batches[0].items[0].qty, 0);
  assert.equal(preview.batches[0].items[0].unit, '단');

  let importedProdKey = null;
  state.transactionCalls.length = 0;
  state.transactionHandler = async (statement, params) => {
    if (statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.masters) return { recordset: [{ PnlKey: 70 }] };
    if (statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.items) {
      return { recordset: [{ ItemName: '송이 특', Unit: '단', IsCustom: 0, ProdKey: 181 }] };
    }
    if (statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.product) return { recordset: [{ ProdKey: params.prodKey.value }] };
    if (/SELECT \* FROM WebRaumPnl WITH/.test(statement)) return { recordset: [] };
    if (/INSERT INTO WebRaumPnl \(/.test(statement)) return { recordset: [{ PnlKey: 88 }] };
    if (/INSERT INTO WebRaumPnlItem/.test(statement)) importedProdKey = params.pk.value;
    return { recordset: [] };
  };
  const imported = await api.saveRaumPnlImportBatch({
    batches: preview.batches, sourceFile: 'shilla-unique.xlsx', actor: 'tester', expectedSnapshots: preview.snapshots,
  });
  assert.equal(importedProdKey, 181, 'unique active same-hotel mapping reaches the new upload only');
  assert.equal(imported[0].autoMatchedCount, 1);
  const lockIndex = state.transactionCalls.findIndex(call => call.statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.yearLock);
  const masterIndex = state.transactionCalls.findIndex(call => call.statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.masters);
  const itemsIndex = state.transactionCalls.findIndex(call => call.statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.items);
  const productIndex = state.transactionCalls.findIndex(call => call.statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.product);
  assert.ok(lockIndex < masterIndex && masterIndex < itemsIndex && itemsIndex < productIndex, 'import locking order is year → master → items → Product');

  // A different unique active candidate after preview changes the fingerprint;
  // the transaction aborts before INSERT/UPDATE, rather than guessing or
  // partially replacing the uploaded settlement.
  let staleWrite = false;
  state.transactionHandler = async (statement, params) => {
    if (statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.masters) return { recordset: [{ PnlKey: 70 }] };
    if (statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.items) return { recordset: [{ ItemName: '송이 특', Unit: '단', IsCustom: 0, ProdKey: 3170 }] };
    if (statement === api.SHILLA_HOTEL_IMPORT_MATCH_SQL.product) return { recordset: [{ ProdKey: params.prodKey.value }] };
    if (/SELECT \* FROM WebRaumPnl WITH/.test(statement)) return { recordset: [] };
    if (/INSERT|UPDATE|DELETE/i.test(statement)) staleWrite = true;
    return { recordset: [] };
  };
  await assert.rejects(api.saveRaumPnlImportBatch({
    batches: preview.batches, sourceFile: 'shilla-stale.xlsx', actor: 'tester', expectedSnapshots: preview.snapshots,
  }), /미리보기 이후 변경/);
  assert.equal(staleWrite, false, 'fingerprint mismatch has no partial write');

  console.log('Shilla P&L integration safety tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

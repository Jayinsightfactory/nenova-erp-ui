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
    transactionHandler: async () => ({ recordset: [] }),
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
        return { recordset: [] };
      },
      withTransaction: async callback => callback(async (statement, params) => {
        state.transactionCalls.push({ statement, params });
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
    costSource: 'shilla-excel', consigned: false,
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

  console.log('Shilla P&L integration safety tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

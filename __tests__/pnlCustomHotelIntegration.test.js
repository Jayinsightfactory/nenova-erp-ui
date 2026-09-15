const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const XLSX = require('xlsx');
const { transformSync } = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');
const HOTEL = {
  code: 'hotel_012345abcdef', kind: 'custom-hotel', customHotel: true,
  label: '테스트 호텔', custName: '테스트 호텔', defaultBranch: '테스트 호텔',
  sheetMode: 'single', erpSync: false, custLikeSql: '1=0', custLookupSql: '1=0',
};

function partner(code, descriptor = null) {
  const key = String(code == null || code === '' ? 'raum' : code).trim().toLowerCase();
  if (key === 'raum') return { code: 'raum', label: '라움', erpSync: true, sheetMode: 'branches', defaultBranch: null };
  if (key === 'choimun') return { code: 'choimun', label: '초이문', erpSync: true, sheetMode: 'single', defaultBranch: '초이문' };
  if (key === 'shilla') return { code: 'shilla', label: '신라호텔', erpSync: false, sheetMode: 'shilla', defaultBranch: '신라호텔' };
  if (descriptor?.kind === 'custom-hotel' && descriptor.code === key) return { ...descriptor };
  throw new Error('unknown hotel');
}

function loadRaumPnl(registry = async code => partner(code, HOTEL)) {
  const filename = path.join(root, 'lib', 'raumPnl.js');
  const state = {
    queryCalls: [], transactionCalls: [], learned: [], registryCalls: [],
    queryHandler: async () => ({ recordset: [] }), transactionHandler: async () => ({ recordset: [] }),
  };
  const mocks = {
    './db': {
      query: async (statement, params) => { state.queryCalls.push({ statement, params }); return state.queryHandler(statement, params); },
      withTransaction: async callback => callback(async (statement, params) => {
        state.transactionCalls.push({ statement, params });
        if (/SELECT TOP 1 PnlKey FROM WebRaumPnl WHERE/.test(statement)) return { recordset: [] };
        if (/INSERT INTO WebRaumPnl \(/.test(statement)) return { recordset: [{ PnlKey: 91 }] };
        return state.transactionHandler(statement, params);
      }),
      sql: new Proxy({}, { get: (_target, name) => String(name) }),
    },
    './parseMappings': { loadMappings: () => [], getMapping: () => null, findMappingFuzzy: () => null },
    './displayName': { scoreMatch: () => 0 },
    './catalogArrival': { getArrivalCostsWithFallback: async () => ({ map: {} }) },
    './catalogUnitMatch': { resolveCatalogArrivalDisplay: () => ({}) },
    './raumPnlMonthly': { normalizeRaumAssignedMonth: value => value, resolveRaumNenovaPct: value => Number(value ?? 80) },
    './raumPnlUploadDiff': { diffRaumPnlUpload: () => ({ hasChanges: false }) },
    './raumPnlCost': { learnManualRaumCost: async (...args) => state.learned.push(args), saveRaumConsignedRecord: async () => {}, saveRaumItemMapRecord: async () => {} },
    './raumPnlConsignedCost': { fillConsignedCostsFromOrdinary: items => items.map(item => ({ ...item, linked: true })) },
    './raumPnlPartner': { resolvePnlPartner: partner, defaultPnlTitle: (code, major, suffix = '', descriptor) => `${partner(code, descriptor).label} ${Number(major)}차${suffix}` },
    './pnlHotelRegistry': { requirePnlPartner: async (code, tQuery) => { state.registryCalls.push({ code, tQuery }); return registry(code, tQuery); } },
    './raumPnlParse': { parseRaumQuoteWorkbook: () => {}, parseRaumQuoteWorkbookGroups: () => {} },
  };
  const compiled = transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' } }).code;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = request => (Object.prototype.hasOwnProperty.call(mocks, request) ? mocks[request] : originalRequire(request));
  loaded._compile(compiled, filename);
  return { api: loaded.exports, state };
}

function customWorkbook() {
  const workbook = XLSX.utils.book_new();
  const rows = [];
  rows[0] = ['거래명세표'];
  rows[1] = ['일련번호', null, null, new Date(Date.UTC(2026, 8, 15, 12, 0, 0))];
  rows[14] = ['순번', '품목명', null, null, null, null, '원산지', null, null, '단위', '수량', '단가', null, null, '공급가액', '부가세', '적요'];
  rows[15] = [1, '장미', null, null, null, null, '', null, null, '단', 2, 3000, null, null, 6000, 600, ''];
  rows[16] = ['공급가액', null, 6000, null, 'VAT', 600, null, null, null, null, null, '합계', null, 6600];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '12차 견적');
  return workbook;
}

async function main() {
  const { resolvePnlPartner, defaultPnlTitle, canAutoCommitRaumPnlImport } = await import('../lib/raumPnlPartner.js');
  const { parseRaumQuoteWorkbookGroups } = await import('../lib/raumPnlParse.js');
  const parsed = parseRaumQuoteWorkbookGroups(XLSX, customWorkbook(), { partnerCode: HOTEL.code, partner: HOTEL });
  assert.equal(parsed.batches[0].partnerCode, HOTEL.code);
  assert.equal(parsed.batches[0].sheets[0].branch, HOTEL.label, 'custom standard quotation uses its registry branch label');
  assert.equal(defaultPnlTitle(HOTEL.code, 12, '', HOTEL), '테스트 호텔 12차');
  assert.throws(() => parseRaumQuoteWorkbookGroups(XLSX, customWorkbook(), { partnerCode: HOTEL.code, partner: { ...HOTEL, code: 'hotel_ffffffffffff' } }), /호텔 정보가 달라졌습니다/);
  const forgedBuiltin = resolvePnlPartner('raum', { ...HOTEL, code: 'raum', erpSync: false, customHotel: true });
  assert.equal(forgedBuiltin.customHotel, undefined, 'a forged builtin descriptor cannot make a builtin hotel custom');
  assert.notEqual(forgedBuiltin.custLikeSql, '1=0', 'a forged builtin descriptor cannot remove ERP capability');
  assert.equal(canAutoCommitRaumPnlImport([{ partnerCode: HOTEL.code, verification: [{ ok: true }], existingDiff: { hasChanges: false } }]), false, 'custom imports are always explicit multipart saves');

  const { api, state } = loadRaumPnl();
  assert.deepEqual(await api.lookupErpRefPrices([{ name: '장미', price: 3000 }], 12, '2026', HOTEL.code), {});
  assert.equal(state.queryCalls.length, 0, 'custom hotel never performs an ERP lookup');
  assert.equal(api.shouldLearnRaumPnlManualCost(HOTEL.code, { name: '장미', costSource: 'manual' }, 500, HOTEL), false);
  const merged = api.mergePnlImportedItems([{ name: '장미', unit: '단', qty: 2, price: 3000, supply: 6000, costPrice: null }], [{ ItemName: '장미', Unit: '단', Qty: 2, SalePrice: 3000, SaleAmount: 6000, CostPrice: 1200, CostSource: 'manual', IsCustom: 0, IsConsigned: 0, Seq: 1 }], HOTEL.code, { partnerDescriptor: HOTEL });
  assert.equal(merged.items[0].costPrice, 1200, 're-import preserves only this settlement\'s manual cost');
  assert.equal(merged.items[0].linked, undefined, 'custom rows do not receive consigned-cost propagation');
  assert.throws(() => api.mergePnlImportedItems(
    [{ name: '장미', unit: '단', qty: 2, price: 3000, supply: 6000, remark: '12차 견적!A16' }],
    [
      { ItemName: '장미', Unit: '단', Qty: 2, SalePrice: 3000, SaleAmount: 6000, CostPrice: 1200, CostSource: 'manual', IsCustom: 0, IsConsigned: 0 },
      { ItemName: '장미', Unit: '단', Qty: 2, SalePrice: 3000, SaleAmount: 6000, CostPrice: 1300, CostSource: 'manual', IsCustom: 0, IsConsigned: 0 },
    ], HOTEL.code, { partnerDescriptor: HOTEL, orderYear: '2026', major: '12' },
  ), error => error.code === 'PRESERVATION_COLLISION' && /테스트 호텔 · 2026년 · 12차/.test(error.message) && /12차 견적!A16/.test(error.message), 'preview/save collision guidance includes hotel, year, major and original source');

  const pnlKey = await api.saveRaumPnl({ partnerCode: HOTEL.code, orderYear: '2026', major: '12', title: 'forged title', nenovaPct: 80, verification: [], items: [{ seq: 1, name: '장미', unit: '단', qty: 2, price: 3000, supply: 6000, costPrice: 1200, costSource: 'manual', prodKey: 777 }] });
  assert.equal(pnlKey, 91, 'initial custom upload/detail manual-save uses the normal save core');
  assert.equal(state.registryCalls.length >= 2, true, 'save revalidates the active registry descriptor inside its transaction');
  assert.equal(state.learned.length, 0, 'custom manual costs never update global learned costs');
  const insert = state.transactionCalls.find(call => /INSERT INTO WebRaumPnl \(/.test(call.statement));
  assert.equal(insert.params.title.value, '테스트 호텔 12차', 'server registry label overrides a forged client title');
  assert.doesNotMatch(state.transactionCalls.map(call => call.statement).join('\n'), /WebRaumCostPrice|WebRaumItemMap|WebRaumConsignedItem|\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?Product\b/i, 'caller Product keys stay row-scoped and cannot trigger global writes');

  const rejected = loadRaumPnl(async () => { const error = new Error('unknown'); error.code = 'PNL_PARTNER_UNKNOWN'; throw error; });
  await assert.rejects(rejected.api.saveRaumPnl({ partnerCode: 'hotel_ffffffffffff', orderYear: '2026', major: '12', items: [{}] }), error => error.code === 'PNL_PARTNER_UNKNOWN');
  assert.equal(rejected.state.queryCalls.length, 0);
  assert.equal(rejected.state.transactionCalls.length, 0, 'unregistered custom code is rejected before settlement mutation');
  const invalidYear = loadRaumPnl();
  await assert.rejects(invalidYear.api.saveRaumPnl({ partnerCode: HOTEL.code, orderYear: '26', major: '12', items: [{}] }), error => error.code === 'PNL_CUSTOM_HOTEL_YEAR_REQUIRED');
  assert.equal(invalidYear.state.queryCalls.length, 0, 'custom normal save validates a strict year before settlement writes');
  const invalidImportYear = loadRaumPnl();
  await assert.rejects(invalidImportYear.api.saveRaumPnlImportBatch({ batches: [{ partnerCode: HOTEL.code, orderYear: '26', major: '12', verification: [{ ok: true }], items: [{ name: '장미' }] }] }), error => error.code === 'PNL_IMPORT_YEAR_REQUIRED');
  assert.equal(invalidImportYear.state.queryCalls.length, 0);
  assert.equal(invalidImportYear.state.transactionCalls.length, 0, 'custom batch save validates a strict import year before settlement writes');

  const builtinAgainstCustom = loadRaumPnl();
  builtinAgainstCustom.state.queryHandler = async statement => (/SELECT \* FROM WebRaumPnl WHERE/.test(statement)
    ? { recordset: [{ PnlKey: 44, PartnerCode: HOTEL.code, OrderYear: '2026' }] }
    : { recordset: [] });
  await assert.rejects(builtinAgainstCustom.api.loadRaumPnlDetail(44, { partnerCode: 'raum' }), error => error.code === 'PNL_CUSTOM_HOTEL_MASTER_MISMATCH');
  builtinAgainstCustom.state.transactionHandler = async statement => (/SELECT TOP 1 PnlKey, (?:OrderYear, )?PartnerCode FROM WebRaumPnl WITH/.test(statement)
    ? { recordset: [{ PnlKey: 44, PartnerCode: HOTEL.code, OrderYear: '2026' }] }
    : { recordset: [] });
  await assert.rejects(builtinAgainstCustom.api.assignRaumPnlMonth(44, '2026-09', 'tester', { partnerCode: 'raum' }), error => error.code === 'PNL_CUSTOM_HOTEL_MASTER_MISMATCH');
  await assert.rejects(builtinAgainstCustom.api.deleteRaumPnl(44, 'tester', { partnerCode: 'raum' }), error => error.code === 'PNL_CUSTOM_HOTEL_MASTER_MISMATCH');
  assert.doesNotMatch([...builtinAgainstCustom.state.queryCalls, ...builtinAgainstCustom.state.transactionCalls].map(call => call.statement).join('\n'), /UPDATE WebRaumPnl SET (?:AssignedMonth|isDeleted)/, 'a builtin request cannot read or mutate a custom P&L master');
  assert.doesNotMatch(builtinAgainstCustom.state.queryCalls.map(call => call.statement).join('\n'), /SELECT i\.\*, p\.ProdName AS MatchedProdName/, 'detail rejects the custom master before loading its item rows');
  for (const actualCode of ['choimun', 'shilla']) {
    const otherHotel = loadRaumPnl();
    const master = { PnlKey: 44, PartnerCode: actualCode, OrderYear: '2026' };
    otherHotel.state.queryHandler = async statement => (/SELECT \* FROM WebRaumPnl WHERE/.test(statement) ? { recordset: [master] } : { recordset: [] });
    otherHotel.state.transactionHandler = async statement => (/SELECT TOP 1 PnlKey, (?:OrderYear, )?PartnerCode FROM WebRaumPnl WITH/.test(statement) ? { recordset: [master] } : { recordset: [] });
    const mismatch = error => error.code === 'PNL_CUSTOM_HOTEL_MASTER_MISMATCH';
    await assert.rejects(otherHotel.api.loadRaumPnlDetail(44, { partnerCode: 'raum' }), mismatch);
    await assert.rejects(otherHotel.api.assignRaumPnlMonth(44, '2026-09', 'tester', { partnerCode: 'raum' }), mismatch);
    await assert.rejects(otherHotel.api.deleteRaumPnl(44, 'tester', { partnerCode: 'raum' }), mismatch);
    assert.doesNotMatch([...otherHotel.state.queryCalls, ...otherHotel.state.transactionCalls].map(call => call.statement).join('\n'), /UPDATE WebRaumPnl SET (?:AssignedMonth|isDeleted)|SELECT i\.\*, p\.ProdName AS MatchedProdName/, 'builtin hotels must also match the selected master exactly');
  }
  console.log('Custom hotel P&L integration tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DistributionBaselineReconciliationError, reconcileDistributionBaseline } = require('../lib/distributionBaselineReconcile');
const source = fs.readFileSync(require.resolve('../pages/api/orders/distribution-baseline-reconciliation.js'), 'utf8');

function baseline({ week = '37-01', coverage = 'single' } = {}) {
  return { id: 'a'.repeat(64), year: '2026', week, coverage, parsed: { sheets: [{ id: 'sheet-a', name: '기준', rows: [{ id: 'sheet-a!A4', label: '품목', key: 11, values: { 'sheet-a!B3': 2 } }], clients: [{ id: 'sheet-a!B3', label: '업체', day: '목', key: 21 }] }] } };
}

function compile(deps) {
  const code = source
    .replace("import { query, sql } from '../../../lib/db';", 'const { query, sql } = deps.db;')
    .replace("import { withAuth } from '../../../lib/auth';", 'const { withAuth } = deps.auth;')
    .replace("const store = require('../../../lib/distributionBaselineStore');", 'const store = deps.store;')
    .replace("const { DistributionBaselineReconciliationError, reconcileDistributionBaseline } = require('../../../lib/distributionBaselineReconcile');", 'const { DistributionBaselineReconciliationError, reconcileDistributionBaseline } = deps.reconcile;')
    .replace('export const config', 'const config')
    .replace('export default withAuth', 'module.exports = withAuth');
  const module = { exports: null };
  vm.runInNewContext(code, { module, deps, Date, String, Number, Array, Set, Map, Object, URL, Promise });
  return module.exports;
}

function response() { return { headers: {}, statusCode: 200, body: null, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }

function deps({ stored = baseline(), currentRows = null, malformedCurrent = false } = {}) {
  const calls = [];
  const current = currentRows || [{ year: '2026', week: stored.week, custKey: 21, prodKey: 11, SdetailKey: 31, SdateKey: 41, shipmentDate: '2026-09-10', qty: 3, unit: '박스' }];
  return {
    db: { sql: { NVarChar: 'NVarChar' }, query: async (text, params) => {
      calls.push({ text, params });
      if (/FROM Product/.test(text)) return { recordset: [{ ProdKey: 11, ProdName: '품목', DisplayName: '품목', CounName: '콜롬비아', FlowerName: '카네이션', OutUnit: '박스', BunchOf1Box: 10, SteamOf1Box: 100 }] };
      if (/FROM Customer/.test(text)) return { recordset: [{ CustKey: 21, CustName: '업체' }] };
      return malformedCurrent ? {} : { recordset: current };
    } },
    auth: { withAuth: handler => handler }, store: { getBaseline: async input => { assert.equal(input.id, stored.id); return stored; } },
    reconcile: { DistributionBaselineReconciliationError, reconcileDistributionBaseline }, calls,
  };
}

async function invoke(options = {}, body = { year: '2026', week: '37-01', baselineId: 'a'.repeat(64), bindings: {} }) {
  const d = deps(options), res = response();
  await compile(d)({ method: 'POST', headers: {}, body }, res);
  return { res, calls: d.calls };
}

(async () => {
  const { res, calls } = await invoke();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.advisoryOnly, true);
  assert.deepEqual(JSON.parse(JSON.stringify(res.body.baseline)), { id: 'a'.repeat(64), year: '2026', week: '37-01', coverage: 'single' });
  assert.deepEqual(JSON.parse(JSON.stringify(res.body.scope.weeks)), ['37-01']);
  assert.equal(res.body.scope.currentComplete, true);
  assert.equal(res.body.catalog.products[0].CounName, '콜롬비아');
  assert.equal(res.body.catalog.products[0].FlowerName, '카네이션');
  assert.equal(res.body.sheets[0].cells[0].delta, null, 'empty bindings are discovery only');
  assert.equal(calls.length, 3);
  const currentCall = calls.find(call => /FROM ViewShipment/.test(call.text));
  assert.match(currentCall.text, /TOP 10001/);
  assert.match(currentCall.text, /v\.OrderYear=@year/);
  assert.match(currentCall.text, /v\.OrderWeek IN \(@w1,@w2\)/);
  assert.equal(currentCall.params.year.value, '2026');
  assert.equal(currentCall.params.w1.value, '37-01');

  const confirmedBindings = {
    sheetScopes: { 'sheet-a': { confirmed: true, groups: [{ country: '콜롬비아', flower: '카네이션' }] } },
    keymapBatch: { 'sheet-a': { confirmRows: true, confirmClients: true } },
    rowOverrides: {}, columnOverrides: {},
    dateGroups: [{ columnIds: ['sheet-a!B3'], shipmentDate: '2026-09-10', confirmed: true }],
    columnDateOverrides: {}, unitAttestation: { originalExportUnitsPreserved: true }, rowUnitOverrides: {},
  };
  const { res: confirmedResponse } = await invoke({}, { year: '2026', week: '37-01', baselineId: 'a'.repeat(64), bindings: confirmedBindings });
  assert.equal(confirmedResponse.statusCode, 200);
  assert.equal(confirmedResponse.body.sheets[0].cells[0].delta, 1);
  const pureProjection = reconcileDistributionBaseline({ baseline: baseline(), bindings: confirmedBindings, products: confirmedResponse.body.catalog.products, customers: confirmedResponse.body.catalog.customers, currentRows: [{ year: '2026', week: '37-01', custKey: 21, prodKey: 11, SdetailKey: 31, SdateKey: 41, shipmentDate: '2026-09-10', qty: 3, unit: '박스' }], currentComplete: true });
  assert.deepEqual(Object.keys(pureProjection).sort(), ['issues', 'sheetCandidates', 'sheets', 'unclassifiedCurrent']);
  assert.equal(pureProjection.sheets[0].cells[0].delta, confirmedResponse.body.sheets[0].cells[0].delta);

  const combined = baseline({ week: '37-02', coverage: 'combined' });
  const { res: combinedResponse, calls: combinedCalls } = await invoke({ stored: combined }, { year: '2026', week: '37-02', baselineId: 'a'.repeat(64), bindings: {} });
  assert.equal(combinedResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(combinedResponse.body.scope.weeks)), ['37-01', '37-02']);
  const combinedCurrent = combinedCalls.find(call => /FROM ViewShipment/.test(call.text));
  assert.equal(combinedCurrent.params.w1.value, '37-01');
  assert.equal(combinedCurrent.params.w2.value, '37-02');

  const tooMany = Array.from({ length: 10001 }, (_, index) => ({ year: '2026', week: '37-01', custKey: 21, prodKey: 11, SdetailKey: index, SdateKey: index, shipmentDate: '2026-09-10', qty: 1, unit: '박스' }));
  const { res: limitResponse } = await invoke({ currentRows: tooMany });
  assert.equal(limitResponse.statusCode, 422);
  assert.equal(limitResponse.body.error.code, 'CURRENT_RESULT_LIMIT_EXCEEDED');
  assert.equal(limitResponse.body.scope.currentComplete, false);
  assert.equal('sheets' in limitResponse.body, false);

  const d = deps(); const originResponse = response();
  await compile(d)({ method: 'POST', headers: { origin: 'https://elsewhere.example', host: 'nenova.example' }, body: { year: '2026', week: '37-01', baselineId: 'a'.repeat(64) } }, originResponse);
  assert.equal(originResponse.statusCode, 403);
  assert.equal(originResponse.body.error.code, 'ORIGIN_MISMATCH');
  assert.equal(d.calls.length, 0);

  const { res: malformedResponse } = await invoke({ malformedCurrent: true });
  assert.equal(malformedResponse.statusCode, 503);
  assert.equal(malformedResponse.body.error.code, 'CURRENT_QUERY_MALFORMED');

  const { res: upperIdResponse } = await invoke({}, { year: '2026', week: '37-01', baselineId: 'A'.repeat(64), bindings: {} });
  assert.equal(upperIdResponse.statusCode, 400);
  assert.equal(upperIdResponse.body.error.code, 'INVALID_BASELINE_ID');

  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|MERGE|EXEC)\b/i);
  assert.doesNotMatch(source, /Anthropic|baselineStore\.create|withTransaction|lease/i);
  console.log('distribution baseline reconciliation API tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

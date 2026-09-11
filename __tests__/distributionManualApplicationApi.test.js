const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../pages/api/orders/distribution-manual-applications.js'), 'utf8');
const calls = [];
const deps = {
  withAuth: handler => handler,
  store: {
    listApplications: async input => { calls.push(['GET', input]); return [{ sourceIdentity: 'message-1', status: 'CLEAR' }]; },
    recordApplication: async (input, user) => { calls.push(['POST', input, user]); return { sourceIdentity: input.sourceIdentity, status: input.status, advisoryOnly: true, erpAction: 'NONE' }; },
  },
};
const box = { module: { exports: null } };
vm.runInNewContext(source.replace(/import \{ withAuth \}[^;]+;/, 'const {withAuth}=deps;').replace("const store = require('../../../lib/distributionManualApplicationStore');", 'const store=deps.store;').replace('export const config', 'const config').replace('export default', 'module.exports='), { module: box.module, deps, URL, String, Array });
function response() { return { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }

(async () => {
  let res = response(); await box.module.exports({ method: 'GET', user: { accountActive: true }, query: { year: '2026', week: '37-99' }, headers: {} }, res);
  assert.equal(res.code, 200); assert.equal(res.body.applications[0].status, 'CLEAR'); assert.deepEqual(calls[0][1], { year: '2026', week: '37-99' });
  const body = { year: '2026', week: '37-99', sourceIdentity: 'message-1', status: 'MANUALLY_APPLIED', memo: '직접 적용', requestId: '550e8400-e29b-41d4-a716-446655440000', expectedCurrentEventId: null };
  res = response(); await box.module.exports({ method: 'POST', user: { accountActive: true, userId: 'u1' }, body, headers: {} }, res);
  assert.equal(res.code, 201); assert.equal(res.body.application.sourceIdentity, 'message-1'); assert.equal(calls[1][1].expectedCurrentEventId, null);
  res = response(); await box.module.exports({ method: 'DELETE', user: { accountActive: true }, headers: {} }, res); assert.equal(res.code, 405);
  res = response(); await box.module.exports({ method: 'POST', user: { accountActive: false }, body, headers: {} }, res); assert.equal(res.code, 403);
  console.log('distribution manual application API tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

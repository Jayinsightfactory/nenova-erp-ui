import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { isAdminUser, hasFullWebAccess } from '../lib/userAccess.js';
import { readInvoiceReceiptEligibility } from '../lib/invoiceReceiptEligibility.js';

const source = await fs.readFile(new URL('../pages/api/import/receipts/eligibility.js', import.meta.url), 'utf8');
const sandbox = { isAdminUser, hasFullWebAccess, readInvoiceReceiptEligibility, query: () => { throw Error('unexpected default query'); }, sql: {} };
vm.runInNewContext(source.replace(/^import .*;\r?$/gm, '').replace(/export default withAuth\(createEligibilityHandler\(\)\);/, '')
  .replace(/export /g, '') + '\nthis.create = createEligibilityHandler;', sandbox);
const types = { Int: 'Int', NVarChar: 'NVarChar' };
const user = { userId: 'import-user', deptName: '수입부', authority: 5 };
const body = { orderYear: '2026', orderWeek: '41-01', prodKeys: [1] };
const snapshot = { recordsets: [[{ ProdKey: 1, ProdName: 'Rose', CountryFlower: '중국 장미', isDeleted: 0 }],
  [{ CurrentYearWeek: '20264101', PreviousYearWeek: null, NextYearWeek: null }], []] };
async function call(overrides = {}, queryFn = async () => snapshot) {
  const res = { headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.statusCode=n; return this; },
    json(data) { this.data=data; return this; } };
  await sandbox.create({ queryFn, types })({ method: 'POST', user, body, ...overrides }, res);
  return res;
}
test('authenticated write-eligible preview is explicitly not an ERP commit', async () => {
  assert.match(source, /export default withAuth\(createEligibilityHandler\(\)\)/);
  const r = await call();
  assert.equal(r.statusCode, 200);
  assert.equal(r.data.eligibility.canProceed, true);
  assert.equal(r.data.commitAvailable, false);
  assert.equal(r.data.erpWritePerformed, false);
  assert.equal(r.headers['Cache-Control'], 'no-store');
});
test('method, inactive/missing/unauthorized account fail before SQL', async () => {
  const never = async () => { assert.fail('must not query'); };
  assert.equal((await call({ method: 'GET' }, never)).statusCode, 405);
  for (const denied of [undefined, {}, { ...user, accountActive: false }, { ...user, deptName: '영업부' },
    { userId: 'sales', authority: null }, { userId: 'sales', authority: '' }]) {
    assert.equal((await call({ user: denied }, never)).statusCode, 403);
  }
});
test('invalid scope does not query; SQL failure is not success and leaks no details', async () => {
  assert.equal((await call({ body: { ...body, orderYear: null } }, async () => assert.fail('query'))).statusCode, 400);
  const r = await call({}, async () => { throw Error('internal SQL server or credentials'); });
  assert.equal(r.statusCode, 503);
  assert.equal(r.data.success, false);
  assert.equal(r.data.commitAvailable, false);
  assert.doesNotMatch(JSON.stringify(r.data), /internal SQL|credentials/);
});
test('body cannot grant authority or change the authenticated account', async () => {
  const r = await call({ user: { userId: 'sales', authority: 5, deptName: '영업부' },
    body: { ...body, authority: 1, userId: 'nenovaSS3', deptName: '수입부', countryFlowers: ['all'] } },
  async () => assert.fail('unauthorized query'));
  assert.equal(r.statusCode, 403);
});
test('a detected native blocker is a successful check, not permission to commit', async () => {
  const blocked = structuredClone(snapshot);
  blocked.recordsets[2].push({ Phase: 'CURRENT_FIXED', OrderYearWeek: '20264101',
    CountryFlower: '중국 장미', ProdKey: 2, ProdName: 'Other rose' });
  const r = await call({}, async () => blocked);
  assert.equal(r.statusCode, 200);
  assert.equal(r.data.eligibility.canProceed, false);
  assert.equal(r.data.commitAvailable, false);
  assert.equal(r.data.eligibility.blockers[0].prodKey, 2);
});

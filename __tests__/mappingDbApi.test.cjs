const assert = require('node:assert/strict');
const fs = require('node:fs');
function route(file, deps) {
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace('export default withAuth(', 'return withAuth(');
  const withAuth = handler => async (req, res) => {
    try { return await handler(req, res); }
    catch { return res.status(500).json({ success: false, error: 'server error' }); }
  };
  return Function(...Object.keys(deps), 'withAuth', 'console', source)(...Object.values(deps), withAuth, { error() {} });
}
async function call(handler, method, account, body = {}, query = {}) {
  let status = 200, response;
  await handler({ method, body, query, user: { userId: account } }, {
    setHeader() {}, status(code) { status = code; return this; },
    json(value) { response = value; return this; }, end() {},
  });
  return { status, ...response };
}
(async () => {
  const { mappingStoreFixture } = await import('./helpers/mappingStoreFixture.js');
  const names = await import('../lib/pasteMappingNames.js');
  const pure = await import('../lib/pasteMappingMatch.js');
  const f = mappingStoreFixture();
  const deps = { ...names, ...pure, ...f.products, ...f.customers, ...f.scoped,
    sql: { Int: 'int' }, query: async statement => ({ recordset: statement.includes('FROM Customer')
      ? [{ CustKey: 7, CustName: '현재 업체명' }] : [{ ProdKey: 8, ProdName: 'CURRENT PRODUCT', DisplayName: null }] }) };
  const customers = route('pages/api/orders/customer-mappings.js', deps);
  const products = route('pages/api/orders/mappings.js', deps);
  assert.equal((await call(customers, 'POST', 'account-a', { inputToken: '원문업체', custKey: 7, custName: '옛 이름' })).success, true);
  const customerRead = await call(customers, 'GET', 'account-b');
  assert.equal(customerRead.mappings['원문업체'].custKey, 7);
  assert.equal(customerRead.mappings['원문업체'].custName, '현재 업체명');
  assert.equal(f.documents.customer['원문업체'].custName, '옛 이름');
  assert.equal((await call(products, 'POST', 'account-a', { inputToken: '원문품목', prodKey: 8, prodName: 'old', manual: true, unit: '송이' })).success, true);
  const read = await call(products, 'GET', 'account-b');
  assert.equal(read.mappings['원문품목'].prodKey, 8);
  assert.equal(read.mappings['원문품목'].prodName, 'CURRENT PRODUCT');
  assert.equal(read.mappings['원문품목'].unit, '송이');
  assert.equal((await call(products, 'POST', 'account-b', { inputToken: '원문품목', prodKey: 9, manual: false, force: true })).status, 409);
  assert.equal((await call(products, 'POST', 'account-a', { inputToken: '업체품목', prodKey: 8, custKey: 7, manual: true })).success, true);
  assert.equal((await call(products, 'GET', 'account-b', {}, { custKey: 7 })).mappings['업체품목'].mappingScope, 'customer');
  assert.equal(f.documents['customer-product']['7'].history[0].actor, 'account-a');
  assert.equal((await call(products, 'DELETE', 'account-b', {}, { key: '원문품목' })).success, true);
  assert.equal((await call(products, 'GET', 'account-a')).mappings['원문품목'], undefined);
  const failed = route('pages/api/orders/mappings.js', { ...deps, loadMappings: async () => { throw Error('DB unavailable'); } });
  assert.equal((await call(failed, 'GET', 'account-b')).status, 500);
  assert.equal((await call(failed, 'POST', 'account-a', { inputToken: '실패', prodKey: 1 })).status, 500);
  assert.equal(f.documents.product['실패'], undefined);
  console.log('Mapping API tests passed: two account identities share saved mappings, scoped history, current names, delete and DB failures.');
})().catch(error => { console.error(error); process.exitCode = 1; });

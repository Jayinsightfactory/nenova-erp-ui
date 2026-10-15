'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function route(file, dependencies) {
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace('export default withAuth(', 'globalThis.handler = withAuth(');
  const context = { ...dependencies, withAuth: fn => fn, console: { error() {} } };
  vm.runInNewContext(source, context, { filename: file });
  return context.handler;
}
async function run(handler, query = {}) {
  const headers = {};
  let status = 200, body;
  const res = {
    setHeader(key, value) { headers[key] = value; },
    status(code) { status = code; return this; },
    json(value) { body = value; return this; },
  };
  await handler({ method: 'GET', query }, res);
  return { status, body, headers };
}

(async () => {
  const helpers = await import(pathToFileURL(path.resolve('lib/pasteMappingNames.js')).href);
  const customerSaved = { 매일: { custKey: 538, custName: '날마다, 꽃', savedAt: 'old' } };
  let customerQueryCount = 0;
  const customer = route('pages/api/orders/customer-mappings.js', {
    query: async (statement, params) => {
      customerQueryCount += 1;
      assert.match(statement, /SELECT CustKey, CustName FROM Customer/);
      assert.match(statement, /WHERE isDeleted=0 AND CustKey IN/);
      assert.equal(params.id0.value, 538);
      return { recordset: [{ CustKey: 538, CustName: '날마다, 꽃（매일）' }] };
    }, sql: { Int: 'int' }, loadCustomerMappings: () => customerSaved,
    readActiveCustomerNames: helpers.readActiveCustomerNames,
    hydrateCustomerMappings: helpers.hydrateCustomerMappings,
  });
  const customerResult = await run(customer);
  assert.equal(customerResult.status, 200);
  assert.equal(customerResult.headers['Cache-Control'], 'no-store');
  assert.equal(customerResult.body.mappings.매일.custName, '날마다, 꽃（매일）');
  assert.equal(customerResult.body.mappings.매일.custKey, 538);
  assert.equal(customerSaved.매일.custName, '날마다, 꽃');
  assert.equal(customerQueryCount, 1);

  const productSaved = { 수국: { prodKey: 21, prodName: 'old', displayName: 'old display', manual: true } };
  let productQueryCount = 0;
  const product = route('pages/api/orders/mappings.js', {
    query: async (statement, params) => {
      productQueryCount += 1;
      assert.match(statement, /SELECT ProdKey, ProdName, DisplayName FROM Product/);
      assert.match(statement, /WHERE isDeleted=0 AND ProdKey IN/);
      assert.equal(params.id0.value, 21);
      return { recordset: [{ ProdKey: 21, ProdName: 'new', DisplayName: null }] };
    }, sql: { Int: 'int' }, loadMappings: () => productSaved,
    mergeCustomerProductMappings: mappings => mappings,
    readActiveProductNames: helpers.readActiveProductNames,
    hydrateProductMappings: helpers.hydrateProductMappings,
  });
  const productResult = await run(product);
  assert.equal(productResult.status, 200);
  assert.equal(productResult.body.mappings.수국.prodName, 'new');
  assert.equal(productResult.body.mappings.수국.displayName, null);
  assert.equal(productResult.body.mappings.수국.manual, true);
  assert.equal(productQueryCount, 1);

  const failingCustomer = route('pages/api/orders/customer-mappings.js', {
    query: async () => { throw new Error('read failed'); }, sql: { Int: 'int' },
    loadCustomerMappings: () => customerSaved,
    readActiveCustomerNames: helpers.readActiveCustomerNames,
    hydrateCustomerMappings: helpers.hydrateCustomerMappings,
  });
  const failure = await run(failingCustomer);
  assert.equal(failure.status, 500);
  assert.equal(failure.body.success, false);
  assert.equal(customerSaved.매일.custName, '날마다, 꽃');
  const failingProduct = route('pages/api/orders/mappings.js', {
    query: async () => { throw new Error('read failed'); }, sql: { Int: 'int' },
    loadMappings: () => productSaved,
    mergeCustomerProductMappings: mappings => mappings,
    readActiveProductNames: helpers.readActiveProductNames,
    hydrateProductMappings: helpers.hydrateProductMappings,
  });
  const productFailure = await run(failingProduct);
  assert.equal(productFailure.status, 500);
  assert.equal(productFailure.body.success, false);
  assert.equal(productSaved.수국.prodName, 'old');
  console.log('paste mapping current-name API tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });

import assert from 'node:assert/strict';
import {
  hydrateCustomerMappings, hydrateProductMappings, mappingKeys,
  readActiveCustomerNames, readActiveProductNames,
} from '../lib/pasteMappingNames.js';

const originalCustomers = {
  매일: { custKey: 538, custName: '날마다, 꽃', custArea: '서울', savedAt: '2026-06-04', manual: true },
  미우: { custKey: '456', custName: '아이엠', savedAt: '2026-06-04' },
  삭제: { custKey: 999, custName: '저장명', savedAt: '2025-01-01' },
  무효: { custKey: 0, custName: '그대로' },
};
const customers = [
  { CustKey: 538, CustName: '날마다, 꽃（매일）' },
  { CustKey: 456, CustName: '아이엠（미우）' },
  { CustKey: 999, CustName: '삭제된 이름', isDeleted: 1 },
];
const hydratedCustomers = hydrateCustomerMappings(originalCustomers, customers);
assert.equal(hydratedCustomers.매일.custName, '날마다, 꽃（매일）');
assert.equal(hydratedCustomers.미우.custName, '아이엠（미우）');
assert.equal(hydratedCustomers.삭제.custName, '저장명');
assert.equal(hydratedCustomers.무효.custName, '그대로');
assert.deepEqual({ ...hydratedCustomers.매일, custName: originalCustomers.매일.custName }, originalCustomers.매일);
assert.equal(originalCustomers.매일.custName, '날마다, 꽃');
assert.deepEqual(mappingKeys(originalCustomers, 'custKey'), [538, 456, 999]);

const originalProducts = {
  수국: { prodKey: 21, prodName: 'OLD', displayName: '옛이름', unit: '단', qty: 5,
    cost: 20, manual: true, savedAt: '2025-41-02', mappingScope: 'customer' },
  장미: { prodKey: '22', prodName: 'OLD2', displayName: '옛 표시명', savedAt: '2026-41-02' },
  미존재: { prodKey: 99, prodName: '저장 이름', displayName: '저장 표시명' },
};
const products = [
  { ProdKey: 21, ProdName: 'NEW', DisplayName: null },
  { ProdKey: 22, ProdName: 'NEW2', DisplayName: '' },
  { ProdKey: 99, ProdName: 'deleted', DisplayName: 'deleted', isDeleted: 1 },
  { ProdKey: 23, ProdName: 'NEW', DisplayName: 'same-name-other-key' },
];
const hydratedProducts = hydrateProductMappings(originalProducts, products);
assert.equal(hydratedProducts.수국.prodName, 'NEW');
assert.equal(hydratedProducts.수국.displayName, null);
assert.equal(hydratedProducts.장미.displayName, '');
assert.equal(hydratedProducts.미존재.prodName, '저장 이름');
assert.equal(hydratedProducts.수국.prodKey, 21);
assert.deepEqual({ ...hydratedProducts.수국, prodName: originalProducts.수국.prodName,
  displayName: originalProducts.수국.displayName }, originalProducts.수국);
assert.equal(originalProducts.수국.displayName, '옛이름');

const calls = [];
const query = async (statement, params) => {
  calls.push({ statement, params });
  assert.match(statement, /^SELECT /);
  return { recordset: statement.includes('FROM Customer') ? customers.slice(0, 2) : products.slice(0, 2) };
};
const sql = { Int: 'int' };
assert.equal((await readActiveCustomerNames(query, sql, originalCustomers)).length, 2);
assert.equal((await readActiveProductNames(query, sql, originalProducts)).length, 2);
assert.match(calls[0].statement, /SELECT CustKey, CustName FROM Customer/);
assert.match(calls[0].statement, /isDeleted=0 AND CustKey IN/);
assert.deepEqual(Object.values(calls[0].params).map(value => value.value), [538, 456, 999]);
assert.match(calls[1].statement, /SELECT ProdKey, ProdName, DisplayName FROM Product/);
assert.match(calls[1].statement, /isDeleted=0 AND ProdKey IN/);
const before = calls.length;
assert.deepEqual(await readActiveCustomerNames(query, sql, { invalid: { custKey: null } }), []);
assert.equal(calls.length, before);
const many = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`p${index}`, { prodKey: index + 1 }]));
await readActiveProductNames(query, sql, many);
assert.equal(calls.length - before, 2);
assert.equal(Object.keys(calls.at(-2).params).length, 500);
assert.equal(Object.keys(calls.at(-1).params).length, 1);
console.log('paste mapping current-name helper tests passed');

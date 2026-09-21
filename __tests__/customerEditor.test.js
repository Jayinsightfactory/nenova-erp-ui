import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CUSTOMER_FIELDS, customerDraft, validateCustomerDraft, filterCustomers } from '../lib/customerEditor.js';

const original = { CustKey: 17, ...customerDraft({ CustName: '테스트 거래처', CustArea: '신규지역', Manager: '직접입력 담당자', ProductType: '장미', BaseOutDay: 4, Descr: '비고' }), UseType: '기존', TransType: '보존' };
assert.equal(validateCustomerDraft({ ...original, Descr: '', BaseOutDay: 0 }).Descr, '');
assert.equal(validateCustomerDraft({ ...original, BaseOutDay: 0 }).BaseOutDay, 0);
assert.throws(() => validateCustomerDraft({ CustName: '  ' }));
assert.throws(() => validateCustomerDraft({ ...original, BaseOutDay: 8 }));
assert.throws(() => validateCustomerDraft({ ...original, ProductType: '가'.repeat(21) }));
assert.equal(filterCustomers([original], '직접입력', { CustArea: '신규' }, { key: 'CustKey', direction: 1 }).length, 1);
assert.equal(filterCustomers([original], '없는업체', {}, { key: 'CustKey', direction: 1 }).length, 0);
assert.deepEqual(filterCustomers([{ CustKey: 20 }, { CustKey: 3 }], '', {}, { key: 'CustKey', direction: 1 }).map(r => r.CustKey), [3, 20]);

const source = fs.readFileSync('pages/api/master/customers.js', 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default withAuth', 'globalThis.handler = withAuth');
let row, calls;
const context = {
  CUSTOMER_FIELDS, customerDraft, validateCustomerDraft,
  sql: { Int: 'Int', NVarChar: 'NVarChar' }, withAuth: h => h,
  query: async () => ({ recordset: [row] }),
  withTransaction: async fn => fn(async (text, params) => {
    calls.push({ text, params });
    assert.ok(!/OrderMaster|OrderDetail|Shipment|Stock|Warehouse|Estimate|WebProfitReport/.test(text), 'all-year ERP ledgers must be untouched');
    if (text.startsWith('SELECT')) return { recordset: row ? [row] : [] };
    return { recordset: [{ CustKey: text.startsWith('INSERT') ? 900 : params.key.value }] };
  }),
};
vm.createContext(context); vm.runInContext(source, context);
async function call(body, method = 'POST') {
  calls = []; const response = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(data) { this.data = data; return this; } };
  await context.handler({ method, body, user: { userId: 'fixture' } }, response);
  return response;
}
row = original;
let res = await call({ mode: 'update', custKey: 17, original: customerDraft(original), values: { ...original, Descr: '', ProductType: '수국', BaseOutDay: 0 } });
assert.equal(res.statusCode, 200); assert.equal(res.data.custKey, 17);
assert.equal(calls.length, 2); assert.ok(calls[1].text.startsWith('UPDATE Customer'));
assert.equal(calls[1].params.Descr.value, ''); assert.equal(calls[1].params.ProductType.value, '수국');
assert.equal(calls[1].params.BaseOutDay.value, 0);
assert.ok(!/UseType=|TransType=|SearchComment=|CreateDtm=|CreateID=/.test(calls[1].text));
res = await call({ mode: 'update', custKey: 17, original: { ...original, Manager: '과거 담당자' }, values: original });
assert.equal(res.statusCode, 409); assert.equal(calls.length, 1); assert.match(res.data.error, /담당자/);
row = null;
res = await call({ mode: 'update', custKey: 17, original, values: original });
assert.equal(res.statusCode, 409); assert.equal(calls.length, 1);
res = await call({ mode: 'create', values: { CustName: '새 거래처' } });
assert.equal(res.statusCode, 200); assert.equal(calls.length, 1); assert.ok(calls[0].text.startsWith('INSERT INTO Customer'));
res = await call({ mode: 'create', custKey: 17, values: original });
assert.equal(res.statusCode, 400); assert.equal(calls.length, 0);
res = await call({ mode: 'update', custKey: '17bad', original, values: original });
assert.equal(res.statusCode, 400); assert.equal(calls.length, 0);
res = await call({}, 'DELETE'); assert.equal(res.statusCode, 405);
console.log('Customer editor: EXE fields, clear/zero, search/sort, insert/update isolation, stale/deleted protection, all-year ERP preservation passed');

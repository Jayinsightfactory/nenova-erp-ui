import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCountryOrderMatrix, compareCountryOrderSubweeks, isCountryOrderCustomerCode } from '../lib/countryOrderSource.js';

const row = { OrderYear: 2026, OrderWeek: '42-01', CustKey: 1, CustName: '업체', CustOrderCode: 'CL21', ProdKey: 1983, ProdName: 'tulip', FlowerName: '튤립', CounName: '네덜란드', OutUnit: '단', OutQuantity: 20, BoxQuantity: 1, BunchQuantity: 20, SteamQuantity: 200, SourceRowCount: 1 };
function response(rows = [row], country = 'Netherlands', counName = '네덜란드') { return { success: true, readOnly: true, scope: { country, counName, year: 2026, majorWeek: '42', scopeKey: `${country}/2026/42` }, subweeks: [{ key: '2026/42-01', orderWeek: '42-01' }], rows, warnings: [] }; }
test('NL saved stems only, no name or bunch factor; preserves zero and blocks unavailable positive order', () => {
  const matrix = buildCountryOrderMatrix(response([row, { ...row, ProdKey: 675, ProdName: 'hyacinth', OutUnit: '송이', OutQuantity: 150, BunchQuantity: 15, SteamQuantity: 150 }, { ...row, ProdKey: 2990, ProdName: 'missing', OutQuantity: 0, BunchQuantity: 120, SteamQuantity: 0, SteamOf1Bunch: 0 }, { ...row, ProdKey: 2991, ProdName: 'zero', OutQuantity: 0, BoxQuantity: 0, BunchQuantity: 0, SteamQuantity: 0 }]), '42-01');
  assert.equal(matrix.source, 'erp'); assert.deepEqual(matrix.scope, { country: 'Netherlands', year: 2026, orderWeek: '42-01' });
  assert.equal(matrix.rows.find(r => r.prodKey === 1983).total, 200); assert.equal(matrix.rows.find(r => r.prodKey === 675).total, 150);
  assert.equal(matrix.rows.length, 4); assert.equal(matrix.blockers.length, 1); assert.match(matrix.blockers[0], /STEM_QUANTITY_UNAVAILABLE.*2990/);
  assert.ok(matrix.rows.every(r => r.unit === 'stems'));
});
test('customer and product identities never merge by code or name, missing code retained', () => {
  const matrix = buildCountryOrderMatrix(response([row, { ...row, CustKey: 2, ProdKey: 2 }, { ...row, CustKey: 3, CustOrderCode: '' }, { ...row, CustKey: 4, CustOrderCode: 'OTHER' }]), '42-01');
  assert.equal(matrix.customers.length, 4); assert.equal(matrix.rows.length, 2);
  assert.equal(matrix.customers.find(c => c.key === '1').label, 'CL21 [CustKey:1]');
  assert.equal(matrix.customers.find(c => c.key === '3').code, ''); assert.match(matrix.customers.find(c => c.key === '3').label, /코드미등록/);
  assert.ok(matrix.rows.every(r => r.label.includes('[ProdKey:')));
  for (const code of ['MISSING_CUSTOMER_CODE', 'DUPLICATE_CUSTOMER_CODE', 'DUPLICATE_PRODUCT_NAME', 'UNRECOGNIZED_CUSTOMER_CODE']) assert.ok(matrix.warnings.some(w => w.startsWith(code)));
  assert.equal(matrix.rows.find(r => r.prodKey === 2).quantities['1'], 0);
});
test('prior-year same-week and other actual subweek excluded, exact business key cells summed', () => {
  const matrix = buildCountryOrderMatrix(response([row, row, { ...row, OrderYear: 2025, SteamQuantity: 18352 }, { ...row, OrderWeek: '42-03', SteamQuantity: 900 }]), '42-01');
  assert.equal(matrix.rows[0].total, 400); assert.equal(matrix.rows[0].quantities['1'], 400);
});
test('missing required quantities remain visible and blocked, nonfinite values and conflicting identities fail', () => {
  const matrix = buildCountryOrderMatrix(response([{ ...row, SteamQuantity: null }]), '42-01');
  assert.equal(matrix.rows.length, 1); assert.equal(matrix.rows[0].total, 0); assert.ok(matrix.blockers.length);
  assert.throws(() => buildCountryOrderMatrix(response([{ ...row, SteamQuantity: Infinity }]), '42-01'), /저장 수량/);
  assert.throws(() => buildCountryOrderMatrix(response([row, { ...row, CustName: '다른 업체' }]), '42-01'), /업체 정보/);
  assert.throws(() => buildCountryOrderMatrix(response([row, { ...row, ProdName: '다른 품명' }]), '42-01'), /품목 정보/);
});
test('actual subweeks required and mismatched response scope rejected', () => {
  assert.throws(() => buildCountryOrderMatrix(response(), '42-02'), /실제 주문/);
  assert.throws(() => buildCountryOrderMatrix({ ...response(), scope: { ...response().scope, scopeKey: 'Netherlands/2025/42' } }, '42-01'), /범위/);
  assert.throws(() => buildCountryOrderMatrix(response([{ ...row, CounName: '중국' }]), '42-01'), /국가/);
});
test('other country saved authority, category unit guard; no quantity fallback', () => {
  for (const [country, counName, unit, expected] of [['Australia', '호주', 'bunches', 20], ['Thailand', '태국', 'bunches', 20], ['Ecuador', '에콰도르', 'stems', 200], ['Vietnam', '베트남', 'stems', 200], ['China', '중국', 'bunches', 20]]) {
    const matrix = buildCountryOrderMatrix(response([{ ...row, CounName: counName }], country, counName), '42-01'); assert.equal(matrix.rows[0].unit, unit); assert.equal(matrix.rows[0].total, expected); assert.deepEqual(matrix.blockers, []);
  }
  for (const [FlowerName, OutUnit] of [['장미', '단'], ['알스트로', '단'], ['카네이션', '박스'], ['수국', '박스'], ['루스커스', '박스']]) assert.deepEqual(buildCountryOrderMatrix(response([{ ...row, FlowerName, OutUnit, CounName: '콜롬비아' }], 'Colombia', '콜롬비아'), '42-01').blockers, []);
  assert.ok(buildCountryOrderMatrix(response([{ ...row, FlowerName: '장미', OutUnit: '박스', CounName: '콜롬비아' }], 'Colombia', '콜롬비아'), '42-01').blockers.length);
});
test('CL prefixes recognized and numeric subweek suffix exact ordering', () => {
  for (const code of ['CL21', 'BCL16', 'KCL03', 'HCL07', 'MCL73', 'YCLS', ' cl21 ']) assert.equal(isCountryOrderCustomerCode(code), true);
  assert.equal(isCountryOrderCustomerCode('OTHER'), false);
  assert.deepEqual(['42-10', '42-03b', '42-01', '42-03A', '42-03'].sort(compareCountryOrderSubweeks), ['42-01', '42-03', '42-03A', '42-03b', '42-10']);
  assert.deepEqual(['42-03\u{10000}', '42-03\uE000'].sort(compareCountryOrderSubweeks), ['42-03\uE000', '42-03\u{10000}']);
});

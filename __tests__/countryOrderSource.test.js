import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewCountryOrderQuantities, buildCountryOrderMatrix, compareCountryOrderSubweeks, isCountryOrderCustomerCode, buildCountryOrderUnitBasis, formatCountryOrderUnitBasis, formatCountryOrderStoredQuantities } from '../lib/countryOrderSource.js';

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
test('registered basis describes stems bunches boxes, zero and missing factors without guessing', () => {
  const basis = buildCountryOrderUnitBasis({ OutUnit: '단', SteamOf1Bunch: '10', BunchOf1Box: 20, SteamOf1Box: 200 });
  assert.deepEqual(basis, { outUnit: '단', unit: 'bunches', steamOf1Bunch: 10, bunchOf1Box: 20, steamOf1Box: 200, boxWeight: null, boxCBM: null, tariffRate: null });
  assert.equal(formatCountryOrderUnitBasis(basis), '1단 = 10송이');
  assert.equal(formatCountryOrderUnitBasis({ ...basis, unit: 'boxes' }), '1박스 기준 · 20단 · 200송이');
  for (const factor of [0, null]) {
    assert.equal(formatCountryOrderUnitBasis(buildCountryOrderUnitBasis({ OutUnit: '송이', SteamOf1Bunch: factor, BunchOf1Box: factor, SteamOf1Box: factor })), '1송이 기준');
    assert.match(formatCountryOrderUnitBasis(buildCountryOrderUnitBasis({ OutUnit: '단', SteamOf1Bunch: factor, BunchOf1Box: 20, SteamOf1Box: 200 })), /송이 환산기준 미등록/);
    assert.match(formatCountryOrderUnitBasis(buildCountryOrderUnitBasis({ OutUnit: '박스', BunchOf1Box: factor, SteamOf1Box: factor })), /단 환산기준 미등록.*송이 환산기준 미등록/);
  }
  assert.match(formatCountryOrderUnitBasis(buildCountryOrderUnitBasis({ OutUnit: '?' })), /확인 필요/);
  assert.throws(() => buildCountryOrderUnitBasis({ OutUnit: '단', SteamOf1Bunch: Infinity }), /환산기준/);
});
test('basis metadata never replaces stored source quantities or changes download blockers', () => {
  const native = { ...row, SteamOf1Bunch: 10, BunchOf1Box: 20, SteamOf1Box: 200, SteamQuantity: 175 };
  const matrix = buildCountryOrderMatrix(response([native]), '42-01');
  assert.equal(matrix.rows[0].total, 175); assert.equal(matrix.rows[0].unitBasis.steamOf1Bunch, 10);
  assert.deepEqual(matrix.rows[0].storedQuantities, { outQuantity: 20, boxQuantity: 1, bunchQuantity: 20, steamQuantity: 175 });
  assert.deepEqual(matrix.blockers, []);
  const zeroFactor = buildCountryOrderMatrix(response([{ ...native, OutUnit: '송이', SteamOf1Bunch: 0, BunchOf1Box: 0, SteamOf1Box: 0 }]), '42-01');
  assert.equal(zeroFactor.rows[0].total, 175); assert.deepEqual(zeroFactor.blockers, []);
});
test('actual 2990 metadata is stem basis with all zero factors; stored bunch120 is not stem120', () => {
  const native = { ...row, ProdKey: 2990, CustKey: 533, OutUnit: '송이', OutQuantity: 0, BoxQuantity: 0, BunchQuantity: 120, SteamQuantity: 0, SteamOf1Bunch: 0, BunchOf1Box: 0, SteamOf1Box: 0 };
  const matrix = buildCountryOrderMatrix(response([native]), '42-01'), result = matrix.rows[0];
  assert.equal(formatCountryOrderUnitBasis(result.unitBasis), '1송이 기준'); assert.equal(result.total, 0);
  assert.equal(result.storedQuantitiesByCustomer['533'].bunchQuantity, 120); assert.equal(result.storedQuantities.steamQuantity, 0);
  assert.equal(matrix.blockers.length, 1); assert.match(matrix.blockers[0], /^STEM_QUANTITY_UNAVAILABLE:.*2990.*품목기준 1송이 기준.*저장 단 120 · 송이 0.*CustKey:533.*자동 변환되지/);
});
test('saved quantities aggregate by exact customer and current year, metadata never summed', () => {
  const native = { ...row, SteamOf1Bunch: 10, BunchOf1Box: 20, SteamOf1Box: 200 };
  const matrix = buildCountryOrderMatrix(response([native, native, { ...native, CustKey: 2, BunchQuantity: 3, SteamQuantity: 30 }, { ...native, OrderYear: 2025, BunchQuantity: 999, SteamQuantity: 9990 }]), '42-01');
  const result = matrix.rows[0]; assert.equal(result.total, 430); assert.equal(result.unitBasis.steamOf1Bunch, 10);
  assert.equal(result.storedQuantities.bunchQuantity, 43); assert.equal(result.storedQuantities.steamQuantity, 430);
  assert.equal(result.storedQuantitiesByCustomer['1'].bunchQuantity, 40); assert.equal(result.storedQuantitiesByCustomer['2'].bunchQuantity, 3);
});
test('missing raw source totals remain unknown and block; conflict basis fails rather than selecting one', () => {
  const native = { ...row, SteamOf1Bunch: 10, SteamQuantity: null };
  const matrix = buildCountryOrderMatrix(response([native, { ...native, SteamQuantity: 20 }]), '42-01');
  assert.equal(matrix.rows[0].storedQuantities.steamQuantity, null); assert.equal(matrix.rows[0].storedQuantitiesByCustomer['1'].steamQuantity, null);
  assert.equal(matrix.rows[0].total, 20); assert.ok(matrix.blockers.length > 0); assert.match(formatCountryOrderStoredQuantities(matrix.rows[0].storedQuantities), /송이 미등록/);
  assert.throws(() => buildCountryOrderMatrix(response([native, { ...native, SteamOf1Bunch: 5 }]), '42-01'), /환산기준이 서로 다릅니다/);
});

test('blocked products are flagged per row and can be excluded for a partial export without conversion', async () => {
  const { excludeBlockedCountryOrderRows } = await import('../lib/countryOrderSource.js');
  const { generatePedidosFromMatrix } = await import('../lib/importPedidos.js');
  const matrix = buildCountryOrderMatrix(response([row, { ...row, ProdKey: 2990, ProdName: 'missing', OutQuantity: 0, BunchQuantity: 120, SteamQuantity: 0, SteamOf1Bunch: 0 }]), '42-01');
  assert.equal(matrix.blockers.length, 1);
  assert.equal(matrix.rows.find(r => r.prodKey === 1983).blocked, false);
  assert.equal(matrix.rows.find(r => r.prodKey === 2990).blocked, true);
  assert.deepEqual(matrix.rows.find(r => r.prodKey === 2990).blockers, matrix.blockers);
  const partial = excludeBlockedCountryOrderRows(matrix);
  assert.deepEqual(partial.blockers, []); assert.equal(partial.rows.length, 1); assert.equal(partial.rows[0].prodKey, 1983); assert.equal(partial.rows[0].total, 200);
  assert.equal(partial.excludedRows.length, 1); assert.equal(partial.excludedRows[0].prodKey, 2990);
  assert.match(partial.warnings.at(-1), /^EXCLUDED_BLOCKED_ROWS: missing \[ProdKey:2990\]/);
  assert.equal(matrix.rows.length, 2, 'original matrix untouched');
  const outputs = generatePedidosFromMatrix(partial);
  assert.equal(outputs.length, 1); assert.equal(outputs[0].itemCount, 1); assert.equal(outputs[0].totalQuantity, 200);
  assert.ok(outputs[0].warnings.some(w => w.startsWith('EXCLUDED_BLOCKED_ROWS')));
  assert.throws(() => excludeBlockedCountryOrderRows(buildCountryOrderMatrix(response([{ ...row, ProdKey: 2990, ProdName: 'missing', OutQuantity: 0, BunchQuantity: 120, SteamQuantity: 0, SteamOf1Bunch: 0 }]), '42-01')), /남는 품목이 없습니다/);
  assert.throws(() => generatePedidosFromMatrix(matrix), /발주서 생성 차단/);
});

test('manual web quantities complete blocked rows for export only, never ERP, and reject incomplete entry', async () => {
  const { applyCountryOrderManualQuantities } = await import('../lib/countryOrderSource.js');
  const { generatePedidosFromMatrix } = await import('../lib/importPedidos.js');
  const blockedRow = { ...row, ProdKey: 2990, ProdName: 'missing', OutQuantity: 0, BunchQuantity: 120, SteamQuantity: 0, SteamOf1Bunch: 0 };
  const matrix = buildCountryOrderMatrix(response([row, blockedRow, { ...blockedRow, CustKey: 2, CustOrderCode: 'CL22' }]), '42-01');
  const key = matrix.rows.find(r => r.prodKey === 2990).key;
  assert.throws(() => applyCountryOrderManualQuantities(matrix, {}), /수량 입력이 필요합니다.*CustKey:1/);
  assert.throws(() => applyCountryOrderManualQuantities(matrix, { [key]: { 1: '150' } }), /CustKey:2/);
  assert.throws(() => applyCountryOrderManualQuantities(matrix, { [key]: { 1: '0', 2: '150' } }), /CustKey:1/);
  const fixed = applyCountryOrderManualQuantities(matrix, { [key]: { 1: '150', 2: '90' } });
  assert.deepEqual(fixed.blockers, []); const fixedRow = fixed.rows.find(r => r.prodKey === 2990);
  assert.equal(fixedRow.blocked, false); assert.equal(fixedRow.quantities['1'], 150); assert.equal(fixedRow.quantities['2'], 90); assert.equal(fixedRow.total, 240);
  assert.equal(fixed.rows.find(r => r.prodKey === 1983).total, 200);
  assert.match(fixed.warnings.at(-1), /^MANUAL_QUANTITY: missing \[ProdKey:2990\].*송이 수량 CustKey:1 150, CustKey:2 90.*전산 원주문은 변경되지/);
  assert.equal(matrix.rows.find(r => r.prodKey === 2990).blocked, true, 'source matrix untouched');
  const outputs = generatePedidosFromMatrix(fixed);
  assert.equal(outputs[0].itemCount, 2); assert.equal(outputs[0].totalQuantity, 440);
});

test('manual entry is required only for customers whose stored export quantity is missing', async () => {
  const { applyCountryOrderManualQuantities } = await import('../lib/countryOrderSource.js');
  const blockedRow = { ...row, ProdKey: 2990, ProdName: 'missing', OutQuantity: 0, BunchQuantity: 120, SteamQuantity: 0, SteamOf1Bunch: 0 };
  const okRow = { ...blockedRow, CustKey: 2, CustOrderCode: 'CL22', SteamQuantity: 50 };
  const matrix = buildCountryOrderMatrix(response([blockedRow, okRow]), '42-01');
  const key = matrix.rows[0].key;
  assert.throws(() => applyCountryOrderManualQuantities(matrix, {}), /CustKey:1/);
  const fixed = applyCountryOrderManualQuantities(matrix, { [key]: { 1: '100' } });
  assert.equal(fixed.rows[0].quantities['1'], 100); assert.equal(fixed.rows[0].quantities['2'], 50); assert.equal(fixed.rows[0].total, 150);
  assert.match(fixed.warnings.at(-1), /CustKey:1 100\b/); assert.doesNotMatch(fixed.warnings.at(-1), /CustKey:2/);
});

test('product snapshot and factor suggestion derive only missing factors from entered stems and stored bunches/boxes', async () => {
  const { buildCountryOrderProductSnapshot, suggestCountryOrderProductFactors } = await import('../lib/countryOrderSource.js');
  const blockedRow = { ...row, ProdKey: 2990, ProdName: 'missing', OutQuantity: 0, BoxQuantity: 2, BunchQuantity: 10, SteamQuantity: 0, SteamOf1Bunch: 0, BunchOf1Box: 5, SteamOf1Box: null, BoxWeight: 12.5, BoxCBM: null, TariffRate: 0.08 };
  const matrix = buildCountryOrderMatrix(response([blockedRow]), '42-01'), target = matrix.rows[0];
  assert.deepEqual(buildCountryOrderProductSnapshot(target.unitBasis), { BunchOf1Box: 5, SteamOf1Bunch: 0, BoxWeight: 12.5, BoxCBM: null, TariffRate: 0.08, SteamOf1Box: null });
  assert.deepEqual(suggestCountryOrderProductFactors(target, { 1: '100' }), { SteamOf1Bunch: 10, SteamOf1Box: 50 });
  assert.deepEqual(suggestCountryOrderProductFactors(target, {}), {});
  assert.deepEqual(suggestCountryOrderProductFactors(target, { 1: '0' }), {});
});

test('review uses the selected stem or bunch unit, allows zero and preserves ERP evidence', () => {
  for (const [country, name, expected] of [['Netherlands', '네덜란드', 200], ['Australia', '호주', 20]]) {
    const matrix = buildCountryOrderMatrix(response([{ ...row, CounName: name }], country, name), '42-01');
    const source = matrix.rows[0];
    const change = value => reviewCountryOrderQuantities(matrix, { [source.key]: { 1: value } });
    assert.equal(change('14').rows[0].total, 14);
    assert.equal(change('0').rows[0].quantities['1'], 0);
    assert.equal(source.quantities['1'], expected);
    assert.deepEqual(change('14').rows[0].storedQuantities, source.storedQuantities);
    for (const invalid of ['', '-1', 'Infinity']) assert.throws(() => change(invalid), /수량/);
  }
});

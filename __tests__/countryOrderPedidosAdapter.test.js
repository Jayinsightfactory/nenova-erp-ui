import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import XLSX from 'xlsx-js-style';
import { generatePedidos, generatePedidosFromMatrix, readPedidosWorkbook, serializePedidosWorkbook } from '../lib/importPedidos.js';
import { prepareCountryOrderPedidos } from '../lib/countryOrderPedidosAdapter.js';
const matrix = (country = 'Netherlands', unit = 'stems') => ({ source: 'erp', scope: { country, year: 2026, orderWeek: '42-01' }, customers: [{ key: '1', code: 'CL21', name: '업체', label: 'CL21' }], rows: [{ key: `10|${unit}`, prodKey: 10, name: 'Tulip A', flower: '장미', unit, quantities: { 1: 200 }, total: 200 }], warnings: [], blockers: [] });
const workbook = rows => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Source'); return wb; };

test('ERP Netherlands stored stems pass through existing Holex/EZ workbook builder and roundtrip', () => {
  const input = matrix(), before = JSON.stringify(input), output = generatePedidosFromMatrix(input)[0];
  assert.equal(output.filename, '42-01_Holex.xlsx'); assert.equal(output.totalQuantity, 200);
  assert.equal(output.unit, 'stems'); assert.equal(output.workbook.Sheets['Holex 42-01']['!freeze'], 'B4');
  const saved = readPedidosWorkbook(serializePedidosWorkbook(output.workbook)).Sheets['Holex 42-01'];
  assert.equal(saved.B4.v, 200); assert.equal(saved.C4.f, 'SUM(B4:B4)'); assert.equal(saved.C5.v, 200);
  assert.equal(JSON.stringify(input), before);
  input.rows[0].name = '[EZ] hyacinth'; assert.equal(generatePedidosFromMatrix(input)[0].filename, '42-01_EZ.xlsx');
});

test('duplicate customer codes, missing code and duplicate product names stay separate by identities', () => {
  const input = matrix();
  input.customers.push({ key: '2', code: 'cl21', name: '다른 업체' }, { key: '3', code: '', name: '코드 없음' });
  input.rows[0].quantities = { 1: 100, 2: 80, 3: 20 };
  input.rows.push({ ...input.rows[0], key: '11|stems', prodKey: 11, quantities: { 1: 20, 2: 30, 3: 0 }, total: 50 });
  const output = generatePedidosFromMatrix(input)[0];
  assert.equal(output.itemCount, 2); assert.equal(output.totalQuantity, 250);
  assert.deepEqual(output.cls, ['CL21 [CustKey:1]', 'cl21 [CustKey:2]', '코드미등록 [CustKey:3]']);
  assert.match(output.preview.rows[0][0], /ProdKey:10/); assert.match(output.preview.rows[1][0], /ProdKey:11/);
});

test('export rejects blockers, wrong provenance, invalid identity, nonfinite quantity and mismatched totals', () => {
  for (const mutate of [m => m.blockers.push('STEM_QUANTITY_UNAVAILABLE'), m => m.source = 'upload', m => m.rows.push(m.rows[0]), m => m.customers.push(m.customers[0]), m => m.rows[0].quantities[1] = NaN, m => m.rows[0].total = 199, m => m.rows[0].unit = 'bunches', m => m.rows[0].quantities[99] = 1]) {
    const input = matrix(); mutate(input); assert.throws(() => generatePedidosFromMatrix(input));
  }
});

test('all other ERP countries reuse existing templates and enforce Colombia output units', () => {
  const expectations = [['Australia', 'bunches', 'Australia'], ['Thailand', 'bunches', 'Thailand'], ['Ecuador', 'stems', 'Ecuador'], ['Vietnam', 'stems', 'Royal_base'], ['Colombia', 'bunches', 'Rosas'], ['China', 'bunches', 'Melody']];
  for (const [country, unit, label] of expectations) {
    const output = generatePedidosFromMatrix(matrix(country, unit))[0];
    assert.equal(output.filename, `42-01_${label}.xlsx`); assert.equal(output.totalQuantity, 200);
    assert.ok(serializePedidosWorkbook(output.workbook).length > 0);
  }
  const input = matrix('Colombia', 'stems'); assert.throws(() => prepareCountryOrderPedidos(input), /단위/);
  input.rows[0].unit = 'boxes'; input.rows[0].flower = '카네이션';
  assert.equal(generatePedidosFromMatrix(input)[0].filename, '42-01_Clavel.xlsx');
});

test('China ERP mixed units stay separate with unchanged Melody naming and no conversion', () => {
  const input = matrix('China', 'bunches');
  input.rows.push({ ...input.rows[0], key: '10|stems', unit: 'stems', total: 150, quantities: { 1: 150 } });
  const outputs = generatePedidosFromMatrix(input);
  assert.deepEqual(outputs.map(output => [output.filename, output.totalQuantity]), [['42-01_Melody_단.xlsx', 200], ['42-01_Melody_송이.xlsx', 150]]);
  assert.equal(outputs[0].sourceAdapter, 'country-order-matrix-v1');
  assert.deepEqual(outputs[0].sourceScope, input.scope);
});

test('Australia duplicate display suffix preserves exact original-name box divisor', () => {
  const input = matrix('Australia', 'bunches');
  input.rows[0].name = 'Fern Umbrella'; input.rows[0].total = 50; input.rows[0].quantities = { 1: 50 };
  input.rows.push({ ...input.rows[0], key: '11|bunches', prodKey: 11, total: 100, quantities: { 1: 100 } });
  const output = generatePedidosFromMatrix(input)[0];
  assert.equal(output.itemCount, 2); assert.deepEqual(output.preview.rows.map(row => row[2]), [1, 2]);
  assert.equal(output.warnings.length, 0); assert.match(output.preview.rows[0][0], /ProdKey:10/);
});

test('uploaded Netherlands C-column product header and prefix CL families are numeric pass-through', () => {
  const codes = ['BCL16', 'CL21', 'KCL03', 'HCL07', 'MCL73', 'YCLS'];
  const input = workbook([['국가', null, '품목명(색상)'], [null, null, null, ...codes], ['네덜란드', null, 'tulip hyacinth skimmia eucalyptus', 1, 2, 3, 4, 5, 6], ['네덜란드 Total']]);
  const output = generatePedidos(input, 'Netherlands', '42-01')[0];
  assert.equal(output.totalQuantity, 21); assert.deepEqual(output.cls, [...codes].sort());
  assert.equal(output.preview.rows[0][0], 'tulip hyacinth skimmia eucalyptus');
  input.Sheets.Source.C3.v = 'changed name'; assert.equal(generatePedidos(input, 'Netherlands', '42-01')[0].totalQuantity, 21);
});

test('uploaded totals precedence is case-insensitive and unknown numeric header remains visible with address warning', () => {
  const output = generatePedidos(workbook([['country'], ['name', 'cl21', 'CL21 Total', 'UNLISTED7'], ['Lily', 999, 4, 6], ['Grand Total']]), 'Netherlands', 'W')[0];
  assert.equal(output.totalQuantity, 10); assert.deepEqual(output.cls, ['UNLISTED7', 'cl21']);
  assert.match(output.warnings.join(' '), /Source!D2.*UNRECOGNIZED_CUSTOMER_CODE/);
});

test('unknown ABC Total is retained and unknown raw plus total obey precedence', () => {
  const onlyTotal = generatePedidos(workbook([['country'], ['name', 'CL1', 'ABC Total'], ['Lily', 1, 6], ['Grand Total']]), 'Netherlands', 'W')[0];
  assert.equal(onlyTotal.totalQuantity, 7); assert.deepEqual(onlyTotal.cls, ['ABC', 'CL1']);
  assert.match(onlyTotal.warnings.join(' '), /Source!C2.*UNRECOGNIZED_CUSTOMER_CODE.*ABC/);
  const rawAndTotal = generatePedidos(workbook([['country'], ['name', 'CL1', 'abc', 'ABC Total'], ['Lily', 1, 999, 6], ['Grand Total']]), 'Netherlands', 'W')[0];
  assert.equal(rawAndTotal.totalQuantity, 7); assert.deepEqual(rawAndTotal.cls, ['CL1', 'abc']);
});

test('case-insensitive repeated Netherlands raw codes sum while first literal is preserved', () => {
  const output = generatePedidos(workbook([['country'], ['name', 'kcl03', 'KCL03'], ['Lily', 2, 6], ['Grand Total']]), 'Netherlands', 'W')[0];
  assert.equal(output.totalQuantity, 8); assert.deepEqual(output.cls, ['kcl03']);
  assert.equal(output.preview.rows[0][1], 8);
});

test('ambiguous uploaded product columns block instead of guessing', () => {
  assert.throws(() => generatePedidos(workbook([['Name', '품목명', 'CL1'], ['A', 'B', 2]]), 'Netherlands', 'W'), /AMBIGUOUS_PRODUCT_COLUMN/);
});

const realSource = new URL('../.tmp-country/source-orders.xlsx', import.meta.url);
test('confidential local Netherlands source: 59 product rows, 15 codes, 9220 stems preserved through save/reopen', { skip: !fs.existsSync(realSource) }, () => {
  const input = readPedidosWorkbook(fs.readFileSync(realSource)), before = JSON.stringify(input);
  const outputs = generatePedidos(input, 'Netherlands', '42-01');
  assert.equal(outputs.reduce((sum, output) => sum + output.totalQuantity, 0), 9220);
  assert.equal(outputs.reduce((sum, output) => sum + output.itemCount, 0), 59);
  assert.equal(outputs[0].cls.length, 15);
  const saved = readPedidosWorkbook(serializePedidosWorkbook(outputs[0].workbook));
  const rows = XLSX.utils.sheet_to_json(saved.Sheets[saved.SheetNames[0]], { header: 1, raw: true });
  assert.equal(rows.at(-1).at(-1), 9220); assert.equal(JSON.stringify(input), before);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx-js-style';
import { buildCountryOrderMatrix } from '../lib/countryOrderSource.js';
import { countryOrderShortName, countryOrderIssue, splitCountryOrderFarms, generateCompactCountryOrders } from '../lib/countryOrderPresentation.js';
import { serializePedidosWorkbook } from '../lib/importPedidos.js';
import { withCountryOrderEta } from '../lib/countryOrderEta.js';

function fixture(country = 'China', year = 2026) {
  const rows = [1, 2].flatMap(ProdKey => [1, 2].map(CustKey => ({ OrderYear: year, OrderWeek: '47-02', CustKey, CustName: `업체${CustKey}`, CustOrderCode: CustKey === 1 ? 'HCL2' : '', ProdKey, ProdName: `ROSE / 품목${ProdKey} 50cm`, FlowerName: '장미', CounName: country === 'China' ? '중국' : '네덜란드', OutUnit: '단', OutQuantity: ProdKey * CustKey, BunchQuantity: ProdKey * CustKey, SteamQuantity: ProdKey * CustKey * 10, SourceRowCount: 1 })));
  return buildCountryOrderMatrix({ success: true, readOnly: true, scope: { country, year, majorWeek: '47', counName: rows[0].CounName, scopeKey: `${country}/${year}/47` }, subweeks: [{ orderWeek: '47-02' }], rows }, '47-02');
}
test('short names remove common prefix only and retain size, colour and explicit identity suffix', () => {
  assert.equal(countryOrderShortName({ name: 'Hydrangea Blue (블루) 50cm' }), 'Blue (블루) 50cm');
  assert.equal(countryOrderShortName({ name: 'ROSE / White 60cm [ProdKey:2]' }), 'White 60cm [ProdKey:2]');
  assert.equal(countryOrderShortName({ name: 'Rosemary Blue' }), 'Rosemary Blue');
  assert.equal(countryOrderIssue('DUPLICATE_PRODUCT_NAME: A'), '품목명 중복: A');
  assert.equal(countryOrderIssue('MISSING_CUSTOMER_CODE: B'), '업체 코드 미등록: B');
});
test('China farm split conserves every customer cell, defaults CLOUD, uses product identity across units', () => {
  const matrix = fixture(), original = JSON.stringify(matrix);
  const partitions = splitCountryOrderFarms(matrix, { farms: ['HUBFRESH', 'CLOUD'], split: true, selected: { 1: true, 2: false } });
  assert.deepEqual(partitions.map(part => [part.farm, part.matrix.rows.map(row => row.prodKey)]), [['HUBFRESH', [1]], ['CLOUD', [2]]]);
  assert.equal(partitions.reduce((sum, part) => sum + part.matrix.rows.reduce((s, row) => s + row.total, 0), 0), 9);
  assert.equal(splitCountryOrderFarms(matrix)[0].farm, 'Melody');
  assert.equal(splitCountryOrderFarms(matrix)[0].matrix.rows.length, 2);
  assert.equal(generateCompactCountryOrders(matrix)[0].filename, '47-02_Melody.xlsx');
  assert.equal(generateCompactCountryOrders(matrix, { farms: ['HUBFRESH', 'CLOUD'] })[0].filename, '47-02_HUBFRESH.xlsx');
  assert.equal(splitCountryOrderFarms(matrix, { split: true })[0].farm, 'CLOUD');
  assert.equal(JSON.stringify(matrix), original);
  const mixed = { ...matrix, rows: [...matrix.rows, { ...matrix.rows[0], key: '1|stems', unit: 'stems' }] };
  assert.equal(splitCountryOrderFarms(mixed, { split: true, selected: { 1: true } })[0].matrix.rows.length, 2);
  const mixedExports = generateCompactCountryOrders(mixed, { split: true, selected: { 1: true }, farms: ['HUBFRESH', 'CLOUD'] });
  assert.equal(mixedExports.length, 2);
  assert.deepEqual(mixedExports[0].totalQuantityByUnit, { bunches: 3, stems: 3 });
  assert.equal(mixedExports[0].totalQuantity, '3 단 · 3 송이');
  assert.equal(mixedExports[0].workbook.SheetNames.length, 3);
  for (const options of [{ farms: ['', 'CLOUD'] }, { farms: ['cloud', 'CLOUD'] }, { selected: { 999: true } }, { selected: { 1: 1 } }]) assert.throws(() => splitCountryOrderFarms(matrix, options));
  assert.throws(() => splitCountryOrderFarms({ ...matrix, blockers: ['수량 오류'] }));
  assert.throws(() => splitCountryOrderFarms({ ...matrix, scope: { ...matrix.scope, year: 0 } }));
});
test('all country matrices retain every source customer cell and native legacy formulas', () => {
  for (const country of ['Colombia', 'Ecuador', 'Australia', 'Thailand', 'Vietnam', 'China']) {
    const source = fixture();
    const unit = ['Ecuador', 'Vietnam'].includes(country) ? 'stems' : 'bunches';
    const matrix = { ...source, scope: { ...source.scope, country }, rows: source.rows.map(row => ({ ...row, unit })) };
    const outputs = generateCompactCountryOrders(matrix);
    assert.equal(outputs.reduce((sum, output) => sum + output.itemCount, 0), matrix.rows.length);
    const sheet = outputs[0].workbook.Sheets['업체별 발주'];
    assert.equal(sheet.C5.v, 1); assert.equal(sheet.D5.v, 2);
    assert.equal(sheet.C6.v, 2); assert.equal(sheet.D6.v, 4);
    assert.ok(outputs[0].workbook.SheetNames.length > 1);
  }
});
test('compact workbook roundtrip retains codes, no-code customer, numeric quantities, formulas and legacy sheets in both years', () => {
  for (const year of [2025, 2026]) {
    const matrix = fixture('Netherlands', year);
    const [output] = generateCompactCountryOrders(matrix);
    const wb = XLSX.read(serializePedidosWorkbook(withCountryOrderEta(output.workbook, '47-02', `${year}-11-20`)), { type: 'array', cellFormula: true });
    assert.equal(wb.SheetNames[0], '업체별 발주');
    assert.match(wb.Sheets['업체별 발주'].A1.v, /Semana 47-02차 ETA/);
    assert.ok(wb.SheetNames.length > 1);
    const sheet = wb.Sheets['업체별 발주'];
    assert.equal(sheet.C3.v, 'HCL2'); assert.equal(sheet.D3.v, '업체2');
    assert.equal(sheet.C5.v, 10); assert.equal(sheet.D5.v, 20); assert.equal(sheet.E5.v, 30);
    assert.equal(sheet.E5.f, 'SUM(C5:D5)'); assert.equal(sheet.A5.v, '품목1 50cm');
    assert.equal(output.totalQuantity, 90);
  }
});

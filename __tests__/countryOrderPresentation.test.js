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

test('Ecuador 49-01 farm split, 10단=100송이=1박스 without pairing/merge, and SUM formulas on both sheets', () => {
  const rawRows = [
    [1487, 'Ecuador Candy X-pression', 100],
    [1556, 'Ecuador Channel  AS154 ', 100],
    [1552, 'Ecuador Choco Bloom AS73', 200],
    [2240, 'Ecuador Electric MO AS295', 400],
    [1555, 'Ecuador Gala AS 43', 200],
    [1494, 'Ecuador Tinted Dark Whisper AS033', 200],
    [1527, 'Ecuador Tinted Light Eucalyptus AS231', 100],
    [1496, 'Ecuador Tinted Shiny Pearl AS047', 200],
    [1524, 'Ecuador Tinted Sweet Lavender AS198', 100],
  ].map(([ProdKey, ProdName, qty]) => ({
    OrderYear: 2026, OrderWeek: '49-01', CustKey: 533, CustName: '주광농원', CustOrderCode: 'YCL2',
    ProdKey, ProdName, FlowerName: '장미', CounName: '에콰도르', OutUnit: '송이',
    SteamOf1Bunch: 0, BunchOf1Box: 0, SteamOf1Box: 0,
    OutQuantity: qty, BoxQuantity: 0, BunchQuantity: 0, SteamQuantity: qty, SourceRowCount: 1,
  }));
  const matrix = buildCountryOrderMatrix({
    success: true, readOnly: true,
    scope: { country: 'Ecuador', counName: '에콰도르', year: 2026, majorWeek: '49', scopeKey: 'Ecuador/2026/49' },
    subweeks: [{ orderWeek: '49-01' }], rows: rawRows, warnings: [],
  }, '49-01');

  // Default (no split): single file 49-01_Ecuador.xlsx, 1600 stems, 16 boxes, SUM formulas on both sheets
  const [single] = generateCompactCountryOrders(matrix);
  assert.equal(single.filename, '49-01_Ecuador.xlsx');
  assert.equal(single.itemCount, 9);
  assert.equal(single.totalQuantity, 1600);
  assert.equal(single.totalBoxes, 16);
  const reopened = XLSX.read(serializePedidosWorkbook(withCountryOrderEta(single.workbook, '49-01', '2026-12-03')), { type: 'array', cellFormula: true });
  const s1 = reopened.Sheets['업체별 발주'];
  assert.equal(s1.E3.v, '박스');
  assert.equal(s1.A14.v, 'TOTAL');
  assert.equal(s1.C14.f, 'SUM(C4:C13)'); assert.equal(s1.C14.v, 1600);
  assert.equal(s1.D14.f, 'SUM(D4:D13)'); assert.equal(s1.D14.v, 1600);
  assert.equal(s1.E14.f, 'SUM(E4:E13)'); assert.equal(s1.E14.v, 16);
  const s2 = reopened.Sheets['1_Ecuador 49-01'];
  assert.equal(s2.C4.f, 'B4/100'); assert.equal(s2.C4.v, 1);
  assert.equal(s2.C5.f, 'B5/100'); assert.equal(s2.C5.v, 1);
  assert.equal(s2.B13.f, 'SUM(B4:B12)'); assert.equal(s2.B13.v, 1600);
  assert.equal(s2.C13.f, 'SUM(C4:C12)'); assert.equal(s2.C13.v, 16);
  assert.equal((s2['!merges'] ?? []).some(m => m.s.c === 2), false, 'no C-column merges');

  // Farm split ON: La Rosaleda (4 items = 800 stems = 8 boxes) + Fagua Flowers (5 items = 800 stems = 8 boxes)
  const splitOut = generateCompactCountryOrders(matrix, {
    split: true,
    farms: ['La Rosaleda', 'Fagua Flowers'],
    selected: { 1487: true, 1556: true, 1552: true, 2240: true },
  });
  assert.deepEqual(splitOut.map(o => [o.filename, o.itemCount, o.totalQuantity, o.totalBoxes]), [
    ['49-01_La Rosaleda.xlsx', 4, 800, 8],
    ['49-01_Fagua Flowers.xlsx', 5, 800, 8],
  ]);
});

test('expanded countries (NewZealand mixed units, Japan, USA, Israel, Ethiopia) generate valid workbooks', () => {
  const nzRows = [
    { OrderYear: 2026, OrderWeek: '48-01', CustKey: 1, CustName: '업체A', CustOrderCode: 'CL1', ProdKey: 101, ProdName: 'NZ Peony', FlowerName: '작약', CounName: '뉴질랜드', OutUnit: '단', OutQuantity: 15, BoxQuantity: 1, BunchQuantity: 15, SteamQuantity: 75, SourceRowCount: 1 },
    { OrderYear: 2026, OrderWeek: '48-01', CustKey: 1, CustName: '업체A', CustOrderCode: 'CL1', ProdKey: 102, ProdName: 'NZ Protea', FlowerName: '프로테아', CounName: '뉴질랜드', OutUnit: '송이', OutQuantity: 50, BoxQuantity: 0, BunchQuantity: 0, SteamQuantity: 50, SourceRowCount: 1 },
  ];
  const nzMatrix = buildCountryOrderMatrix({
    success: true, readOnly: true,
    scope: { country: 'NewZealand', counName: '뉴질랜드', year: 2026, majorWeek: '48', scopeKey: 'NewZealand/2026/48' },
    subweeks: [{ orderWeek: '48-01' }], rows: nzRows, warnings: [],
  }, '48-01');
  const [nzOut] = generateCompactCountryOrders(nzMatrix);
  assert.equal(nzOut.filename, '48-01_NewZealand.xlsx');
  assert.equal(nzOut.totalQuantity, '15 단 · 50 송이');
  assert.equal(nzOut.workbook.SheetNames.length, 3);
  const nzWb = XLSX.read(serializePedidosWorkbook(withCountryOrderEta(nzOut.workbook, '48-01', '2026-11-26')), { type: 'array', cellFormula: true });
  const nzS1 = nzWb.Sheets['업체별 발주'];
  assert.equal(nzS1.A8.v, 'TOTAL (단)'); assert.match(nzS1.C8.f, /^SUMIF\(/); assert.equal(nzS1.C8.v, 15);
  assert.equal(nzS1.A9.v, 'TOTAL (송이)'); assert.match(nzS1.C9.f, /^SUMIF\(/); assert.equal(nzS1.C9.v, 50);
});

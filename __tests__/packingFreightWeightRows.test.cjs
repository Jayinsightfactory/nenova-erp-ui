const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx-js-style');

// 2026-11-25 운송료·CW·GW 누락 회귀.
// nenova.exe ExcelLoadingPackingList.MakeTempTable skips rows whose F/I/J are all
// blank, reads cached cell values (no recalculation) and usp_CreateWarehouse
// matches B to Product.ProdName exactly (2182 운송료, 3100 Gross weight,
// 3101 Chargeable weight). The web /incoming parser must agree.
const ready = Promise.all([import('../lib/importPacking.js'), import('../lib/warehousePackingImport.js')]);
const PRODUCT_NAMES = new Set(['운송료', 'Gross weight', 'Chargeable weight']);

function exeRows(buf) {
  const book = XLSX.read(buf, { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const rows = [];
  for (let index = 5; index < grid.length; index += 1) {
    const row = grid[index] || [];
    if ([5, 8, 9].every(column => String(row[column] ?? '').trim() === '')) continue;
    if (String(row[0]).trim() === 'TOTAL' || !String(row[1]).trim()) break;
    rows.push({ name: String(row[1]).trim(), box: row[5], bunch: row[8], steam: row[9], unit: row[10], total: row[11] });
  }
  return rows;
}

const base = { invoice: 'FW-48', date: '2026/11/24', products: [{ description: 'TEST FLOWER', pcs: 2, bunch_st: 10, steam_box: 100,
  total_bunch: 20, total_stems: 200, u_price: 0.5, t_price: 100 }] };
const catalogFor = country => ({ byCountry: { [country]: [{ name: 'TEST FLOWER', family: 'OTHER' }] } });
const aliasesFor = packing => ({ [packing.aliasKey('TEST FLOWER')]: 'TEST FLOWER' });

test('every country generator writes ERP-named freight/weight rows that nenova.exe and the web parser both keep', async () => {
  const [packing, upload] = await ready;
  const cases = [
    ['CO Bogota', 'CO', packing.genColombia, { supplier: 'Teucali', freight_total: 35, gross_weight: 120, vol_weight: 150, invoice_total: 135 }, { freight: 35, gw: 120, cw: 150 }],
    ['CO Antioquia', 'CO', packing.genColombia, { supplier: 'Balverde', freight_total: 35, gross_weight: 120, vol_weight: 150, invoice_total: 135 }, { freight: 35, gw: 120, cw: 150 }],
    ['CN PDF/AI', 'CN', packing.genChina, { supplier: 'Yunnan Melody', freight: 1169, gross_weight: 88.13, vol_weight: 120, total_value: 1179 }, { freight: 1169, gw: 88.13, cw: 120 }],
    ['EC', 'EC', packing.genEcuador, { freight: 40, gross_weight: 300, vol_weight: 380, invoice_total: 140 }, { freight: 40, gw: 300, cw: 380 }],
    ['TH', 'TH', packing.genThailand, { supplier: 'Super Fresh', freight: 25, gross_weight: 206, vol_weight: 295, invoice_total: 125 }, { freight: 25, gw: 206, cw: 295 }],
    ['AU', 'AU', packing.genAustralia, { gross_weight: 90, vol_weight: 110, products: [{ ...base.products[0], t_price: 10 }] }, { freight: null, gw: 90, cw: 110 }],
    ['US', 'US', packing.genUS, { gross_weight: 1697, vol_weight: 1840, products: [{ ...base.products[0], t_price: 1 }] }, { freight: null, gw: 1697, cw: 1840 }],
    ['VN', 'VN', packing.genVN, { freight: 12, gross_weight: 50, vol_weight: 60, invoice_total: 112 }, { freight: 12, gw: 50, cw: 60 }],
  ];
  for (const [label, country, generate, extra, expected] of cases) {
    const result = generate(XLSX, { ...base, ...extra }, '48', '01', { catalog: catalogFor(country), aliases: aliasesFor(packing) });
    const rows = exeRows(result.buf);
    const pseudo = rows.filter(row => PRODUCT_NAMES.has(row.name) || /weig/i.test(row.name));
    assert.equal(pseudo.some(row => /weigth/i.test(row.name)), false, `${label}: legacy weigth typo is gone`);
    const freight = rows.filter(row => row.name === '운송료');
    if (expected.freight == null) assert.equal(freight.length, 0, label);
    else {
      assert.equal(freight.length, 1, `${label}: one freight row survives the nenova.exe F/I/J skip rule`);
      assert.deepEqual([freight[0].box, freight[0].bunch, freight[0].steam, freight[0].unit, freight[0].total], [1, 1, 1, expected.freight, expected.freight], label);
    }
    const gw = rows.find(row => row.name === 'Gross weight');
    const cw = rows.find(row => row.name === 'Chargeable weight');
    assert.equal(gw?.steam, expected.gw, `${label}: GW in TOTALSTEAM`);
    assert.equal(cw?.steam, expected.cw, `${label}: CW in TOTALSTEAM`);
    const goods = rows.find(row => row.name === 'TEST FLOWER');
    assert.equal(typeof goods.total, 'number', `${label}: goods T.PRICE has a cached numeric value`);
    const parsed = upload.parseWarehousePackingWorkbook(result.buf, XLSX);
    assert.equal(parsed.meta.gw, expected.gw, `${label}: web meta GW`);
    assert.equal(parsed.meta.cw, expected.cw, `${label}: web meta CW`);
    assert.equal(parsed.meta.freight, expected.freight ?? undefined, `${label}: web meta freight`);
    assert.equal(result.totalMismatch, null, `${label}: grand total includes freight once`);
  }
});

test('zero or absent GW/CW/freight never invents rows; CW is never derived from GW', async () => {
  const [packing, upload] = await ready;
  const result = packing.genChina(XLSX, { ...base, supplier: 'Yunnan Melody', gross_weight: 88, total_value: 100 }, '48', '01',
    { catalog: catalogFor('CN'), aliases: aliasesFor(packing) });
  const rows = exeRows(result.buf);
  assert.equal(rows.filter(row => row.name === '운송료').length, 0);
  assert.equal(rows.filter(row => row.name === 'Chargeable weight').length, 0);
  const parsed = upload.parseWarehousePackingWorkbook(result.buf, XLSX);
  assert.equal(parsed.meta.gw, 88); assert.equal(parsed.meta.cw, undefined); assert.equal(parsed.meta.freight, undefined);
  const negative = packing.genChina(XLSX, { ...base, supplier: 'Yunnan Melody', freight: -20, total_value: 80 }, '48', '01',
    { catalog: catalogFor('CN'), aliases: aliasesFor(packing) });
  assert.equal(exeRows(negative.buf).find(row => row.name === '운송료').total, -20, 'claim deductions stay signed');
  const hubCn = packing.genChina(XLSX, { ...base, supplier: '云南鲜集花卉有限公司', total_value: 10 }, '48', '01',
    { catalog: catalogFor('CN'), aliases: aliasesFor(packing) });
  assert.match(hubCn.name, /^48-01_CN_HUB_/, 'Chinese 鲜集 supplier uses HUB filename prefix');
});

test('legacy web files: weigth typo and quantity-less 운송료/fee rows are recovered by the web parser only', async () => {
  const [, upload] = await ready;
  const grid = (date, extraRows) => [[], ['Grower:', '', 'Cloudland', '', 'Weekend:', '', '46-02', '', 'Invoice:', '', '2026YY-053'],
    ['AWB:', '', '', '', 'Date:', '', date], [],
    ['COD', 'VARIETY NAME', 'PRODUCT', 'COLOR', 'SIZE', 'BOX', 'STEAM/BUNCH', 'STEAM/BOX', 'TOTAL\nBUNCH', 'TOTALSTEAM', 'U.PRICE', 'T.PRICE'],
    ['1', 'PETAL CHINA', '', '', '', 1, 1, 40, 40, 40, 7.5, 300], ...extraRows, ['TOTAL', '', '', '', '', 1, '', '', 40, 40, '', 300]];
  const legacy = upload.parseWarehousePackingGrid(grid('2026/11/13', [
    ['2', 'BOXING AND PACKING', '', '', '', '', '', '', '', '', 189, 189],
    ['3', 'Documents', '', '', '', '', '', '', '', '', 1000, 1000],
    ['4', 'Claim deduction', '', '', '', '', '', '', '', '', -20, -20],
    ['5', 'Gross weigth', '', '', '', 1, 1, 1, 1, 2543, '', ''],
    ['6', 'Chargeable weigth', '', '', '', 1, 1, 1, 1, 2543, '', ''],
    ['7', 'memo only', '', '', '', '', '', '', '', '', 5, 5],
  ]));
  assert.deepEqual(legacy.rows.map(row => row.prodName), ['PETAL CHINA', '운송료', 'Gross weight', 'Chargeable weight']);
  assert.equal(legacy.rows[1].totalPrice, 1169);
  assert.deepEqual([legacy.meta.gw, legacy.meta.cw, legacy.meta.freight, legacy.meta.orderYear], [2543, 2543, 1169, '2026']);
  const nl = upload.parseWarehousePackingGrid(grid('2025/11/13', [['2', '운송료', '', '', '', '', '', '', '', '', 403.84, 403.84]]));
  assert.deepEqual([nl.rows[1].prodName, nl.rows[1].boxQty, nl.rows[1].steamQty, nl.rows[1].totalPrice], ['운송료', 1, 1, 403.84]);
  assert.equal(nl.meta.orderYear, '2025', 'cross-year file keeps its own year');
  const uncachedFreight = upload.parseWarehousePackingGrid(grid('2026/11/24', [['2', '운송료', '', '', '', 1, 1, 1, 1, 1, 24087, '']]));
  assert.equal(uncachedFreight.rows[1].totalPrice, 24087, 'uncached L=K*I freight formula falls back to K×I');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : ''}`);

const cache = new Map();
function load(relPath) {
  const full = path.resolve(relPath);
  if (cache.has(full)) return cache.get(full).exports;
  const mod = { exports: {} };
  cache.set(full, mod);
  const { code } = transformSync(fs.readFileSync(full, 'utf8'), false, Buffer.from(JSON.stringify({
    filename: full,
    jsc: { target: 'es2020', parser: { syntax: 'ecmascript' } },
    module: { type: 'commonjs' },
  })));
  new Function('require', 'module', 'exports', code)((id) => {
    if (id.startsWith('.')) {
      const resolved = path.resolve(path.dirname(full), id);
      if (id.endsWith('.cjs')) return require(resolved);
      return load(resolved.endsWith('.js') ? resolved : `${resolved}.js`);
    }
    return require(id);
  }, mod, mod.exports);
  return mod.exports;
}

const { buildPivotFieldVolumeInput, renderPivotFieldVolumeWorkbook } = load('lib/pivotFieldVolume.js');

test('Colombia families render single A3 landscape 현장물량표 with pallets, snow flake divisor, alstro stems/÷16, zero incoming, and null stock', async () => {
  const customers = [
    { custKey: 1, custName: '주광', area: '경부선_주광', custDescr: '주광/카-금/장-금/수-금/알-금' },
    { custKey: 2, custName: '양재꽃', area: '양재동', custDescr: '양재꽃/카-목/장-목/수-목/알-목' },
    { custKey: 3, custName: '날짜없는업체', area: '지방', custDescr: '날짜없는업체' },
  ];

  // 1) Rose with Snow Flake (25 bunches/box) + regular rose (10 bunches/box) + explicit 0 incoming
  const roseGroup = { country: '콜롬비아', flower: '장미', countryOnly: false };
  const roseRows = [
    {
      prodKey: 11,
      country: '콜롬비아',
      flower: '장미',
      prodName: 'ROSE Mondial White 60cm',
      unit: '단',
      ordersByCustKey: { 1: 10, 2: 20, 3: 10 },
      incoming: { 아유라: 50 },
      totalOrder: 40,
      totalIncoming: 50,
    },
    {
      prodKey: 12,
      country: '콜롬비아',
      flower: '장미',
      prodName: 'ROSE Snow Flake 50cm',
      unit: '단',
      ordersByCustKey: { 1: 25, 2: 0, 3: 0 },
      incoming: {},
      totalOrder: 25,
      totalIncoming: 0,
    },
  ];
  const roseInput = buildPivotFieldVolumeInput({
    data: { orderYear: 2026, weekStart: '41-01', weekEnd: '41-01' },
    group: roseGroup,
    rows: roseRows,
    customers,
    weekLabel: '41-01',
  });
  assert.equal(roseInput.plan.kind, 'field-volume-v2');
  assert.equal(roseInput.plan.orderYear, '2026');
  assert.equal(roseInput.plan.products[1].incoming, 0, 'explicit zero incoming must not become null');
  assert.equal(roseInput.plan.products[0].stock, null);
  assert.equal(roseInput.plan.products[1].stock, null);
  // 경부선주광 금: 10/10 + 25/25 = 2 boxes
  assert.equal(roseInput.plan.pallets.rose['["금","경부선주광"]'], 2);
  // 미지정 지방: 10/10 = 1 box
  assert.equal(roseInput.plan.pallets.rose['["미지정","지방"]'], 1);

  const roseBuf = await renderPivotFieldVolumeWorkbook({
    data: { orderYear: 2026, weekStart: '41-01', weekEnd: '41-01' },
    group: roseGroup,
    rows: roseRows,
    customers,
    weekLabel: '41-01',
  });
  const roseWb = new ExcelJS.Workbook();
  await roseWb.xlsx.load(roseBuf);
  assert.equal(roseWb.worksheets.length, 1);
  const ws = roseWb.worksheets[0];
  assert.equal(ws.name, '현장물량표');
  assert.equal(ws.pageSetup.paperSize, 8);
  assert.equal(ws.pageSetup.orientation, 'landscape');
  assert.match(ws.getCell('A1').text, /41-01 장미 현장물량표/);
  assert.deepEqual([1, 3, 4, 5, 6, 7].map(c => ws.getCell(2, c).text), ['품종', '출고요일 · 지역별 업체 수량 (농장분배)', '입고', '출고', '재고', '잔량']);
  const allText = ws.getSheetValues().flat().map(v => (v && v.richText ? v.richText.map(r => r.text).join('') : String(v ?? ''))).join('\n');
  assert.match(allText, /미지정 - 지방 날짜없는업체 10/);
  assert.match(allText, /장미 0\.1\(2\)/);

  // 2) Alstroemeria: ERP stems preserved in entries/totals, ÷16 for pallet boxes (no double-scaling)
  const alstroGroup = { country: '콜롬비아', flower: '알스트로', countryOnly: false };
  const alstroRows = [
    {
      prodKey: 21,
      country: '콜롬비아',
      flower: '알스트로',
      prodName: 'ALSTROMERIA Pink',
      unit: '송이',
      ordersByCustKey: { 1: 32 },
      incoming: { 농장A: 64 },
      totalOrder: 32,
      totalIncoming: 64,
    },
  ];
  const alstroInput = buildPivotFieldVolumeInput({
    data: { orderYear: 2026, weekStart: '41-01', weekEnd: '41-01' },
    group: alstroGroup,
    rows: alstroRows,
    customers,
    weekLabel: '41-01',
  });
  assert.equal(alstroInput.model.entries[0].current, 32);
  assert.equal(alstroInput.model.totals[0].incoming, 64);
  assert.equal(alstroInput.model.totals[0].outgoing, 32);
  assert.equal(alstroInput.plan.pallets.alstroemeria['["금","경부선주광"]'], 2);

  // 3) Hydrangea + Ruscus combined group
  const hydraGroup = { country: '콜롬비아', flower: '수국', countryOnly: false };
  const hydraRows = [
    { prodKey: 31, country: '콜롬비아', flower: '수국', prodName: 'HYDRANGEA White', unit: '박스', ordersByCustKey: { 1: 10 }, incoming: { H: 10 } },
    { prodKey: 32, country: '콜롬비아', flower: '루스커스', prodName: 'Ruscus Green 50cm', unit: '박스', ordersByCustKey: { 1: 7 }, incoming: { H: 7 } },
  ];
  const hydraBuf = await renderPivotFieldVolumeWorkbook({
    data: { orderYear: 2026, weekStart: '41-01', weekEnd: '41-01' },
    group: hydraGroup,
    rows: hydraRows,
    customers,
    weekLabel: '41-01',
  });
  const hydraWb = new ExcelJS.Workbook();
  await hydraWb.xlsx.load(hydraBuf);
  assert.match(hydraWb.worksheets[0].getCell('A1').text, /수국·루스커스 현장물량표/);
});

test('Non-pallet countries (중국, 태국, 호주, 네덜란드) and incoming-only species generate valid 현장물량표 without crashing', async () => {
  const customers = [
    { custKey: 1, custName: '서울꽃', area: '양재동', custDescr: '서울꽃/중-금/태-금/네-금' },
  ];
  for (const country of ['중국', '태국', '호주', '네덜란드']) {
    const group = { country, flower: country, countryOnly: true };
    const rows = [
      {
        prodKey: 100,
        country,
        flower: country === '네덜란드' ? '튤립' : country,
        prodName: country === '네덜란드' ? 'Tulip Strong Gold' : `${country} 품목`,
        productDescr: country === '네덜란드' ? '옐로우' : '',
        unit: '단',
        ordersByCustKey: { 1: 12 },
        incoming: { 농장: 0 },
      },
    ];
    const input = buildPivotFieldVolumeInput({
      data: { orderYear: 2025, weekStart: '41-01', weekEnd: '41-02' },
      group,
      rows,
      customers,
      weekLabel: '41-01~41-02',
    });
    assert.equal(input.plan.orderYear, '2025');
    assert.equal(input.plan.pallets, undefined);
    assert.equal(input.plan.selectedFamilies, undefined);
    const buf = await renderPivotFieldVolumeWorkbook({
      data: { orderYear: 2025, weekStart: '41-01', weekEnd: '41-02' },
      group,
      rows,
      customers,
      weekLabel: '41-01~41-02',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    assert.equal(wb.worksheets.length, 1);
    assert.match(wb.worksheets[0].getCell('A1').text, new RegExp(`41-01~41-02 ${country} 현장물량표`));
  }

  // Incoming-only (0 orders)
  const incomingOnlyBuf = await renderPivotFieldVolumeWorkbook({
    data: { orderYear: 2026, weekStart: '41-01', weekEnd: '41-01' },
    group: { country: '콜롬비아', flower: '카네이션', countryOnly: false },
    rows: [{ prodKey: 55, country: '콜롬비아', flower: '카네이션', prodName: 'CARNATION Doncel', unit: '박스', ordersByCustKey: {}, incoming: { A: 20 } }],
    customers,
    weekLabel: '41-01',
  });
  const incomingWb = new ExcelJS.Workbook();
  await incomingWb.xlsx.load(incomingOnlyBuf);
  assert.match(incomingWb.worksheets[0].getCell('C3').text, /출고 없음/);

  // Rejects invalid/missing orderYear (cross-year safety)
  assert.throws(() => buildPivotFieldVolumeInput({
    data: { orderYear: '', weekStart: '41-01' },
    group: { country: '콜롬비아', flower: '카네이션', countryOnly: false },
    rows: [{ prodKey: 1, prodName: 'Doncel', incoming: {} }],
    customers,
    weekLabel: '41-01',
  }), /연도/);
});

test('volume-board.js UI exposes groupBy=day default toggle and both download buttons cleanly', () => {
  const page = fs.readFileSync(path.join(process.cwd(), 'pages/stats/volume-board.js'), 'utf8');
  assert.match(page, /useState\('day'\)/);
  assert.match(page, /요일 > 지역 > 업체/);
  assert.match(page, /지역 > 요일 > 업체/);
  assert.match(page, /물량표 다운로드/);
  assert.match(page, /신형 물량표 다운로드/);
  assert.match(page, /format:\s*isField \? 'field' : 'legacy'/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx-js-style');
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : ''}`);

const {
  DAY_COLORS,
  getDayColor,
  getRegionColor,
  isMonochromeDefaultFill,
} = require('../lib/pivotVolumeColors.cjs');
const {
  isFractionalQty,
  formatDecimalQty,
  convertFractionalToUnit,
} = require('../lib/volumeDecimalUnits.cjs');
const { injectDecimalUnitShapes } = require('../lib/volumeDecimalShapes.cjs');
const { parseDistributionBaseline } = require('../lib/distributionBaseline.js');

const esmCache = new Map();
function loadEsm(relPath) {
  const full = path.resolve(relPath);
  if (esmCache.has(full)) return esmCache.get(full).exports;
  const mod = { exports: {} };
  esmCache.set(full, mod);
  const { code } = transformSync(fs.readFileSync(full, 'utf8'), false, Buffer.from(JSON.stringify({
    filename: full,
    jsc: { target: 'es2020', parser: { syntax: 'ecmascript' } },
    module: { type: 'commonjs' },
  })));
  new Function('require', 'module', 'exports', code)((id) => {
    if (id.startsWith('.')) {
      const resolved = path.resolve(path.dirname(full), id);
      if (id.endsWith('.cjs')) return require(resolved);
      return loadEsm(resolved.endsWith('.js') ? resolved : `${resolved}.js`);
    }
    return require(id);
  }, mod, mod.exports);
  return mod.exports;
}

function makePivotExcelHandler(mockData) {
  const fullPath = path.resolve('pages/api/stats/pivot-volume-excel.js');
  const source = fs.readFileSync(fullPath, 'utf8');
  const { code } = transformSync(source, false, Buffer.from(JSON.stringify({
    filename: fullPath,
    jsc: { target: 'es2020', parser: { syntax: 'ecmascript' } },
    module: { type: 'commonjs' },
  })));
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)((id) => {
    if (id.endsWith('/auth')) return { withAuth: fn => fn };
    if (id.endsWith('/farmKoreanNames')) return { getFarmDisplayName: x => x };
    if (id.endsWith('/pivotStats')) {
      return {
        customerDisplayLabel: c => String(c?.custName || '').trim(),
        makePivotVolumeSheetName: (c, f, used = new Set()) => {
          const name = `${c || ''}${f || ''}`.slice(0, 31);
          used.add(name);
          return name;
        },
        getPivotStats: async () => mockData,
      };
    }
    if (id.includes('/lib/')) {
      const resolved = path.resolve('pages/api/stats', id);
      if (resolved.endsWith('.cjs')) return require(resolved);
      return loadEsm(resolved.endsWith('.js') ? resolved : `${resolved}.js`);
    }
    return require(id);
  }, mod, mod.exports);

  return async (query) => {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      send(b) { this.body = b; return this; },
      json(b) { this.body = b; return this; },
    };
    await mod.exports.default({ method: 'GET', query, user: { userId: 'test' } }, res);
    return res;
  };
}

const { renderPivotFieldVolumeWorkbook } = loadEsm('lib/pivotFieldVolume.js');
const { fieldVolumePlan, renderFieldVolumeWorkbook } = loadEsm('lib/shipmentFieldVolume.js');
const { createUploadedFieldWorkbook } = loadEsm('lib/shipmentFieldUpload.js');
const { readFarmDrawingText } = loadEsm('lib/shipmentFarmDrawing.js');
const { palletSnapshot } = loadEsm('lib/shipmentPallet.js');
const { parseAllocationWorkbook } = (() => {
  const importSource = fs.readFileSync('lib/shipmentImport.js', 'utf8')
    .replace(/^import[\s\S]*?;\r?\n/gm, '')
    .replace(/^export \{[^}]+\} from [^;]+;/gm, '')
    .replace(/export /g, '');
  const parserCtx = { normalizeOrderWeek: x => x, cleanPivotProdName: x => x };
  require('node:vm').createContext(parserCtx);
  require('node:vm').runInContext(`${importSource}\nthis.parseAllocationWorkbook = parseAllocationWorkbook;`, parserCtx);
  return parserCtx;
})();

test('pivotVolumeColors: same day/region share identical color and unknown regions hash deterministically', () => {
  const days = ['목', '금', '토', '일', '화', '수', '월', '미지정'];
  const dayFills = days.map(d => getDayColor(d).fill);
  assert.equal(new Set(dayFills).size, days.length);
  assert.deepEqual(getDayColor('금요일'), getDayColor('금'));
  assert.deepEqual(getDayColor(''), DAY_COLORS['미지정']);

  assert.deepEqual(getRegionColor('경부선_주광'), getRegionColor('경부선주광'));
  assert.notEqual(getRegionColor('경부선').fill, getRegionColor('양재동').fill);
  assert.notEqual(getRegionColor('강남').fill, getRegionColor('호남선').fill);

  const customA = getRegionColor('신규지방테스트A');
  const customA2 = getRegionColor('신규 지방 테스트 A');
  assert.deepEqual(customA, customA2);
  assert.match(customA.fill, /^[0-9A-F]{6}$/);
  assert.match(customA.ink, /^[0-9A-F]{6}$/);

  for (const blank of ['', null, undefined, 'D9E6F2', 'E8EEF4', 'DCE6F2', 'FFFFFF', 'FFD9E6F2', '#e8eef4']) {
    assert.equal(isMonochromeDefaultFill(blank), true);
  }
  assert.equal(isMonochromeDefaultFill('FFF2CC'), false);
  assert.equal(isMonochromeDefaultFill('ABCDEF'), false);
});

test('volumeDecimalUnits: accurate DB unit conversion, snapping, negative/mixed, and safe fallbacks', () => {
  assert.equal(isFractionalQty(3), false);
  assert.equal(isFractionalQty(0), false);
  assert.equal(isFractionalQty(null), false);
  assert.equal(isFractionalQty(0.133333), true);
  assert.equal(formatDecimalQty(0.133333), '0.13');
  assert.equal(formatDecimalQty(0.5), '0.5');
  assert.equal(formatDecimalQty(1.25), '1.25');

  // 카네이션 2/15 -> 2단
  assert.deepEqual(
    convertFractionalToUnit(2 / 15, { unit: '박스', bunchOf1Box: 15, flower: '카네이션' }),
    { label: '2단', unit: '단', displayQty: '0.13' }
  );
  // 0.13 with B1B=8 -> 1단 (snap 1.04 -> 1)
  assert.deepEqual(
    convertFractionalToUnit(0.13, { unit: '박스', bunchOf1Box: 8, flower: '카네이션' }),
    { label: '1단', unit: '단', displayQty: '0.13' }
  );
  // B1B=15, 0.07 -> 1단 (snap 1.05 -> 1)
  assert.deepEqual(
    convertFractionalToUnit(0.07, { unit: '박스', bunchOf1Box: 15 }),
    { label: '1단', unit: '단', displayQty: '0.07' }
  );
  // 미니카네이션 B1B=30, 0.1 -> 3단
  assert.deepEqual(
    convertFractionalToUnit(0.1, { unit: '박스', bunchOf1Box: 30, flower: '미니카네이션' }),
    { label: '3단', unit: '단', displayQty: '0.1' }
  );
  // 수국 S1Box=30, 4/30 -> 4송이
  assert.deepEqual(
    convertFractionalToUnit(4 / 30, { unit: '박스', steamOf1Box: 30, flower: '수국' }),
    { label: '4송이', unit: '송이', displayQty: '0.13' }
  );
  // Mixed 1.2 (B1B=15) -> 1박스 3단
  assert.deepEqual(
    convertFractionalToUnit(1.2, { unit: '박스', bunchOf1Box: 15 }),
    { label: '1박스 3단', unit: '단', displayQty: '1.2' }
  );
  // 장미 OutUnit='단', 0.5 (S1B=10) -> 5송이
  assert.deepEqual(
    convertFractionalToUnit(0.5, { unit: '단', steamOf1Bunch: 10, flower: '장미' }),
    { label: '5송이', unit: '송이', displayQty: '0.5' }
  );
  // 단 without S1B -> 0.5단
  assert.deepEqual(
    convertFractionalToUnit(0.5, { unit: '단', steamOf1Bunch: 0 }),
    { label: '0.5단', unit: '단', displayQty: '0.5' }
  );
  // 송이 -> 0.5송이
  assert.deepEqual(
    convertFractionalToUnit(0.5, { unit: '송이' }),
    { label: '0.5송이', unit: '송이', displayQty: '0.5' }
  );
  // Integer & explicit 0 & unknown fallback -> null
  assert.equal(convertFractionalToUnit(3, { unit: '박스', bunchOf1Box: 15 }), null);
  assert.equal(convertFractionalToUnit(0, { unit: '박스', bunchOf1Box: 15 }), null);
  assert.equal(convertFractionalToUnit(0.5, { unit: '박스', bunchOf1Box: 0, steamOf1Box: 0, flower: '기타' }), null);
  assert.equal(convertFractionalToUnit(0.5, {}), null);
});

test('legacy pivot-volume-excel applies consistent day/region colors (both groupBy modes + Alstro pairs) and injects decimal badges only for fractional sheets', async () => {
  const customers = [
    { custKey: 1, custName: '주광', area: '경부선_주광', custDescr: '주광/카-금/알-금' },
    { custKey: 2, custName: '강남꽃', area: '강남', custDescr: '강남꽃/카-목/알-목' },
    { custKey: 3, custName: '신규업체', area: '신규지방테스트', custDescr: '신규업체/카-금/알-금' },
    { custKey: 4, custName: '목양재', area: '양재동', custDescr: '목양재/카-목/알-목' },
  ];

  // 1) groupBy=day with fractional carnation quantities
  const carnationData = {
    orderYear: 2026,
    weekStart: '41-01',
    weekEnd: '41-01',
    customers,
    customersByKey: customers,
    farms: ['아유라'],
    rows: [
      {
        prodKey: 101,
        country: '콜롬비아',
        flower: '카네이션',
        prodName: 'CARNATION Doncel',
        unit: '박스',
        bunchOf1Box: 15,
        steamOf1Bunch: 0,
        steamOf1Box: 0,
        orders: { 주광: 2 / 15, 강남꽃: 1, 신규업체: 0.2, 목양재: 2 },
        ordersByCustKey: { 1: 2 / 15, 2: 1, 3: 0.2, 4: 2 },
        incoming: { 아유라: 4 },
      },
    ],
  };
  const handler = makePivotExcelHandler(carnationData);
  const dayRes = await handler({ weekStart: '41-01', weekEnd: '41-01', orderYear: '2026', groupBy: 'day' });
  assert.equal(dayRes.statusCode, 200);
  const dayWb = new ExcelJS.Workbook();
  await dayWb.xlsx.load(dayRes.body);
  const daySheet = dayWb.getWorksheet('콜롬비아카네이션');
  assert.ok(daySheet);
  assert.equal(daySheet.getCell('A1').fill.fgColor.argb, 'FFD9E6F2', 'A1 title keeps default fill');

  // Verify day headers in Row 1 and region headers in Row 2
  const dayCustCols = [];
  for (let c = 2; c <= daySheet.columnCount; c += 1) {
    const label = daySheet.getCell(3, c).text;
    if (['강남꽃', '목양재', '주광', '신규업체'].includes(label)) {
      dayCustCols.push({ c, label });
    }
  }
  assert.equal(dayCustCols.length, 4);
  const mokCols = dayCustCols.filter(x => ['강남꽃', '목양재'].includes(x.label));
  const kumCols = dayCustCols.filter(x => ['주광', '신규업체'].includes(x.label));
  for (const col of mokCols) {
    assert.equal(daySheet.getCell(1, col.c).fill.fgColor.argb, `FF${getDayColor('목').fill}`);
  }
  for (const col of kumCols) {
    assert.equal(daySheet.getCell(1, col.c).fill.fgColor.argb, `FF${getDayColor('금').fill}`);
  }
  assert.notEqual(daySheet.getCell(1, mokCols[0].c).fill.fgColor.argb, daySheet.getCell(1, kumCols[0].c).fill.fgColor.argb);
  assert.equal(daySheet.getCell(2, dayCustCols.find(x => x.label === '주광').c).fill.fgColor.argb, `FF${getRegionColor('경부선_주광').fill}`);
  assert.equal(daySheet.getCell(2, dayCustCols.find(x => x.label === '강남꽃').c).fill.fgColor.argb, `FF${getRegionColor('강남').fill}`);
  assert.equal(daySheet.getCell(2, dayCustCols.find(x => x.label === '신규업체').c).fill.fgColor.argb, `FF${getRegionColor('신규지방테스트').fill}`);

  // Verify numeric cell retains exact float and 0.## numFmt
  const jgCol = dayCustCols.find(x => x.label === '주광').c;
  assert.ok(Math.abs(daySheet.getCell(4, jgCol).value - (2 / 15)) < 1e-6);
  assert.equal(daySheet.getCell(4, jgCol).numFmt, '0.##');

  // Verify drawing XML injected right of table with DecimalUnitBadge_*
  const dayZip = await JSZip.loadAsync(dayRes.body);
  const drawingXml = await dayZip.file('xl/drawings/drawing1.xml')?.async('string');
  assert.ok(drawingXml, 'fractional legacy workbook injects xl/drawings/drawing1.xml');
  assert.match(drawingXml, /name="DecimalUnitBadge_3_0"/);
  assert.match(drawingXml, /주광 2단/);
  assert.match(drawingXml, /신규업체 3단/);
  assert.doesNotMatch(drawingXml, /^[-*]/m);

  // 2) groupBy=region with Alstro 2-column pairs + integer-only sheet (no drawing XML)
  const alstroIntData = {
    orderYear: 2026,
    weekStart: '41-01',
    weekEnd: '41-01',
    customers,
    customersByKey: customers,
    farms: ['아유라'],
    rows: [
      {
        prodKey: 201,
        country: '콜롬비아',
        flower: '알스트로',
        prodName: 'ALSTROMERIA Pink',
        unit: '송이',
        bunchOf1Box: 0,
        steamOf1Bunch: 0,
        steamOf1Box: 16,
        orders: { 주광: 16, 강남꽃: 32, 신규업체: 16, 목양재: 0 },
        ordersByCustKey: { 1: 16, 2: 32, 3: 16, 4: 0 },
        incoming: { 아유라: 64 },
      },
    ],
  };
  const alstroHandler = makePivotExcelHandler(alstroIntData);
  const regRes = await alstroHandler({ weekStart: '41-01', weekEnd: '41-01', orderYear: '2026', groupBy: 'region' });
  assert.equal(regRes.statusCode, 200);
  const regWb = new ExcelJS.Workbook();
  await regWb.xlsx.load(regRes.body);
  const alstroSheet = regWb.getWorksheet('콜롬비아알스트로');
  assert.equal(alstroSheet.getCell('A2').text, '알스트로 ERP 수량 (÷16 참고)');
  // B1/C1 (paired region header), B2/C2 (paired day header) share exact colors
  assert.equal(alstroSheet.getCell('B1').fill.fgColor.argb, alstroSheet.getCell('C1').fill.fgColor.argb);
  assert.equal(alstroSheet.getCell('B2').fill.fgColor.argb, alstroSheet.getCell('C2').fill.fgColor.argb);
  assert.equal(alstroSheet.getCell('B1').fill.fgColor.argb, `FF${getRegionColor('경부선_주광').fill}`);
  assert.equal(alstroSheet.getCell('B2').fill.fgColor.argb, `FF${getDayColor('금').fill}`);

  const regZip = await JSZip.loadAsync(regRes.body);
  assert.equal(regZip.file('xl/drawings/drawing1.xml'), null, 'integer-only workbook must NOT add drawing XML');
});

test('신형 현장물량표 (both pivotFieldVolume & monochrome uploaded fieldVolumePlan) keeps day/region colors, formulas, and post-compaction decimal badges', async () => {
  const customers = [
    { custKey: 1, custName: '주광', area: '경부선_주광', custDescr: '주광/수-금' },
    { custKey: 2, custName: '강남꽃', area: '강남', custDescr: '강남꽃/수-목' },
  ];
  const hydraRows = [
    {
      prodKey: 301,
      country: '콜롬비아',
      flower: '수국',
      prodName: 'HYDRANGEA White',
      unit: '박스',
      bunchOf1Box: 0,
      steamOf1Bunch: 0,
      steamOf1Box: 30,
      ordersByCustKey: { 1: 4 / 30 },
      incoming: { FarmA: 1 },
    },
    {
      prodKey: 302,
      country: '콜롬비아',
      flower: '수국',
      prodName: 'HYDRANGEA Blue',
      unit: '박스',
      bunchOf1Box: 0,
      steamOf1Bunch: 0,
      steamOf1Box: 30,
      ordersByCustKey: { 2: 1 },
      incoming: { FarmA: 1 },
    },
  ];
  // 2 short cultivars trigger compactFieldRows (A..I layout)
  const buf = await renderPivotFieldVolumeWorkbook({
    data: { orderYear: 2026, weekStart: '41-01', weekEnd: '41-01' },
    group: { country: '콜롬비아', flower: '수국', countryOnly: false },
    rows: hydraRows,
    customers,
    weekLabel: '41-01',
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.name, '현장물량표');
  // Compacted layout (A..I + +2 printArea = A..K)
  assert.match(ws.pageSetup.printArea, /^A1:K\d+$/);
  // Check formulas intact on compacted sheet
  assert.match(ws.getCell('F3').formula, /^SUM\(/);

  // Footer day header + region cell colors
  const dayRowIdx = ws.getColumn(1).values.findIndex(v => v === '금요일');
  const regRowIdx = ws.getColumn(1).values.findIndex(v => v === '금요일 · 경부선주광');
  assert.ok(dayRowIdx > 0 && regRowIdx > 0);
  assert.equal(ws.getCell(dayRowIdx, 1).fill.fgColor.argb, `FF${getDayColor('금').fill}`);
  assert.equal(ws.getCell(regRowIdx, 1).fill.fgColor.argb, `FF${getRegionColor('경부선주광').fill}`);

  const zip = await JSZip.loadAsync(buf);
  const drawingXml = await zip.file('xl/drawings/drawing1.xml')?.async('string');
  assert.ok(drawingXml, '신형 현장물량표 injects decimal unit badge drawing');
  assert.match(drawingXml, /<xdr:from><xdr:col>9<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>2<\/xdr:row>/);
  assert.match(drawingXml, /DecimalUnitBadge_2_0/);
  assert.match(drawingXml, /4송이/);

  // Monochrome uploaded workbook fallback test via fieldVolumePlan
  const monoWb = new ExcelJS.Workbook();
  const monoWs = monoWb.addWorksheet('원본');
  monoWs.addRow(['41-01 카네이션', '양재동', '강남']);
  monoWs.addRow(['', '금', '목']);
  monoWs.addRow(['', '업체A', '업체B', '주문', '입고', '재고', '잔량']);
  monoWs.addRow(['돈셀', 1.2, 2, 3.2, 5, 0, 1.8]);
  // Explicitly monochrome header fills (E8EEF4 / D9E6F2)
  monoWs.getCell('B2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF4' } };
  monoWs.getCell('C2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E6F2' } };
  const monoBuf = Buffer.from(await monoWb.xlsx.writeBuffer());

  const plan = await fieldVolumePlan(monoBuf, {
    orderYear: '2026',
    week: '41-01',
    rows: [
      {
        sheetName: '원본', prodKey: 501, custKey: 1, custName: '업체A',
        outUnit: '박스', excelUnit: '박스', productLabel: '돈셀', productFamily: 'carnation',
        bunchOf1Box: 15, uploadQty: 1.2, excelQty: 1.2, cells: ['원본!R4C2'],
      },
      {
        sheetName: '원본', prodKey: 501, custKey: 2, custName: '업체B',
        outUnit: '박스', excelUnit: '박스', productLabel: '돈셀', productFamily: 'carnation',
        bunchOf1Box: 15, uploadQty: 2, excelQty: 2, cells: ['원본!R4C3'],
      },
    ],
  });
  // Monochrome fills stored in plan.colors fallback to distinct day colors when rendered
  const renderedBuf = await renderFieldVolumeWorkbook(plan, {
    entries: [
      { date: '금', region: '양재동', custKey: 1, customer: '업체A', product: plan.products[0], previous: 0, current: 1.2, details: [] },
      { date: '목', region: '강남', custKey: 2, customer: '업체B', product: plan.products[0], previous: 0, current: 2, details: [] },
    ],
    totals: [{ ...plan.products[0], outgoing: 3.2 }],
    farms: new Map(),
    details: new Map(),
    lines: [],
  });
  const renderedWb = new ExcelJS.Workbook();
  await renderedWb.xlsx.load(renderedBuf);
  const rWs = renderedWb.worksheets[0];
  const rKum = rWs.getColumn(1).values.findIndex(v => v === '금요일');
  const rMok = rWs.getColumn(1).values.findIndex(v => v === '목요일');
  assert.equal(rWs.getCell(rKum, 1).fill.fgColor.argb, `FF${getDayColor('금').fill}`);
  assert.equal(rWs.getCell(rMok, 1).fill.fgColor.argb, `FF${getDayColor('목').fill}`);
  assert.notEqual(rWs.getCell(rKum, 1).fill.fgColor.argb, rWs.getCell(rMok, 1).fill.fgColor.argb);
  assert.equal(rWs.getCell('D3').numFmt, undefined); // 5 is integer
  assert.equal(rWs.getCell('E3').numFmt, '0.##'); // 3.2 is fractional
  assert.equal(rWs.getCell('G3').formula, 'D3+F3-E3');
  assert.match(rWs.pageSetup.printArea, /^A1:I\d+$/);

  const rZip = await JSZip.loadAsync(renderedBuf);
  const rDrawing = await rZip.file('xl/drawings/drawing1.xml')?.async('string');
  assert.match(rDrawing, /<xdr:from><xdr:col>7<\/xdr:col>/);
  assert.match(rDrawing, /1박스 3단/);

  // createUploadedFieldWorkbook with optional productUnits map
  const uploadedBuf = await createUploadedFieldWorkbook(
    monoBuf,
    [
      { sheetName: '원본', rowNo: 4, colNo: 2, customerLabel: '업체A', productLabel: '돈셀', productFamily: 'carnation', prodKey: 501 },
      { sheetName: '원본', rowNo: 4, colNo: 3, customerLabel: '업체B', productLabel: '돈셀', productFamily: 'carnation', prodKey: 501 },
    ],
    {
      filename: '41-01 카네이션.xlsx',
      week: '2026-41-01',
      productUnits: { 501: { outUnit: '박스', bunchOf1Box: 15, steamOf1Bunch: 0, steamOf1Box: 0 } },
    }
  );
  const uZip = await JSZip.loadAsync(uploadedBuf);
  const uDrawing = await uZip.file('xl/drawings/drawing1.xml')?.async('string');
  assert.ok(uDrawing);
  assert.match(uDrawing, /업체A 1박스 3단/);
});

test('distribute-import roundtrip & shipmentFarmDrawing non-collision with DecimalUnitBadge_* drawings', async () => {
  const customers = [
    { custKey: 1, custName: '주광', area: '경부선_주광', custDescr: '주광/카-목' },
    { custKey: 2, custName: '양재꽃', area: '양재동', custDescr: '양재꽃/카-금' },
  ];
  const mockData = {
    orderYear: 2026,
    weekStart: '41-01',
    weekEnd: '41-01',
    customers,
    customersByKey: customers,
    farms: ['아유라'],
    rows: [
      {
        prodKey: 101,
        country: '콜롬비아',
        flower: '카네이션',
        prodName: 'CARNATION Doncel',
        unit: '박스',
        bunchOf1Box: 15,
        steamOf1Bunch: 0,
        steamOf1Box: 0,
        orders: { 주광: 2 / 15, 양재꽃: 3 },
        ordersByCustKey: { 1: 2 / 15, 2: 3 },
        incoming: { 아유라: 5 },
      },
    ],
  };
  const handler = makePivotExcelHandler(mockData);
  const res = await handler({ weekStart: '41-01', weekEnd: '41-01', orderYear: '2026', groupBy: 'day' });
  assert.equal(res.statusCode, 200);

  // 1) Parse generated workbook with XLSX
  const wb = XLSX.read(res.body, { type: 'buffer', cellStyles: true });
  const parsed = parseAllocationWorkbook(XLSX, wb);
  assert.equal(parsed.rows.length, 2);
  const jgRow = parsed.rows.find(r => r.custKey === 1);
  assert.ok(Math.abs(jgRow.uploadQty - (2 / 15)) < 1e-6);

  // 2) readFarmDrawingText MUST return '' (never mistake DecimalUnitBadge_* for a farm memo)
  assert.equal(await readFarmDrawingText(res.body), '');

  // Defense-in-depth: even if a DecimalUnitBadge_* shape somehow had bullet+paren text, it is ignored,
  // while a genuine farm text box in the same drawing XML is still extracted!
  const mixedZip = await JSZip.loadAsync(res.body);
  const existing = await mixedZip.file('xl/drawings/drawing1.xml').async('string');
  const withFakeAndReal = existing.replace(
    '</xdr:wsDr>',
    '<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="90" name="DecimalUnitBadge_99_0"/></xdr:nvSpPr><xdr:txBody><a:p><a:r><a:t>-무시할배지 2단(오탐)</a:t></a:r></a:p></xdr:txBody></xdr:sp>'
    + '<xdr:sp><xdr:nvSpPr><xdr:cNvPr id="91" name="FarmMemo1"/></xdr:nvSpPr><xdr:txBody><a:p><a:r><a:t>*그린 농장분배</a:t></a:r></a:p><a:p><a:r><a:t>돈셀 2단(아유라)</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:wsDr>'
  );
  mixedZip.file('xl/drawings/drawing1.xml', withFakeAndReal);
  const mixedText = await readFarmDrawingText(await mixedZip.generateAsync({ type: 'nodebuffer' }));
  assert.match(mixedText, /돈셀 2단\(아유라\)/);
  assert.doesNotMatch(mixedText, /무시할배지/);

  // 3) fieldVolumePlan reads distinct per-day colors from Row 1 and regions from Row 2
  const plan = await fieldVolumePlan(res.body, {
    orderYear: '2026',
    week: '41-01',
    rows: parsed.rows.map(r => ({
      sheetName: r.sheetName,
      prodKey: r.prodKey,
      custKey: r.custKey,
      custName: r.custKey === 1 ? '주광' : '양재꽃',
      outUnit: '박스',
      excelUnit: '박스',
      productLabel: r.productLabel,
      productFamily: r.productFamily,
      bunchOf1Box: 15,
      uploadQty: r.uploadQty,
      excelQty: r.uploadQty,
      cells: [`${r.sheetName}!R${r.rowNo}C${r.colNo}`],
    })),
  }, wb);
  assert.equal(plan.colors['목'], getDayColor('목').fill);
  assert.equal(plan.colors['금'], getDayColor('금').fill);
  assert.equal(plan.customers.find(c => c.custKey === 1).region, '경부선주광');
  assert.equal(plan.customers.find(c => c.custKey === 2).region, '양재동');

  // 4) palletSnapshot & parseDistributionBaseline succeed cleanly
  const snap = palletSnapshot(XLSX, wb, parsed.rows);
  assert.ok(snap.carnation['["목","경부선주광"]'] > 0);
  const baselineWb = XLSX.read(res.body, { type: 'buffer' });
  baselineWb.Sheets['콜롬비아카네이션'].A1 = { t: 's', v: '2026 차수(41-01) 품종(카네이션)' };
  const baseline = parseDistributionBaseline(baselineWb, { year: 2026, week: '41-01' });
  assert.equal(baseline.issues.length, 0);

  // 5) injectDecimalUnitShapes preserves existing drawing XML without duplicate <drawing r:id="..."/>
  const appendedBuf = await injectDecimalUnitShapes(res.body, {
    '콜롬비아카네이션': [{ row: 4, col: 9, text: '추가 1단' }],
  });
  const appendedZip = await JSZip.loadAsync(appendedBuf);
  const sheet1Xml = await appendedZip.file('xl/worksheets/sheet1.xml').async('string');
  assert.equal((sheet1Xml.match(/<drawing\b/g) || []).length, 1);
  const appendedDrawing = await appendedZip.file('xl/drawings/drawing1.xml').async('string');
  assert.match(appendedDrawing, /DecimalUnitBadge_3_0/);
  assert.match(appendedDrawing, /DecimalUnitBadge_4_0/);
});

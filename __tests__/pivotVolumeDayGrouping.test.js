const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('xlsx-js-style');
const ExcelJS = require('exceljs');
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : ''}`);

const moduleCache = new Map();
function loadEsm(relPath) {
  const full = path.resolve(relPath);
  if (moduleCache.has(full)) return moduleCache.get(full).exports;
  const mod = { exports: {} };
  moduleCache.set(full, mod);
  const { code } = transformSync(fs.readFileSync(full, 'utf8'), false, Buffer.from(JSON.stringify({
    filename: full,
    jsc: { target: 'es2020', parser: { syntax: 'ecmascript' } },
    module: { type: 'commonjs' },
  })));
  new Function('require', 'module', 'exports', code)((id) => {
    if (id.startsWith('.')) {
      const target = path.resolve(path.dirname(full), id);
      if (id.endsWith('.cjs')) return require(target);
      return loadEsm(target.endsWith('.js') ? target : `${target}.js`);
    }
    return require(id);
  }, mod, mod.exports);
  return mod.exports;
}

async function createSheetContext() {
  const context = {
    XLSX,
    getFarmDisplayName: x => x,
    customerDisplayLabel: c => c.custName,
    ...require('../lib/pivotVolumeColors.cjs'),
    ...require('../lib/volumeDecimalUnits.cjs'),
    ...require('../lib/volumeDecimalShapes.cjs'),
  };
  for (const name of [
    'pivotVolumeRows',
    'pivotVolumeCombinedCells',
    'pivotVolumeProductLabel',
    'pivotCustomerQuantity',
    'pivotVolumeNetherlands',
    'pivotVolumeCustDays',
    'pivotVolumeGrouping',
    'productColor',
  ]) {
    Object.assign(context, await import(`../lib/${name}.js`));
  }
  const source = fs.readFileSync('pages/api/stats/pivot-volume-excel.js', 'utf8')
    .split('export default withAuth')[0]
    .replace(/^import[\s\S]*?;\r?\n/gm, '');
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.generate = makeSheet; this.plan = makeColumnPlan; this.groups = makeCustomerGroups;`, context);
  return context;
}

function makeExcelHandler(mockData) {
  const source = fs.readFileSync('pages/api/stats/pivot-volume-excel.js', 'utf8');
  const { code } = transformSync(source, false, Buffer.from(JSON.stringify({
    filename: path.resolve('pages/api/stats/pivot-volume-excel.js'),
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

function buildWorkbookFromSheet(ws, keymap, sheetName = '물량표') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  if (keymap?.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['type', 'sheet', 'label', 'key'], ...keymap.map(k => [k.kind, sheetName, k.label, k.key])]),
      '_keymap'
    );
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

test('groupBy=day orders weekdays (목→금→토→일→화→수→월→미지정), 경부선_주광 first then appearance order, and 주광→주광여분→기타', async () => {
  const ctx = await createSheetContext();
  const customers = [
    { custKey: 1, custName: '부산B', area: '지방', custDescr: '부산B/카-금' },
    { custKey: 2, custName: '양재A', area: '양재동', custDescr: '양재A/카-월' },
    { custKey: 3, custName: '주광여분', area: '경부선_주광', custDescr: '주광여분/카-목' },
    { custKey: 4, custName: '주광', area: '경부선_주광', custDescr: '주광/카-목' },
    { custKey: 5, custName: '호남C', area: '호남선', custDescr: '호남C/카-목' },
    { custKey: 6, custName: '양재D', area: '양재동', custDescr: '양재D/카-토' },
    { custKey: 7, custName: '호텔E', area: '호텔', custDescr: '호텔E/카-일' },
    { custKey: 8, custName: '화요일업체', area: '지방', custDescr: '화요일업체/카-화' },
    { custKey: 9, custName: '수요일업체', area: '지방', custDescr: '수요일업체/카-수' },
    { custKey: 10, custName: '미지정업체', area: '지방', custDescr: '미지정업체' },
    { custKey: 11, custName: '금지방A', area: '지방', custDescr: '금지방A/카-금' },
    { custKey: 12, custName: '금양재A', area: '양재동', custDescr: '금양재A/카-금' },
  ];
  const row = {
    prodKey: 101,
    prodName: 'CARNATION Doncel',
    country: '콜롬비아',
    flower: '카네이션',
    ordersByCustKey: Object.fromEntries(customers.map((c, idx) => [String(c.custKey), idx + 1])),
    orders: Object.fromEntries(customers.map((c, idx) => [c.custName, idx + 1])),
    incoming: { 아유라: 100 },
  };
  const { ws, keymap } = ctx.generate([row], customers, ['아유라'], {
    orderYear: 2026,
    weekLabel: '41-01',
    country: '콜롬비아',
    flower: '카네이션',
    groupBy: 'day',
  });
  const plan = ctx.plan([row], customers, ['아유라'], {
    orderYear: 2026,
    weekLabel: '41-01',
    country: '콜롬비아',
    flower: '카네이션',
    groupBy: 'day',
  });
  const customerCols = plan.filter(c => c.type === 'customer');
  assert.deepEqual(
    customerCols.map(c => c.label),
    ['주광', '주광여분', '호남C', '금지방A', '부산B', '금양재A', '양재D', '호텔E', '화요일업체', '수요일업체', '양재A', '미지정업체']
  );

  // Middle product column inserted once for 12 customers (>10) before day group reaching >= ceil(12/2)=6
  const middleCols = plan.filter(c => c.type === 'product' && c.section === 'middle');
  assert.equal(middleCols.length, 1);
  const middleIdx = plan.indexOf(middleCols[0]);
  assert.equal(plan.slice(0, middleIdx).filter(c => c.type === 'customer').length, 6);

  // Row 1 shows day only on isDayStart, Row 2 shows region only on isRegionStart
  assert.equal(ws.B1.v, '목');
  assert.equal(ws.C1.v, '');
  assert.equal(ws.D1.v, '');
  assert.equal(ws.E1.v, '금');
  assert.equal(ws.B2.v, '경부선_주광');
  assert.equal(ws.C2.v, '');
  assert.equal(ws.D2.v, '호남선');
  assert.equal(ws.E2.v, '지방');
  assert.equal(ws.F2.v, '');
  assert.equal(ws.G2.v, '양재동');
  assert.equal(ws['!rows'][1].hpt, 22);

  const lastCust = plan.filter(c => c.type === 'customer').at(-1);
  const lastCustColIdx = plan.indexOf(lastCust);
  assert.equal(ws[XLSX.utils.encode_cell({ r: 0, c: lastCustColIdx })].v, '미지정');
  assert.ok(keymap.some(k => k.kind === 'meta' && k.label === 'groupBy' && k.key === 'day'));

  // Omitted / falsy groupBy keeps legacy region > day > customer layout
  for (const omitted of [undefined, null, '', 0, false, 'region', 'unknown']) {
    const legacyPlan = ctx.plan([row], customers, ['아유라'], {
      orderYear: 2026,
      weekLabel: '41-01',
      country: '콜롬비아',
      flower: '카네이션',
      groupBy: omitted,
    });
    const legacyFirst = legacyPlan.find(c => c.type === 'customer');
    assert.equal(legacyFirst.region, '경부선_주광');
    const legacyWs = ctx.generate([row], customers, ['아유라'], {
      orderYear: 2026,
      weekLabel: '41-01',
      country: '콜롬비아',
      flower: '카네이션',
      groupBy: omitted,
    }).ws;
    assert.equal(legacyWs.B1.v, '경부선_주광');
    assert.equal(legacyWs.B2.v, '목');
    assert.equal(legacyWs['!rows'][1].hpt, 20);
  }
});

test('groupBy=day keeps Row 2 region labels even with combined cells, preserves China/NL CL row and Alstro box pairs', async () => {
  const ctx = await createSheetContext();
  const customers = [
    { custKey: 1, custName: '업체A', area: '지방', orderCode: 'CL10', custDescr: '업체A/알-금/중-금/네-금' },
    { custKey: 2, custName: '업체B', area: '양재동', orderCode: 'CL20', custDescr: '업체B/알-금/중-금/네-금' },
  ];
  const combinedData = {
    orderYear: 2026,
    weeks: ['41-01', '41-02'],
    byWeek: {
      '41-01': { rows: [{ prodKey: 5, prodName: 'ALSTROMERIA Pink', flower: '알스트로', country: '콜롬비아', orders: { 업체A: 16, 업체B: 32 }, ordersByCustKey: { 1: 16, 2: 32 } }] },
      '41-02': { rows: [{ prodKey: 5, prodName: 'ALSTROMERIA Pink', flower: '알스트로', country: '콜롬비아', orders: { 업체A: 16, 업체B: 0 }, ordersByCustKey: { 1: 16, 2: 0 } }] },
    },
  };
  const combined = ctx.combinedCellContext(combinedData, '1');
  const alstroRow = {
    prodKey: 5,
    prodName: 'ALSTROMERIA Pink',
    flower: '알스트로',
    country: '콜롬비아',
    orders: { 업체A: 32, 업체B: 32 },
    ordersByCustKey: { 1: 32, 2: 32 },
    incoming: { FarmA: 64 },
  };
  const { ws: alstroWs } = ctx.generate([alstroRow], customers, ['FarmA'], {
    orderYear: 2026,
    weekLabel: '41-01~41-02',
    country: '콜롬비아',
    flower: '알스트로',
    groupBy: 'day',
    combined,
  });
  assert.equal(alstroWs.A2.v, '알스트로 ERP 수량 (÷16 참고)');
  assert.equal(alstroWs.B1.v, '금');
  assert.equal(alstroWs.B2.v, '지방');
  assert.equal(alstroWs.D2.v, '양재동');
  assert.equal(alstroWs.B3.v, '업체A');
  assert.equal(alstroWs.C3.v, '');
  assert.ok(alstroWs['!merges'].some(m => m.s.r === 2 && m.s.c === 1 && m.e.c === 2));
  assert.equal(alstroWs.F4.f, 'SUM(INDEX(4:4,1,2):INDEX(4:4,1,COLUMN()-1))');

  const dutchRow = {
    prodKey: 9,
    prodName: 'Tulip White',
    flower: '튤립',
    country: '네덜란드',
    productDescr: '화이트',
    orders: { 업체A: 10, 업체B: 20 },
    ordersByCustKey: { 1: 10, 2: 20 },
    incoming: { NL: 50 },
  };
  const { ws: nlWs } = ctx.generate([dutchRow], customers, ['NL'], {
    orderYear: 2026,
    weekLabel: '41-01',
    country: '네덜란드',
    flower: '네덜란드',
    groupBy: 'day',
  });
  assert.equal(nlWs.A3.v, '꽃');
  assert.equal(nlWs.B3.v, '품목명');
  assert.equal(nlWs.C3.v, '칼라');
  assert.equal(nlWs.A4.v, '클라이언트 번호');
  assert.equal(nlWs.D1.v, '금');
  assert.equal(nlWs.D2.v, '지방');
  assert.equal(nlWs.D3.v, '업체A');
  assert.equal(nlWs.D4.v, 'CL10');
});

test('roundtrip parsing supports both groupBy=region and groupBy=day across fieldVolumePlan, shipmentFieldUpload, shipmentPallet, and distributionBaseline', async () => {
  const ctx = await createSheetContext();
  const { fieldVolumePlan } = loadEsm('lib/shipmentFieldVolume.js');
  const { createUploadedFieldWorkbook } = loadEsm('lib/shipmentFieldUpload.js');
  const { palletSnapshot } = loadEsm('lib/shipmentPallet.js');
  const { parseAllocationWorkbook } = loadEsm('lib/shipmentImport.js');
  const { parseDistributionBaseline } = require('../lib/distributionBaseline');

  const customers = [
    { custKey: 1, custName: '주광', area: '경부선_주광', custDescr: '주광/카-금' },
    { custKey: 2, custName: '호남상사', area: '호남선', custDescr: '호남상사/카-금' },
    { custKey: 3, custName: '양재꽃', area: '양재동', custDescr: '양재꽃/카-목' },
  ];
  const row = {
    prodKey: 77,
    prodName: 'CARNATION Doncel',
    country: '콜롬비아',
    flower: '카네이션',
    orders: { 주광: 5, 호남상사: 4, 양재꽃: 3 },
    ordersByCustKey: { 1: 5, 2: 4, 3: 3 },
    incoming: { 아유라: 15 },
  };

  for (const mode of ['region', 'day']) {
    const { ws, keymap } = ctx.generate([row], customers, ['아유라'], {
      orderYear: 2026,
      weekLabel: '41-01',
      country: '콜롬비아',
      flower: '카네이션',
      groupBy: mode,
    });
    ws.A1 = { t: 's', v: '2026 차수(41-01) 품종(카네이션)' };
    const buffer = buildWorkbookFromSheet(ws, keymap, '카네이션');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const parsedRows = parseAllocationWorkbook(XLSX, wb).rows;

    // 1. fieldVolumePlan
    const plan = await fieldVolumePlan(buffer, {
      orderYear: '2026',
      week: '41-01',
      rows: parsedRows.map(r => ({
        ...r,
        prodKey: 77,
        custKey: r.custKey,
        custName: r.customerLabel,
        outUnit: '박스',
        excelQty: r.uploadQty,
        uploadQty: r.uploadQty,
        cells: [`${r.sheetName}!R${r.rowNo}C${r.colNo}`],
      })),
    }, wb);
    assert.equal(plan.customers.find(c => c.custKey === 1).region, '경부선주광');
    assert.equal(plan.customers.find(c => c.custKey === 2).region, '호남선');
    assert.equal(plan.customers.find(c => c.custKey === 3).region, '양재동');

    // 2. shipmentFieldUpload (even without _keymap)
    const strippedWb = XLSX.read(buffer, { type: 'buffer' });
    delete strippedWb.Sheets._keymap;
    strippedWb.SheetNames = strippedWb.SheetNames.filter(n => n !== '_keymap');
    const strippedBuf = Buffer.from(XLSX.write(strippedWb, { type: 'buffer', bookType: 'xlsx' }));
    const fieldOut = await createUploadedFieldWorkbook(strippedBuf, parsedRows, {
      filename: '41-01 카네이션.xlsx',
      week: '2026-41-01',
    });
    const fieldBook = new ExcelJS.Workbook();
    await fieldBook.xlsx.load(fieldOut);
    const bodyText = fieldBook.worksheets[0].getCell('C3').text;
    assert.match(bodyText, /목요일 - 양재동 양재꽃 3/);
    assert.match(bodyText, /금요일 - 경부선주광 주광 5 \/ 호남선 호남상사 4/);

    // 3. shipmentPallet
    const pallets = palletSnapshot(XLSX, wb, parsedRows);
    assert.equal(pallets.carnation['["목","양재동"]'], 3);
    assert.equal(pallets.carnation['["금","경부선주광"]'], 5);
    assert.equal(pallets.carnation['["금","호남선"]'], 4);

    // 4. distributionBaseline (both with _keymap and without _keymap)
    for (const targetWb of [wb, strippedWb]) {
      const baseline = parseDistributionBaseline(targetWb, { year: 2026, week: '41-01' });
      const clients = baseline.sheets[0].clients;
      assert.equal(clients.find(c => c.label === '주광').day, '금');
      assert.equal(clients.find(c => c.label === '호남상사').day, '금');
      assert.equal(clients.find(c => c.label === '양재꽃').day, '목');
    }
  }
});

test('API handler enforces groupBy=region default, -요일별 suffix for groupBy=day, and format=field validation/output', async () => {
  const mockData = {
    orderYear: 2026,
    weekStart: '41-01',
    weekEnd: '41-01',
    customersByKey: [
      { custKey: 1, custName: '갑', area: '양재동', custDescr: '갑/카-목' },
      { custKey: 2, custName: '을', area: '지방', custDescr: '을/카-금' },
    ],
    farms: ['아유라'],
    rows: [
      {
        prodKey: 10,
        country: '콜롬비아',
        flower: '카네이션',
        prodName: 'CARNATION Doncel',
        unit: '박스',
        orders: { 갑: 3, 을: 2 },
        ordersByCustKey: { 1: 3, 2: 2 },
        incoming: { 아유라: 8 },
        totalOrder: 5,
        totalIncoming: 8,
      },
    ],
  };
  const callApi = makeExcelHandler(mockData);

  const legacyRes = await callApi({ orderYear: '2026', weekStart: '41-01', weekEnd: '41-01' });
  assert.equal(legacyRes.statusCode, 200);
  const legacyFile = decodeURIComponent(legacyRes.headers['Content-Disposition'].match(/filename\*=UTF-8''([^;]+)/)[1]);
  assert.equal(legacyFile, '2026_41-01_통합물량표.xlsx');
  const legacyWb = XLSX.read(legacyRes.body, { type: 'buffer' });
  assert.equal(legacyWb.Sheets['콜롬비아카네이션'].B1.v, '양재동');

  const dayRes = await callApi({ orderYear: '2026', weekStart: '41-01', weekEnd: '41-01', groupBy: 'day', species: '콜롬비아|카네이션' });
  assert.equal(dayRes.statusCode, 200);
  const dayFile = decodeURIComponent(dayRes.headers['Content-Disposition'].match(/filename\*=UTF-8''([^;]+)/)[1]);
  assert.equal(dayFile, '4101_콜롬비아카네이션-요일별.xlsx');
  const dayWb = XLSX.read(dayRes.body, { type: 'buffer' });
  assert.equal(dayWb.Sheets['콜롬비아카네이션'].B1.v, '목');
  assert.equal(dayWb.Sheets['콜롬비아카네이션'].B2.v, '양재동');
  const kmRows = XLSX.utils.sheet_to_json(dayWb.Sheets._keymap, { header: 1 });
  assert.ok(kmRows.some(r => r[0] === 'meta' && r[1] === '콜롬비아카네이션' && r[2] === 'groupBy' && r[3] === 'day'));

  const badFieldRes = await callApi({ orderYear: '2026', weekStart: '41-01', weekEnd: '41-01', format: 'field' });
  assert.equal(badFieldRes.statusCode, 400);

  const fieldRes = await callApi({ orderYear: '2026', weekStart: '41-01', weekEnd: '41-01', format: 'field', species: '콜롬비아|카네이션' });
  assert.equal(fieldRes.statusCode, 200);
  const fieldFile = decodeURIComponent(fieldRes.headers['Content-Disposition'].match(/filename\*=UTF-8''([^;]+)/)[1]);
  assert.equal(fieldFile, '2026_41-01_콜롬비아카네이션-신형물량표.xlsx');
  const fieldWb = new ExcelJS.Workbook();
  await fieldWb.xlsx.load(fieldRes.body);
  assert.equal(fieldWb.worksheets[0].name, '현장물량표');
});

// Local-only large-fixture benchmark for the EXE-compatible pivot.
// All API responses are in-memory GET mocks. Non-GET API calls and all
// non-localhost requests are blocked. No ERP/database writes are performed.
//
// Usage:
//   $env:NODE_PATH='C:/Users/USER/Documents/Codex/2026-07-11/new-chat/work/qa-runtime/node_modules'
//   node scripts/pivot-exe-performance-smoke.cjs --baseline
//   node scripts/pivot-exe-performance-smoke.cjs --strict

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const target = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3018/stats/pivot?popup=1';
const targetUrl = new URL(target);
if (!['127.0.0.1', 'localhost'].includes(targetUrl.hostname) || !['http:', 'https:'].includes(targetUrl.protocol)) {
  throw new Error(`SMOKE_BASE_URL must be localhost, received ${target}`);
}

const testids = {
  rowHeight: 'pivot-exe-row-height',
  dataWidth: 'pivot-exe-data-width',
  grid: 'pivot-exe-grid',
  ...parseJsonEnv(process.env.PIVOT_EXE_PERF_TESTIDS),
};

function parseJsonEnv(value) {
  if (!value) return {};
  try { return JSON.parse(value); }
  catch (error) { throw new Error(`PIVOT_EXE_PERF_TESTIDS is not valid JSON: ${error.message}`); }
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
].filter(Boolean);
const executablePath = chromeCandidates.find(candidate => {
  try { return fs.existsSync(candidate); } catch { return false; }
});
if (!executablePath) throw new Error('Chrome executable not found. Set CHROME_PATH.');

const customerCount = 100;
const productCount = 300;
const rawRowCount = 2500;
const customers = Array.from({ length: customerCount }, (_, i) => `Fixture Customer ${String(i + 1).padStart(3, '0')}`);
const products = Array.from({ length: productCount }, (_, i) => `Fixture Product ${String(i + 1).padStart(3, '0')}`);
const columns = [
  'CustName', 'CounName', 'OrderWeek', 'Quantity', 'FlowerName', 'ProdName',
  'CountryFlower', 'CustArea', 'ListType', 'ShipmentDtm', 'OrderYear',
  'UPrice', 'OrderNo', 'CustDescr', 'TPrice',
];
const rows = Array.from({ length: rawRowCount }, (_, i) => {
  const customerIndex = i % customerCount;
  const productIndex = (i * 73 + Math.floor(i / customerCount) * 17) % productCount;
  const quantity = ((i % 17) + 1) / 2;
  const year = i < rawRowCount - 100 ? '2026' : '2025';
  const week = '37-01';
  return {
    CustName: customers[customerIndex], CounName: `Fixture Country ${String(customerIndex % 12 + 1).padStart(2, '0')}`,
    OrderWeek: week, Quantity: quantity, FlowerName: `Fixture Flower ${String(productIndex % 24 + 1).padStart(2, '0')}`,
    ProdName: products[productIndex], CountryFlower: `Fixture CF ${String(productIndex % 40 + 1).padStart(2, '0')}`,
    CustArea: `Area ${String(customerIndex % 20 + 1).padStart(2, '0')}`, ListType: '02. 주문',
    ShipmentDtm: '', OrderYear: year, UPrice: 100 + (productIndex % 31),
    OrderNo: '', CustDescr: '', TPrice: quantity * (100 + (productIndex % 31)),
  };
});
const fixtureSum = rows.reduce((sum, row) => sum + row.Quantity, 0);
const fixtureFingerprint = stableHash(JSON.stringify(rows));

const savedLayout = {
  schemaVersion: 1,
  zones: { rows: ['CustName'], cols: ['ProdName'], filters: [], values: [{ id: 'Quantity', aggregation: 'sum' }] },
  rowHeight: 24,
  widths: { __data: 96 },
  decimals: 2,
  previousNonzeroDecimals: 2,
  zeroVisible: false,
};
const userId = 'pivot-exe-performance-smoke';
const layoutKey = `pivotExeLayout:v2:${encodeURIComponent(userId)}`;
const requestLog = [];
const blockedRequests = [];
let rawApiRequestCount = 0;

function stableHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)] ?? null;
}
function selector(testid) { return `[data-testid="${String(testid).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`; }
async function waitFor(check, label, timeout = 45000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function sendJson(request, body, status = 200) {
  return request.respond({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installGuards(page) {
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const requestUrl = request.url();
    let parsed;
    try { parsed = new URL(requestUrl); }
    catch { blockedRequests.push({ reason: 'invalid-url', url: requestUrl }); return request.abort('blockedbyclient'); }
    if (['data:', 'blob:'].includes(parsed.protocol)) return request.continue();
    if (parsed.origin !== targetUrl.origin) {
      blockedRequests.push({ reason: 'non-local-origin', url: requestUrl });
      return request.abort('blockedbyclient');
    }
    if (!parsed.pathname.startsWith('/api/')) return request.continue();

    const method = request.method().toUpperCase();
    requestLog.push({ method, path: parsed.pathname, query: parsed.search });
    if (method !== 'GET') {
      blockedRequests.push({ reason: 'non-get-api', method, path: parsed.pathname });
      return request.abort('blockedbyclient');
    }
    if (parsed.pathname === '/api/auth/me') {
      return sendJson(request, { success: true, user: { userId, role: 'admin' } });
    }
    if (parsed.pathname === '/api/favorites') return sendJson(request, { success: true, favorites: [] });
    if (parsed.pathname === '/api/stats/pivot-exe') {
      if (parsed.searchParams.get('mode') === 'weeks') {
        return sendJson(request, { success: true, weeks: [
          { OrderYear: '2025', OrderWeek: '37-01', OrderYearWeek: '20253701' },
          { OrderYear: '2026', OrderWeek: '37-02', OrderYearWeek: '20263702' },
        ] });
      }
      rawApiRequestCount += 1;
      return sendJson(request, {
        success: true, mode: 'rawdata', columns, rows,
        range: { fromYear: '2025', fromWeek: '37-01', toYear: '2026', toWeek: '37-02' },
      });
    }
    blockedRequests.push({ reason: 'unmocked-api-get', method, path: parsed.pathname });
    return sendJson(request, { success: false, error: 'PERFORMANCE_SMOKE_UNMOCKED_API' }, 404);
  });
}

async function fingerprintGrid(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="pivot-exe-grid"]') || document.querySelector('table');
    if (!grid) return null;
    const tbody = grid.querySelector('tbody');
    const cells = [...(tbody?.querySelectorAll('td,th') || [])].map(cell => cell.textContent || '');
    const text = cells.join('\\u001f');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return { hash: (hash >>> 0).toString(16).padStart(8, '0'), textLength: text.length, rowCount: grid.querySelectorAll('tbody tr').length, tbodyCellCount: cells.length };
  });
}

async function discoverResizeTargets(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="pivot-exe-grid"]') || document.querySelector('table');
    if (!grid) return { candidates: [], headers: [] };
    const all = [...grid.querySelectorAll('*')];
    const candidates = all.filter(node => {
      const style = getComputedStyle(node);
      const title = node.getAttribute('title') || '';
      const cls = typeof node.className === 'string' ? node.className : '';
      return style.cursor === 'col-resize' || /resize|resizer|drag-handle/i.test(`${cls} ${title}`);
    }).map(node => {
      const rect = node.getBoundingClientRect();
      const header = node.closest('th');
      return {
        tag: node.tagName, testid: node.getAttribute('data-testid'), className: String(node.className || ''),
        title: node.getAttribute('title'), text: String(node.textContent || '').trim().slice(0, 60),
        headerText: String(header?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        headerRect: header ? (() => { const r = header.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })() : null,
      };
    }).filter(item => item.rect.width > 0 && item.rect.height > 0);
    const headers = [...grid.querySelectorAll('thead th')].slice(0, 20).map(node => {
      const r = node.getBoundingClientRect();
      return { text: String(node.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60), className: node.className, testid: node.getAttribute('data-testid'), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
    });
    return { candidates, headers };
  });
}

async function readResizeGeometry(page, targetIndex) {
  return page.evaluate(index => {
    const grid = document.querySelector('[data-testid="pivot-exe-grid"]') || document.querySelector('table');
    if (!grid) return null;
    const handles = [...grid.querySelectorAll('*')].filter(node => {
      const style = getComputedStyle(node);
      const title = node.getAttribute('title') || '';
      const cls = typeof node.className === 'string' ? node.className : '';
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (style.cursor === 'col-resize' || /resize|resizer|drag-handle/i.test(`${cls} ${title}`));
    });
    const handle = handles[index];
    const header = handle?.closest('th');
    if (!handle || !header) return null;
    const rect = handle.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
      handleRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      width: headerRect.width, headerIndex: [...grid.querySelectorAll('th')].indexOf(header),
      headerText: String(header.innerText || '').replace(/\\s+/g, ' ').trim(),
    };
  }, targetIndex);
}

async function runCancelProbe(page, targetIndex, cancellation) {
  const before = await readResizeGeometry(page, targetIndex);
  assert(before, `Cannot start ${cancellation} cancellation probe`);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.x + 45, before.y, { steps: 5 });
  const previewBeforeCancel = await page.$('[data-testid="pivot-exe-resize-preview"]');
  if (cancellation !== 'legacy') assert(previewBeforeCancel, `${cancellation} probe did not enter resize preview`);
  if (cancellation === 'escape') await page.keyboard.press('Escape');
  if (cancellation === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  if (cancellation === 'pagehide') await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await delay(40);
  const afterCancel = await readResizeGeometry(page, targetIndex);
  const previewAfterCancel = await page.$('[data-testid="pivot-exe-resize-preview"]');
  await page.mouse.move(before.x + 75, before.y, { steps: 3 });
  await delay(40);
  const afterUnreleasedMove = await readResizeGeometry(page, targetIndex);
  const stillNoPreview = !(await page.$('[data-testid="pivot-exe-resize-preview"]'));
  await page.mouse.up();
  await delay(40);
  const afterMouseUp = await readResizeGeometry(page, targetIndex);
  return {
    cancellation,
    beforeWidth: before.width,
    afterCancelWidth: afterCancel?.width,
    afterUnreleasedMoveWidth: afterUnreleasedMove?.width,
    afterMouseUpWidth: afterMouseUp?.width,
    previewRemovedOnCancel: !previewAfterCancel,
    previewRemainsAbsentAfterMove: stillNoPreview,
    cancelled: Math.abs((afterCancel?.width ?? NaN) - before.width) <= 1
      && Math.abs((afterUnreleasedMove?.width ?? NaN) - before.width) <= 1
      && Math.abs((afterMouseUp?.width ?? NaN) - before.width) <= 1
      && !previewAfterCancel && stillNoPreview,
  };
}

async function installMutationWatch(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="pivot-exe-grid"]') || document.querySelector('table');
    const tbody = grid?.querySelector('tbody');
    if (!tbody) return false;
    window.__pivotPerfMutations = { childList: 0, characterData: 0 };
    window.__pivotPerfObserver?.disconnect();
    window.__pivotPerfObserver = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') window.__pivotPerfMutations.childList += record.addedNodes.length + record.removedNodes.length;
        if (record.type === 'characterData') window.__pivotPerfMutations.characterData += 1;
      }
    });
    window.__pivotPerfObserver.observe(tbody, { subtree: true, childList: true, characterData: true, attributes: false });
    return true;
  });
}
async function readMutationCounts(page) {
  return page.evaluate(() => ({ ...(window.__pivotPerfMutations || {}) }));
}
async function resetMutationCounts(page) {
  return page.evaluate(() => { if (window.__pivotPerfMutations) window.__pivotPerfMutations = { childList: 0, characterData: 0 }; });
}

async function setControl(page, testid, value) {
  const targetSelector = selector(testid);
  const control = await page.$(targetSelector);
  assert(control, `Missing setting control ${testid}`);
  const started = Date.now();
  const tag = await control.evaluate(node => node.tagName);
  if (tag === 'SELECT') {
    await control.select(String(value));
  } else {
    await control.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type(String(value));
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
  }
  return Date.now() - started;
}

async function readDimensions(page) {
  return page.evaluate(() => {
    const grid = document.querySelector('[data-testid="pivot-exe-grid"]') || document.querySelector('table');
    const row = grid?.querySelector('td[data-pivot-row-index]')?.closest('tr') || grid?.querySelector('tbody tr');
    const cells = [...(row?.querySelectorAll('td[data-pivot-column-index]') || [])];
    if (!cells.length) cells.push(...(row?.querySelectorAll('td') || []));
    return {
      rowHeight: row ? row.getBoundingClientRect().height : null,
      dataWidths: cells.slice(0, 8).map(cell => cell.getBoundingClientRect().width),
      sampleCells: cells.slice(0, 8).map(cell => ({ className: String(cell.className || ''), text: (cell.textContent || '').trim().slice(0, 30), width: cell.getBoundingClientRect().width })),
    };
  });
}

async function checkWindowCells(page, expectedModel, pivotCellKey) {
  const observed = await page.evaluate(() => ({
    virtual: document.querySelector('[data-testid="pivot-exe-scroll"]')?.dataset.pivotVirtualized,
    cells: Array.from(document.querySelectorAll('td[data-pivot-row-index][data-pivot-column-index]')).map(e => ({row:Number(e.dataset.pivotRowIndex),column:Number(e.dataset.pivotColumnIndex),text:e.textContent})),
  }));
  assert(observed.virtual === 'true', 'large fixture must use windowed DOM');
  assert(observed.cells.length > 0 && observed.cells.length < 5000, `window contains ${observed.cells.length} cells`);
  for (const cell of observed.cells) {
    const row = expectedModel.rowAxis[cell.row], column = expectedModel.columnAxis[cell.column];
    assert(row && column, 'visible global cell index outside full model');
    const value = expectedModel.cellMap[pivotCellKey(row.key,column.key)]?.values?.[expectedModel.measures[0].key];
    const text = value == null || value === 0 ? '' : Number(value).toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2});
    assert(cell.text === text, `cell [${cell.row},${cell.column}] expected ${text}, got ${cell.text}`);
  }
  return {count:observed.cells.length,minRow:Math.min(...observed.cells.map(c=>c.row)),maxRow:Math.max(...observed.cells.map(c=>c.row)),minColumn:Math.min(...observed.cells.map(c=>c.column)),maxColumn:Math.max(...observed.cells.map(c=>c.column))};
}

async function run() {
  const { buildPivotModel, pivotCellKey } = await import('../lib/pivotExeModel.js');
  const expectedModel = buildPivotModel(rows,{layout:{row:savedLayout.zones.rows,column:savedLayout.zones.cols,data:['Quantity'],filter:[]}});
  assert(rows.length === rawRowCount, `fixture expected ${rawRowCount} raw rows, got ${rows.length}`);
  assert(new Set(rows.map(row => row.CustName)).size === customerCount, 'fixture does not cover all customer axes');
  assert(new Set(rows.map(row => row.ProdName)).size === productCount, 'fixture does not cover all product axes');
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
  const outputPath = path.resolve(process.env.PERF_OUTPUT || `outputs/pivot-exe-performance-${strict ? 'strict' : 'baseline'}.json`);
  const result = {
    mode: strict ? 'strict' : 'baseline', target: targetUrl.href,
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    fixture: { products: productCount, customers: customerCount, rawRows: rows.length, displayCells: productCount * customerCount, years: ['2025', '2026'], quantitySum: fixtureSum, fingerprint: fixtureFingerprint },
    timingsMs: {}, assertions: {}, rawApiRequestCount: 0, apiRequests: requestLog, blockedRequests,
  };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('pageerror', error => { result.pageError ||= []; result.pageError.push(error.stack || error.message); });
    await page.evaluateOnNewDocument(({ key, view, id }) => {
      localStorage.setItem('nenovaUser', JSON.stringify({ userId: id, userName: id, role: 'admin' }));
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(view));
      window.__pivotPerfNumericFormatCalls = { intl: 0, locale: 0 };
      window.__pivotPerfLayoutWrites = 0;
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (storageKey, value) {
        if (this === localStorage && storageKey === key) window.__pivotPerfLayoutWrites += 1;
        return Reflect.apply(originalSetItem, this, [storageKey, value]);
      };
      const formatDescriptor = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, 'format');
      if (formatDescriptor?.get && formatDescriptor.configurable) {
        Object.defineProperty(Intl.NumberFormat.prototype, 'format', {
          configurable: true,
          get() {
            const format = formatDescriptor.get.call(this);
            return (...args) => {
              window.__pivotPerfNumericFormatCalls.intl += 1;
              return format(...args);
            };
          },
        });
      }
      const originalLocaleString = Number.prototype.toLocaleString;
      Number.prototype.toLocaleString = function (...args) {
        window.__pivotPerfNumericFormatCalls.locale += 1;
        return Reflect.apply(originalLocaleString, this, args);
      };
    }, { key: layoutKey, view: savedLayout, id: userId });
    await installGuards(page);

    const navigationStart = Date.now();
    await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(selector(testids.rowHeight), { visible: true, timeout: 45000 });
    await waitFor(async () => (await fingerprintGrid(page))?.rowCount > 0, 'large pivot fixture render');
    result.timingsMs.initialRenderWall = Date.now() - navigationStart;
    result.initialGrid = await fingerprintGrid(page);
    if (strict) result.initialWindow = await checkWindowCells(page,expectedModel,pivotCellKey);
    const resizeDiscovery = await discoverResizeTargets(page);
    result.resizeTargets = {
      candidateCount: resizeDiscovery.candidates.length,
      headerCount: resizeDiscovery.headers.length,
      sample: resizeDiscovery.candidates.slice(0, 3),
    };
    result.assertions.fixtureAxes = { customers: new Set(rows.map(row => row.CustName)).size, products: new Set(rows.map(row => row.ProdName)).size };
    result.assertions.gridHasRows = result.initialGrid.rowCount > 0;
    result.assertions.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
    await installMutationWatch(page);

    const heightTimings = [];
    const widthTimings = [];
    const initialHeight = await page.$eval(selector(testids.rowHeight), node => Number(node.value));
    const initialWidth = await page.$eval(selector(testids.dataWidth), node => Number(node.value));
    const rawReadsBeforeDimensions = rawApiRequestCount;
    result.numericFormatCallsBeforeDimensions = await page.evaluate(() => ({ ...(window.__pivotPerfNumericFormatCalls || {}) }));
    result.dimensionsBeforeSettings = await readDimensions(page);
    for (let i = 0; i < 4; i += 1) {
      const height = [33, 32, 33, 33][i];
      const width = [120, 118, 120, 120][i];
      const hStart = Date.now();
      await setControl(page, testids.rowHeight, height);
      await waitFor(async () => {
        const dimensions = await readDimensions(page);
        return Math.abs((dimensions.rowHeight || 0) - height) <= 1;
      }, `rendered row height ${height}`);
      heightTimings.push(Date.now() - hStart);
      const wStart = Date.now();
      await setControl(page, testids.dataWidth, width);
      await waitFor(async () => {
        const dimensions = await readDimensions(page);
        return dimensions.dataWidths.length > 0 && Math.abs(dimensions.dataWidths[0] - width) <= 1;
      }, `rendered data column width ${width}`);
      widthTimings.push(Date.now() - wStart);
    }
    result.timingsMs.rowHeightChange = { samples: heightTimings, median: median(heightTimings) };
    result.timingsMs.defaultDataWidthChange = { samples: widthTimings, median: median(widthTimings) };
    result.assertions.gridAfterSettings = await fingerprintGrid(page);
    result.assertions.dimensionsAfterSettings = await readDimensions(page);
    result.assertions.mutationsAfterSettings = await readMutationCounts(page);
    if (strict) result.afterSettingsWindow = await checkWindowCells(page,expectedModel,pivotCellKey);
    result.numericFormatCallsAfterDimensions = await page.evaluate(() => ({ ...(window.__pivotPerfNumericFormatCalls || {}) }));
    result.numericFormatCallDelta = Object.fromEntries(Object.keys(result.numericFormatCallsBeforeDimensions || {}).map(key => [
      key, (result.numericFormatCallsAfterDimensions?.[key] || 0) - (result.numericFormatCallsBeforeDimensions?.[key] || 0),
    ]));
    const preResizeFingerprint = await fingerprintGrid(page);
    await delay(450);
    const writesBeforeResize = await page.evaluate(() => window.__pivotPerfLayoutWrites || 0);

    // Discover precise drag geometry from the rendered legacy/current UI. The
    // strict expectations intentionally do not require a preview-specific testid.
    const dragTargetIndex = resizeDiscovery.candidates.findIndex(item => /Fixture Product/i.test(item.headerText))
      >= 0 ? resizeDiscovery.candidates.findIndex(item => /Fixture Product/i.test(item.headerText))
      : resizeDiscovery.candidates.findIndex(item => /수량|Quantity/i.test(`${item.headerText} ${item.title} ${item.testid} ${item.className}`));
    const dragTarget = dragTargetIndex >= 0 ? resizeDiscovery.candidates[dragTargetIndex] : null;
    result.resizeTargetUsed = dragTarget ? { index: dragTargetIndex, title: dragTarget.title, className: dragTarget.className, headerText: dragTarget.headerText } : null;
    if (dragTarget) {
      const dragSamples = [];
      const previewPositionSamples = [];
      for (let sample = 0; sample < 3; sample += 1) {
        const from = await readResizeGeometry(page, dragTargetIndex);
        assert(from, `Could not reacquire visible resize handle index ${dragTargetIndex} for sample ${sample + 1}`);
        const writesBeforeThisDrag = await page.evaluate(() => window.__pivotPerfLayoutWrites || 0);
        const t0 = Date.now();
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        const previewPositions = [];
        for (let step = 1; step <= 20; step += 1) {
          await page.mouse.move(from.x + step * 3, from.y, { steps: 1 });
          if (strict && sample === 0 && [10, 15].includes(step)) {
            const observation = await page.evaluate(({ targetHeaderIndex, targetWidth }) => {
              const grid = document.querySelector('[data-testid="pivot-exe-grid"]') || document.querySelector('table');
              const header = grid?.querySelectorAll('th')[targetHeaderIndex];
              const headerRect = header?.getBoundingClientRect();
              const preview = document.querySelector('[data-testid="pivot-exe-resize-preview"]');
              const previewRect = preview?.getBoundingClientRect();
              return {
                headerText: header?.innerText || '',
                width: headerRect?.width ?? null,
                expectedCommittedWidth: targetWidth,
                preview: preview ? {
                  visible: previewRect.width > 0 && previewRect.height > 0 && getComputedStyle(preview).visibility !== 'hidden',
                  transform: getComputedStyle(preview).transform,
                  position: getComputedStyle(preview).position,
                  rect: { x: previewRect.x, y: previewRect.y, width: previewRect.width, height: previewRect.height },
                } : null,
              };
            }, { targetHeaderIndex: from.headerIndex, targetWidth: from.width });
            previewPositions.push(observation.preview?.rect.x ?? null);
            if (step === 10) {
              result.duringDrag = observation;
              result.duringDragGrid = await fingerprintGrid(page);
            }
          }
        }
        const preRelease = await readResizeGeometry(page, dragTargetIndex);
        await page.mouse.up();
        await delay(50);
        const committed = await readResizeGeometry(page, dragTargetIndex);
        assert(committed, `Resize handle index ${dragTargetIndex} disappeared after mouseup`);
        const delta = committed.width - from.width;
        assert(Math.abs(delta - 60) <= 3, `Drag must apply the final 60px once (before=${from.width}, during=${preRelease?.width}, after=${committed.width}, delta=${delta})`);
        const elapsedMs = Date.now() - t0;
        if (strict && sample === 0) previewPositionSamples.push(...previewPositions);
        await delay(400);
        const writesAfterThisDrag = await page.evaluate(() => window.__pivotPerfLayoutWrites || 0);
        dragSamples.push({ elapsedMs, beforeWidth: from.width, duringWidth: preRelease?.width, afterWidth: committed.width, delta, storageWrites: writesAfterThisDrag - writesBeforeThisDrag });
      }
      result.timingsMs.mouseResize20Steps = { samples: dragSamples, median: median(dragSamples.map(sample => sample.elapsedMs)), steps: 20 };
      result.previewPositionSamples = previewPositionSamples;
      result.previewPositionDelta = previewPositionSamples.length === 2 ? previewPositionSamples[1] - previewPositionSamples[0] : null;
    } else {
      result.timingsMs.mouseResize20Steps = null;
      result.resizeDiscoveryNote = 'No visible resize handle discovered using cursor/title/class heuristics.';
    }

    result.assertions.gridAfterResize = await fingerprintGrid(page);
    if (strict) result.afterResizeWindow = await checkWindowCells(page,expectedModel,pivotCellKey);
    result.assertions.mutationsAfterResize = await readMutationCounts(page);
    result.numericFormatCallsAfterResize = await page.evaluate(() => ({ ...(window.__pivotPerfNumericFormatCalls || {}) }));
    if (strict && dragTargetIndex >= 0) {
      result.cancellationProbes = [];
      for (const cancellation of ['escape', 'blur', 'pagehide']) {
        result.cancellationProbes.push(await runCancelProbe(page, dragTargetIndex, cancellation));
      }
    }
    result.rawApiRequestsDuringDimensions = rawApiRequestCount - rawReadsBeforeDimensions;
    result.numericFormatCallsAfterResize = await page.evaluate(() => ({ ...(window.__pivotPerfNumericFormatCalls || {}) }));
    result.numericFormatCallDeltaDuringDimensions = Object.fromEntries(Object.keys(result.numericFormatCallsBeforeDimensions || {}).map(key => [
      key, (result.numericFormatCallsAfterResize?.[key] || 0) - (result.numericFormatCallsBeforeDimensions?.[key] || 0),
    ]));
    result.assertions.layoutWritesDuringResize = await page.evaluate(({ writesBefore }) => (window.__pivotPerfLayoutWrites || 0) - writesBefore, { writesBefore: writesBeforeResize });

    result.rawApiRequestCount = rawApiRequestCount;
    result.apiRequests = requestLog;
    result.blockedRequests = blockedRequests;
    result.preReloadGrid = await fingerprintGrid(page);
    result.preReloadDimensions = await readDimensions(page);
    result.preReloadSettings = await page.evaluate(key => ({
      rowHeight: document.querySelector('[data-testid="pivot-exe-row-height"]')?.value,
      dataWidth: document.querySelector('[data-testid="pivot-exe-data-width"]')?.value,
      persisted: (() => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })(),
      layoutWrites: window.__pivotPerfLayoutWrites,
    }), layoutKey);
    if (strict && dragTargetIndex >= 0) {
      const pending = await readResizeGeometry(page, dragTargetIndex);
      assert(pending, 'Could not begin active resize for unmount cleanup probe');
      await page.mouse.move(pending.x, pending.y);
      await page.mouse.down();
      await page.mouse.move(pending.x + 45, pending.y, { steps: 5 });
      result.unmountCleanupProbe = await page.evaluate(() => {
        const preview = document.querySelector('[data-testid="pivot-exe-resize-preview"]');
        const rect = preview?.getBoundingClientRect();
        return { dragActive: Boolean(preview && rect.width > 0 && rect.height > 0), previewPosition: preview ? getComputedStyle(preview).position : null };
      });
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    await page.waitForSelector(selector(testids.rowHeight), { visible: true, timeout: 45000 });
    await waitFor(async () => (await fingerprintGrid(page))?.rowCount > 0, 'fixture restore after reload');
    result.finalGrid = await fingerprintGrid(page);
    result.finalSettings = await page.evaluate(key => ({
      rowHeight: document.querySelector('[data-testid="pivot-exe-row-height"]')?.value,
      dataWidth: document.querySelector('[data-testid="pivot-exe-data-width"]')?.value,
      persisted: (() => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })(),
    }), layoutKey);
    result.finalDimensions = await readDimensions(page);
    if (strict && dragTargetIndex >= 0) {
      result.unmountCleanupProbe.previewGoneAfterReload = !(await page.$('[data-testid="pivot-exe-resize-preview"]'));
      result.unmountCleanupProbe.persistedWidthBeforeReload = result.preReloadSettings.persisted?.widths?.__data ?? null;
      result.unmountCleanupProbe.persistedWidthAfterReload = result.finalSettings.persisted?.widths?.__data ?? null;
      result.unmountCleanupProbe.cancelledWithoutMouseup = result.unmountCleanupProbe.dragActive
        && result.unmountCleanupProbe.previewGoneAfterReload
        && result.unmountCleanupProbe.persistedWidthBeforeReload === result.unmountCleanupProbe.persistedWidthAfterReload;
    }
    result.assertions.settingsRestoredAfterReload = Number(result.finalSettings.rowHeight) === Number(result.preReloadSettings.rowHeight)
      && Number(result.finalSettings.dataWidth) === Number(result.preReloadSettings.dataWidth)
      && Math.abs((result.finalDimensions.rowHeight || 0) - Number(result.finalSettings.rowHeight)) <= 1
      && Math.abs((result.finalDimensions.dataWidths?.[0] || 0) - (result.preReloadDimensions.dataWidths?.[0] || 0)) <= 1;
    result.rawApiRequestCount = rawApiRequestCount;

    if (strict) {
      result.restoredWindow = await checkWindowCells(page,expectedModel,pivotCellKey);
      await page.$eval('[data-testid="pivot-exe-scroll"]',e=>{e.scrollTop=e.scrollHeight;e.scrollLeft=e.scrollWidth;});
      await waitFor(async()=>{
        const cells=await checkWindowCells(page,expectedModel,pivotCellKey);
        return cells.maxRow===expectedModel.rowAxis.length-1 && cells.maxColumn===expectedModel.columnAxis.length-1;
      },'last logical row and column reached');
      result.lastWindow = await checkWindowCells(page,expectedModel,pivotCellKey);
      await page.mouse.up();
      await page.screenshot({path:path.join(path.dirname(outputPath),'pivot-exe-performance-last.png')});
      await page.$eval('[data-testid="pivot-exe-scroll"]',e=>{e.scrollTop=0;e.scrollLeft=0;});
      await waitFor(async()=>{const cells=await checkWindowCells(page,expectedModel,pivotCellKey);return cells.minRow===0&&cells.minColumn===0;},'return to first cell');
      result.returnedWindow = await checkWindowCells(page,expectedModel,pivotCellKey);
      await page.screenshot({path:path.join(path.dirname(outputPath),'pivot-exe-performance-first.png')});
      assert(result.timingsMs.mouseResize20Steps?.samples.length === 3, 'strict mode requires a discoverable resizable header/handle');
      assert(result.duringDragGrid?.hash === preResizeFingerprint.hash, 'committed window changed during drag');
      assert(result.numericFormatCallDelta?.intl === 0 && result.numericFormatCallDelta?.locale <= 16,
        `dimension changes invoked numeric formatting: ${JSON.stringify(result.numericFormatCallDelta)}`);
      assert(result.numericFormatCallDeltaDuringDimensions?.intl === 0 && result.numericFormatCallDeltaDuringDimensions?.locale <= 24,
        `dimension operations invoked numeric formatting: ${JSON.stringify(result.numericFormatCallDeltaDuringDimensions)}`);
      assert(result.rawApiRequestsDuringDimensions === 0, `dimension changes caused additional raw API GETs (${result.rawApiRequestsDuringDimensions})`);
      assert(result.duringDrag?.preview?.visible && result.duringDrag.preview.position === 'fixed', 'fixed resize preview guide is not visible during drag');
      assert(result.previewPositionDelta != null && Math.abs(result.previewPositionDelta) >= 10, 'resize guide transformX did not track mouse movement');
      assert(Math.abs(result.duringDrag.width - result.duringDrag.expectedCommittedWidth) <= 1, 'committed width changed before mouseup');
      assert(result.timingsMs.mouseResize20Steps.samples.every(sample => sample.storageWrites === 1), 'each mouseup must persist final width exactly once');
      assert(result.cancellationProbes?.length === 3 && result.cancellationProbes.every(probe => probe.cancelled),
        `Escape/blur/pagehide did not cancel and clean up resize: ${JSON.stringify(result.cancellationProbes)}`);
      assert(result.unmountCleanupProbe?.cancelledWithoutMouseup, `Unmount did not discard active preview without persisting it: ${JSON.stringify(result.unmountCleanupProbe)}`);
      assert(blockedRequests.length === 0, `blocked request(s) detected: ${JSON.stringify(blockedRequests)}`);
      assert(Number(result.finalSettings.rowHeight) === 33, `row height did not restore to 33 (got ${result.finalSettings.rowHeight})`);
      assert(Number(result.finalSettings.dataWidth) === 120, `data width did not restore to 120 (got ${result.finalSettings.dataWidth})`);
      assert(result.preReloadSettings.persisted?.rowHeight === 33, 'saved row height is not 33');
      assert(result.preReloadSettings.persisted?.widths?.__data === 120, 'saved data width widths.__data is not 120');
      assert(result.finalSettings.persisted?.rowHeight === 33, 'saved row height did not survive reload');
      assert(result.finalSettings.persisted?.widths?.__data === 120, 'saved data width did not survive reload');
      assert(result.assertions.settingsRestoredAfterReload, 'actual row/column CSS did not restore after reload');
      const { buildPivotExeWorkbook } = await import('../lib/pivotExeExport.js');
      const { buildPivotExePresentation } = await import('../lib/pivotExePresentation.js');
      const ExcelJS = (await import('exceljs')).default;
      const bytes = await buildPivotExeWorkbook(expectedModel,{rowHeight:33,columnWidths:result.finalSettings.persisted.widths,decimalPlaces:2});
      const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
      const sheet = book.worksheets[0], presentation = buildPivotExePresentation(expectedModel);
      const finalRow = presentation.headerRows.length + expectedModel.rowAxis.length;
      const finalColumn = presentation.rowFields.length + expectedModel.columnAxis.length;
      assert(sheet.rowCount === finalRow && sheet.columnCount === finalColumn, 'workbook was truncated to DOM window');
      assert(sheet.getCell(finalRow,finalColumn).value === fixtureSum, 'full workbook grand total differs from source quantity');
      result.workbook = {rows:sheet.rowCount,columns:sheet.columnCount,grandTotal:sheet.getCell(finalRow,finalColumn).value};
      result.assertions.strictPassed = true;
    } else {
      result.assertions.baselineMeasurementOnly = true;
    }

    assert(blockedRequests.length === 0, `blocked request(s) detected: ${JSON.stringify(blockedRequests)}`);
    if (result.pageError?.length) throw new Error(`Page error(s): ${result.pageError.join(' | ')}`);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...result, outputPath }, null, 2));
  } catch (error) {
    result.failure = error.stack || error.message;
    result.rawApiRequestCount = rawApiRequestCount;
    result.apiRequests = requestLog;
    result.blockedRequests = blockedRequests;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.error(JSON.stringify({ failure: result.failure, outputPath, rawApiRequestCount, requestLog, blockedRequests }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.stack || error.message); process.exit(1); });

// Local-only Puppeteer smoke for the EXE-compatible pivot UI.
// Only localhost assets and local XLSX downloads. No ERP/DB, external network,
// installs, or mutation requests are allowed.
// Exact data-testid values may be supplied as JSON in PIVOT_EXE_SMOKE_TESTIDS.
// Missing values use only observable current-route labels; no future selector
// names are invented or made mandatory.
// Usage:
//   $env:NODE_PATH='C:/Users/USER/Documents/Codex/2026-07-11/new-chat/work/qa-runtime/node_modules'
//   $env:PIVOT_EXE_SMOKE_TESTIDS=(Get-Content testids.json -Raw)
//   node scripts/pivot-exe-ui-smoke.cjs http://127.0.0.1:3018/stats/pivot?popup=1

const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const target = process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3018/stats/pivot?popup=1';
const targetUrl = new URL(target);
if (!['127.0.0.1', 'localhost'].includes(targetUrl.hostname) || !['http:', 'https:'].includes(targetUrl.protocol)) {
  throw new Error(`SMOKE_BASE_URL must be localhost, received ${target}`);
}

function parseJsonEnv(name) {
  if (!process.env[name]) return {};
  try { return JSON.parse(process.env[name]); } catch (error) { throw new Error(`${name} is not valid JSON: ${error.message}`); }
}

const testids = {
  root: null,
  refresh: 'pivot-exe-refresh',
  export: 'pivot-exe-export',
  fieldList: 'pivot-exe-field-list',
  filterEditor: 'pivot-exe-filter-editor',
  collapseAll: 'pivot-exe-collapse-all',
  expandAll: 'pivot-exe-expand-all',
  moveRow: 'pivot-exe-move-row',
  moveColumn: 'pivot-exe-move-column',
  moveValue: 'pivot-exe-move-value',
  moveFilter: 'pivot-exe-move-filter',
  ...parseJsonEnv('PIVOT_EXE_SMOKE_TESTIDS'),
};

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
].filter(Boolean);
const executablePath = chromeCandidates.find(candidate => { try { return fs.existsSync(candidate); } catch { return false; } });
if (!executablePath) throw new Error('Chrome executable not found. Set CHROME_PATH.');

const columns = [
  'CustName', 'CounName', 'OrderWeek', 'Quantity', 'FlowerName', 'ProdName',
  'CountryFlower', 'CustArea', 'ListType', 'ShipmentDtm', 'OrderYear',
  'UPrice', 'OrderNo', 'CustDescr', 'TPrice',
];
const rows = [
  { CustName: '거래처A', CounName: '콜롬비아', OrderWeek: '37-01', Quantity: 12.5, FlowerName: '수국', ProdName: '수국 화이트', CountryFlower: '콜롬비아 수국', CustArea: '서울', ListType: '02. 주문', ShipmentDtm: '', OrderYear: '2026', UPrice: 1000, OrderNo: '', CustDescr: '주문비고', TPrice: 12500 },
  { CustName: '거래처B', CounName: '콜롬비아', OrderWeek: '37-02', Quantity: 8, FlowerName: '카네이션', ProdName: '카네이션 핑크', CountryFlower: '콜롬비아 카네이션', CustArea: '부산', ListType: '03. 입고', ShipmentDtm: '', OrderYear: '2026', UPrice: 900, OrderNo: 'AWB-3702', CustDescr: '', TPrice: 7200 },
  { CustName: '거래처A', CounName: '에콰도르', OrderWeek: '37-01', Quantity: 4, FlowerName: '장미', ProdName: '장미 레드', CountryFlower: '에콰도르 장미', CustArea: '서울', ListType: '04. 출고', ShipmentDtm: '2026-09-10(목)', OrderYear: '2026', UPrice: 0, OrderNo: '', CustDescr: '', TPrice: 0 },
  { CustName: '', CounName: '콜롬비아', OrderWeek: '37-01', Quantity: 3, FlowerName: '수국', ProdName: '수국 블루', CountryFlower: '콜롬비아 수국', CustArea: '', ListType: '01. 전재고', ShipmentDtm: '', OrderYear: '2026', UPrice: 0, OrderNo: '', CustDescr: '', TPrice: 0 },
];

const problems = [];
const requests = [];
const forbiddenMutations = [];
const externalRequests = [];
let rawDataReads = 0;
let failNextRawData = false;
let saw503 = false;
let exportEvents = 0;
let currentMockUserId = 'pivot-exe-ui-smoke';
let nextFavoriteKey = 1001;
const mockFavoritesByUser = new Map();
const favoriteMutations = [];

function bodyOf(request) {
  try { return request.postData() ? JSON.parse(request.postData()) : {}; } catch { return {}; }
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(50); }
  throw new Error(`Timed out waiting for ${label}`);
}
function selector(value) {
  if (typeof value !== 'string' || !value) throw new Error('Empty selector in UI worker manifest.');
  return `[data-testid="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}
async function clickObservable(page, observableText) {
  const candidates = Array.isArray(observableText) ? observableText : [observableText];
  const box = await page.evaluate((value) => {
    const nodes = [...document.querySelectorAll('button,[role="button"],label')];
    const node = nodes.find(candidate => value.includes(String(candidate.textContent || '').replace(/\s+/g, ' ').trim()));
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  }, candidates);
  if (!box) throw new Error(`observable left-click control not found: ${candidates.join(' / ')}`);
  await page.mouse.click(box.x, box.y);
}
async function click(page, value, label, observableText = null) {
  if (value) {
    const sel = selector(value);
    const found = await page.waitForSelector(sel, { visible: true, timeout: 1000 }).catch(() => null);
    if (found) await page.click(sel);
    else if (observableText) {
      await clickObservable(page, observableText);
    } else throw new Error(`testid control not found: ${value}`);
  } else if (observableText) {
    await clickObservable(page, observableText);
  } else throw new Error(`No supplied testid or observable label for ${label || 'control'}`);
  await delay(100);
  return label || value;
}
async function text(page) { return page.$eval('body', node => String(node.innerText || '').replace(/\s+/g, ' ').trim()); }
async function visibleCount(page, value) { return value ? page.$$eval(selector(value), nodes => nodes.filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden'; }).length) : 0; }
async function fill(page, value, input, label) {
  const sel = selector(value);
  await page.waitForSelector(sel, { visible: true, timeout: 30000 });
  await page.click(sel);
  await page.evaluate((s, v) => { const node = document.querySelector(s); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; if (!node || !setter) throw new Error(`Cannot fill ${s}`); setter.call(node, v); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }, sel, input);
  return label || value;
}
function assert(condition, message) { if (!condition) throw new Error(message); }

function assertFieldManifest() {
  const zones = ['row', 'column', 'filter', 'data'];
  if (!testids.fieldZones || !testids.fieldMoves) return false;
  for (const zone of zones) if (!testids.fieldZones[zone]) return false;
  for (const field of columns) {
    const moves = testids.fieldMoves[field];
    if (!moves || zones.some(zone => !moves[zone])) return false;
  }
  return Array.isArray(testids.filterValues) && testids.filterValues.length > 0 && Array.isArray(testids.recursiveFilterFields) && testids.recursiveFilterFields.length > 0;
}

async function runDelayedAuthLayoutRegression(browser) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const userId = 'pivot-exe-ui-delayed-auth';
  const layoutKey = `pivotExeLayout:v2:${encodeURIComponent(userId)}`;
  const savedView = {
    schemaVersion: 1,
    zones: {
      rows: ['CounName'],
      cols: ['OrderYear'],
      filters: [],
      values: [{ id: 'Quantity', aggregation: 'sum' }],
    },
    rowHeight: 33,
    decimals: 2,
    previousNonzeroDecimals: 2,
    zeroVisible: false,
  };
  await page.evaluateOnNewDocument((key, view, authenticatedUserId) => {
    localStorage.setItem('nenovaUser', JSON.stringify({ userId: authenticatedUserId, userName: authenticatedUserId, role: 'admin' }));
    localStorage.setItem(key, JSON.stringify(view));
  }, layoutKey, savedView, userId);

  let nextAuthGate = null;
  let authIsPending = false;
  let rawReadsDuringReloadDelay = 0;
  const unexpectedRequests = [];
  const json = (request, payload, status = 200) => request.respond({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });

  await page.setRequestInterception(true);
  page.on('request', async request => {
    let url;
    try { url = new URL(request.url()); } catch { unexpectedRequests.push(request.url()); return request.abort('blockedbyclient'); }
    if (url.protocol === 'data:' || url.protocol === 'blob:') return request.continue();
    if (url.origin !== targetUrl.origin) { unexpectedRequests.push(request.url()); return request.abort('blockedbyclient'); }
    if (!url.pathname.startsWith('/api/')) return request.continue();
    const method = request.method().toUpperCase();
    if (url.pathname === '/api/auth/me' && method === 'GET') {
      const gate = nextAuthGate;
      nextAuthGate = null;
      if (gate) {
        authIsPending = true;
        gate.signal();
        await gate.promise;
        authIsPending = false;
      }
      return json(request, { success: true, user: { userId, role: 'admin' } });
    }
    if (url.pathname === '/api/favorites' && method === 'GET') return json(request, { success: true, favorites: [] });
    if (url.pathname === '/api/stats/pivot-exe' && method === 'GET') {
      if (url.searchParams.get('mode') === 'weeks') return json(request, { success: true, weeks: [
        { OrderYear: '2026', OrderWeek: '37-01', OrderYearWeek: '20263701' },
        { OrderYear: '2026', OrderWeek: '37-02', OrderYearWeek: '20263702' },
      ] });
      if (authIsPending) rawReadsDuringReloadDelay += 1;
      return json(request, { success: true, mode: 'rawdata', columns, rows, range: {
        fromYear: '2026', fromWeek: '37-01', toYear: '2026', toWeek: '37-02',
      } });
    }
    unexpectedRequests.push(`${method} ${url.pathname}`);
    return json(request, { success: false, error: 'DELAYED_AUTH_FIXTURE_UNEXPECTED_REQUEST' }, 405);
  });

  try {
    await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-testid="pivot-exe-field-CounName"]', { visible: true, timeout: 30000 });
    await waitFor(() => page.$eval('[data-testid="pivot-exe-row-height"]', node => node.value === '33'), 'user A rowHeight=33 before delayed reload');
    await waitFor(() => page.evaluate(key => {
      try { return JSON.parse(localStorage.getItem(key))?.rowHeight === 33; } catch { return false; }
    }, layoutKey), 'user A layout stored before delayed reload');

    let releaseAuth;
    let signalAuthPending;
    const authPending = new Promise(resolve => { signalAuthPending = resolve; });
    const authGate = new Promise(resolve => { releaseAuth = resolve; });
    nextAuthGate = { signal: signalAuthPending, promise: authGate };
    const readsBeforeReload = rawReadsDuringReloadDelay;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitFor(() => authPending.then(() => true), 'delayed auth request on reload');
    await page.waitForSelector('[data-testid="pivot-exe-hydrating"]', { visible: true, timeout: 10000 });
    assert(!(await page.$('[data-testid="pivot-exe-reset"]')), 'reset control must not render while user layout authentication is pending');
    const earlyControls = await page.$$eval('[data-testid^="pivot-exe-field-"]', nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
    }).length);
    assert(earlyControls === 0, `pivot field controls rendered before auth/layout hydration (${earlyControls})`);
    await waitFor(() => rawReadsDuringReloadDelay > readsBeforeReload, 'automatic raw-data query remains parallel to delayed auth');
    await delay(500);
    releaseAuth();
    await page.waitForSelector('[data-testid="pivot-exe-field-CounName"]', { visible: true, timeout: 30000 });
    await waitFor(() => page.$eval('[data-testid="pivot-exe-row-height"]', node => node.value === '33'), 'user A rowHeight=33 after delayed auth');
    await waitFor(() => page.evaluate(key => {
      try { return JSON.parse(localStorage.getItem(key))?.rowHeight === 33; } catch { return false; }
    }, layoutKey), 'user A stored rowHeight remains 33 after delayed auth');
    assert(unexpectedRequests.length === 0, `delayed-auth fixture made unexpected requests: ${unexpectedRequests.join(', ')}`);
    return { delayedAuthMs: 500, hydratingStatusVisible: true, resetAbsentBeforeAuth: true, blockedFieldControlsBeforeAuth: earlyControls === 0, rawReadsDuringReloadDelay, restoredRowHeight: 33, storedRowHeight: 33, unexpectedRequests };
  } finally {
    nextAuthGate?.signal();
    await context.close();
  }
}

(async () => {
  const hasCompleteFieldManifest = assertFieldManifest();
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
  const screenshotPath = path.resolve(process.env.SMOKE_SCREENSHOT || 'outputs/pivot-exe-ui-1920.png');
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('pageerror', error => problems.push(`pageerror: ${error.stack || error.message}`));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text()}`); });
    await page.evaluateOnNewDocument(() => localStorage.setItem('nenovaUser', JSON.stringify({ userId: 'pivot-exe-ui-smoke', userName: 'pivot-exe-ui-smoke', role: 'admin' })));
    await page.setRequestInterception(true);
    let favoriteDeleteConfirmation = '';
    page.on('dialog', async dialog => { favoriteDeleteConfirmation = dialog.message(); await dialog.accept(); });
    page.on('request', async request => {
      const requestUrl = request.url();
      if (requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) { if (requestUrl.startsWith('blob:')) exportEvents += 1; return request.continue(); }
      let parsed;
      try { parsed = new URL(requestUrl); } catch { externalRequests.push(requestUrl); return request.abort('blockedbyclient'); }
      if (parsed.origin !== targetUrl.origin) { externalRequests.push(requestUrl); return request.abort('blockedbyclient'); }
      if (!parsed.pathname.startsWith('/api/')) return request.continue();
      const method = request.method().toUpperCase();
      const body = bodyOf(request);
      requests.push({ method, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), body });
      if (parsed.pathname === '/api/favorites') {
        const pageName = parsed.searchParams.get('page') || body.page;
        if (pageName && pageName !== 'stats-pivot-exe') return request.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'SMOKE_UNEXPECTED_FAVORITE_PAGE' }) });
        const userFavorites = mockFavoritesByUser.get(currentMockUserId) || [];
        if (method === 'GET') return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, favorites: userFavorites }) });
        favoriteMutations.push({ method, body, userId: currentMockUserId });
        if (method === 'POST') {
          if (body.page !== 'stats-pivot-exe' || typeof body.name !== 'string' || typeof body.filterData !== 'string') return request.respond({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'SMOKE_INVALID_FAVORITE_POST' }) });
          const favoriteKey = nextFavoriteKey++;
          userFavorites.push({ FavoriteKey: favoriteKey, FavName: body.name, FilterData: body.filterData });
          mockFavoritesByUser.set(currentMockUserId, userFavorites);
          return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, favoriteKey }) });
        }
        if (method === 'PUT') {
          const favorite = userFavorites.find(item => String(item.FavoriteKey) === String(body.favoriteKey));
          if (!favorite || typeof body.name !== 'string' || typeof body.filterData !== 'string') return request.respond({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'SMOKE_FAVORITE_NOT_FOUND' }) });
          favorite.FavName = body.name; favorite.FilterData = body.filterData;
          return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
        }
        if (method === 'DELETE') {
          const index = userFavorites.findIndex(item => String(item.FavoriteKey) === String(body.favoriteKey));
          if (index < 0) return request.respond({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'SMOKE_FAVORITE_NOT_FOUND' }) });
          userFavorites.splice(index, 1);
          mockFavoritesByUser.set(currentMockUserId, userFavorites);
          return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
        }
        return request.respond({ status: 405, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'SMOKE_FAVORITE_METHOD_NOT_ALLOWED' }) });
      }
      if (method !== 'GET') { forbiddenMutations.push({ method, path: parsed.pathname, body }); return request.respond({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'SMOKE_MUTATIONS_FORBIDDEN' }) }); }
      if (parsed.pathname === '/api/auth/me') return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, user: { userId: currentMockUserId, role: 'admin' } }) });
      if (parsed.pathname === '/api/stats/pivot-weeks') return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, weeks: [{OrderYear:'2026',OrderWeek:'37-01',OrderYearWeek:'20263701'},{OrderYear:'2026',OrderWeek:'37-02',OrderYearWeek:'20263702'}], orderYear: '2026' }) });
      if (parsed.pathname === '/api/stats/pivot-data') {
        rawDataReads += 1;
        if (failNextRawData) { failNextRawData = false; saw503 = true; return request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'SMOKE_SCOPE_503' }) }); }
        return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, orderYear: '2026', weekStart: '37-01', weekEnd: '37-02', weeks: ['37-01', '37-02'], rows: rows.map(row => ({ country: row.CounName, flower: row.FlowerName, prodName: row.ProdName, prodKey: 1, area: row.CustArea, descr: row.CustDescr, outDate: row.ShipmentDtm, inPrice: row.UPrice, inTotal: row.TPrice, awb: row.OrderNo, totalOrder: row.Quantity, totalIncoming: row.Quantity, prevStock: 1, curStock: 1, orders: row.CustName ? { [row.CustName]: row.Quantity } : {}, incoming: {}, outOrders: {}, costOrders: {}, distCostOrders: {} })) }) });
      }
      if (parsed.pathname !== '/api/stats/pivot-exe') return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, rows: [], data: [] }) });
      const mode = parsed.searchParams.get('mode');
      if (mode === 'weeks') return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, weeks: [{OrderYear:'2026',OrderWeek:'37-01',OrderYearWeek:'20263701'},{OrderYear:'2026',OrderWeek:'37-02',OrderYearWeek:'20263702'}] }) });
      rawDataReads += 1;
      if (failNextRawData) { failNextRawData = false; saw503 = true; return request.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'SMOKE_SCOPE_503' }) }); }
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, mode: 'rawdata', columns, rows, scope: { orderYear: '2026', weekStart: '37-01', weekEnd: '37-02' } }) });
    });

    await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector(testids.root ? selector(testids.root) : 'body', { visible: true, timeout: 30000 });
    await waitFor(() => rawDataReads > 0, 'initial pivot data read');
    await page.waitForSelector('[data-testid="pivot-exe-grid"]', { visible: true, timeout: 30000 });
    await waitFor(() => page.$eval('[data-testid="pivot-exe-favorite-select"]', node => !node.disabled), 'authenticated per-user layout hydration');
    if (testids.dataRows) assert((await visibleCount(page, testids.dataRows)) > 0, 'mock rawdata rows are not displayed');

    // Exercise actual HTML5 drops and assert the rendered pivot changes without a new raw-data read.
    const initialLiveTable = await page.$eval('table', node => node.innerText);
    assert(initialLiveTable.includes('27.50'), 'four-row fixture sum must be 27.50 before layout changes');
    const dropField = async (field, zone, zoneId) => {
      const beforeReads = rawDataReads;
      await page.evaluate(({ fieldId, destination }) => {
        const source = document.querySelector(`[data-testid="pivot-exe-field-${fieldId}"]`)?.closest('[draggable="true"]');
        const target = document.querySelector(`[data-testid="${destination}"]`);
        if (!source || !target) throw new Error(`Missing live drag source/target: ${fieldId} -> ${destination}`);
        const transfer = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
      }, { fieldId: field, destination: zoneId });
      await waitFor(() => page.$eval(`[data-testid="${zoneId}"]`, (node, fieldId) => Boolean(node.querySelector(`[data-testid="pivot-exe-field-${fieldId}"]`)), field), `${field} drop into ${zone}`);
      assert(rawDataReads === beforeReads, `dragging ${field} into ${zone} unexpectedly fetched raw data`);
    };
    await dropField('CustName', 'rows', 'pivot-exe-zone-rows');
    await dropField('CounName', 'columns', 'pivot-exe-zone-cols');
    await dropField('ListType', 'filters', 'pivot-exe-zone-filters');
    await dropField('UPrice', 'values', 'pivot-exe-zone-values');
    const liveTable = await page.$eval('table', node => node.innerText);
    assert(liveTable !== initialLiveTable, 'field drops must change actual table headers or grouped values');
    assert(liveTable.includes('거래처A') && liveTable.includes('콜롬비아'), 'row/column drops must change visible group labels');
    assert(liveTable.includes('입고단가') && liveTable.includes('1,900.00'), 'numeric field drop must add the correct fixture sum');
    assert(rawDataReads === 1, `layout-only drops must not reread raw rows (reads: ${rawDataReads})`);
    await click(page, 'pivot-exe-reset', 'restore native layout after live drops');

    // Optional external manifests may still exercise explicit controls. The native web contract
    // itself is covered above by dragging whole field buttons between every zone.
    if (hasCompleteFieldManifest) for (const [field, moves] of Object.entries(testids.fieldMoves)) {
      for (const zone of ['row', 'column', 'filter', 'data']) {
        await click(page, moves[zone], `field ${field} -> ${zone}`);
        assert((await visibleCount(page, testids.fieldZones[zone])) > 0, `field zone ${zone} disappeared after ${field}`);
      }
    }
    await click(page, 'pivot-exe-reset', 'restore native layout');
    assert((await text(page)).includes('수국 화이트'), 'raw fixture is not visible after restoring layout');
    if (testids.search) { await fill(page, testids.search, '수국', 'search'); assert((await text(page)).includes('수국'), 'search result does not retain 수국'); }
    if (testids.filterOpen && testids.filterApply && Array.isArray(testids.filterValues)) {
      await click(page, testids.filterOpen, 'multiselect filter open');
      for (const value of testids.filterValues) await click(page, value, 'multiselect value');
      await click(page, testids.filterApply, 'multiselect filter apply');
      if (testids.dataRows) assert((await visibleCount(page, testids.dataRows)) > 0, 'multiselect filter removed all mock rows unexpectedly');
    }

    if (testids.recursiveFilterOpen && testids.recursiveFilterAdd && testids.recursiveFilterApply && Array.isArray(testids.recursiveFilterFields)) {
      await click(page, testids.recursiveFilterOpen, 'recursive AST filter open');
      await click(page, testids.recursiveFilterAdd, 'recursive AST add');
      for (const field of testids.recursiveFilterFields) await click(page, field, 'recursive AST field');
      await click(page, testids.recursiveFilterApply, 'recursive AST apply');
    }

    // Exercise the actual visible filter controls, not just optional test manifests.
    await click(page, 'pivot-exe-field-CounName', 'country menu');
    await click(page, null, 'value filter', '값 필터…');
    await click(page, null, 'clear values', '전체 해제');
    await click(page, null, 'apply empty selection', '선택·순서 적용');
    assert((await text(page)).includes('표시할 데이터가 없습니다.'), 'empty filter must show no rows');
    await click(page, null, 'clear filters', '필터 지우기');
    await click(page, testids.filterEditor, 'AST editor');
    await click(page, null, 'add condition', '+ 조건');
    await page.select('[role="dialog"] select:nth-of-type(1)', 'AND');
    const condition = await page.$('[role="dialog"] input[placeholder="값"]');
    await condition.type('거래처A');
    await click(page, null, 'apply AST', '적용');
    assert(!(await page.$eval('table', node => node.innerText)).includes('거래처B'), 'AST customer filter failed');
    await click(page, null, 'clear AST', '필터 지우기');
    const expandedRows = await page.$$eval('tbody tr', nodes => nodes.length);
    await click(page, testids.collapseAll, 'collapse all', '모두 접기');
    assert((await page.$$eval('tbody tr', nodes => nodes.length)) < expandedRows, 'collapse did not reduce visible rows');
    await click(page, testids.expandAll, 'expand all', '모두 펼침');
    assert((await page.$$eval('tbody tr', nodes => nodes.length)) === expandedRows, 'expand did not restore rows');
    await click(page, 'pivot-exe-field-CounName', 'open sort field');
    await click(page, null, 'sort ascending', '오름차순');
    assert((await page.$eval('table tbody tr th', node => node.textContent)).includes('에콰도르'), 'ascending country order not applied');
    assert((await page.$eval('[data-testid="pivot-exe-field-CounName"]', node => node.textContent)).includes('▲'), 'ascending indicator missing');
    await click(page, 'pivot-exe-field-CounName', 'open descending sort');
    await click(page, null, 'sort descending', '내림차순');
    assert((await page.$eval('table tbody tr th', node => node.textContent)).includes('콜롬비아'), 'descending country order not applied');
    assert((await page.$eval('[data-testid="pivot-exe-field-CounName"]', node => node.textContent)).includes('▼'), 'descending indicator missing');
    await click(page, 'pivot-exe-field-CounName', 'open clear sort');
    await click(page, null, 'clear sort', '정렬 해제');

    // Grouped headers, true cell grid and display-only precision.
    assert((await page.$$eval('table thead tr', nodes => nodes.length)) >= 3, 'column headers must be hierarchical');
    assert((await page.$$eval('table th[colspan]', nodes => nodes.some(n => Number(n.colSpan) > 1))), 'column groups are not merged');
    assert((await page.$$eval('table tbody [rowspan]', nodes => nodes.some(n => Number(n.rowSpan) > 1))), 'row ancestors are not merged');
    const initialGrid = await page.$eval('table', node => node.innerText);
    await click(page, 'pivot-exe-decimals-toggle', 'hide decimals');
    assert(!(await page.$eval('table', node => node.innerText)).includes('12.50'), 'decimal hide did not change display');
    await click(page, 'pivot-exe-decimals-toggle', 'restore decimals');
    assert((await page.$eval('table', node => node.innerText)) === initialGrid, 'precision toggle mutated pivot values');

    // Resize via left-click controls and retain preferences across reload.
    const setControl = async (id, value) => {
      const element = await page.$(selector(id));
      const tag = await element.evaluate(node => node.tagName);
      if (tag === 'SELECT') await element.select(String(value));
      else { await element.click(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.type(String(value)); await page.keyboard.press('Tab'); }
      await delay(100);
    };
    await setControl('pivot-exe-row-height', 32);
    await setControl('pivot-exe-data-width', 120);
    const measured = await page.evaluate(() => {
      const table = document.querySelector('table');
      const row = table.querySelector('tbody tr');
      return {height:row.getBoundingClientRect().height,border:getComputedStyle(row.lastElementChild).borderRightWidth};
    });
    assert(measured.height >= 31 && measured.height <= 34, `row height control ineffective: ${measured.height}`);
    assert(parseFloat(measured.border) > 0, 'vertical cell borders missing');

    const readDecimals = () => page.evaluate(() => {
      const label = [...document.querySelectorAll('label')].find(node => node.textContent.includes('소수 자릿수'));
      return label?.querySelector('select')?.value;
    });
    const writeDecimals = async value => {
      await page.evaluate(next => {
        const label = [...document.querySelectorAll('label')].find(node => node.textContent.includes('소수 자릿수'));
        const select = label?.querySelector('select');
        if (!select) throw new Error('decimal precision selector not found');
        select.value = String(next);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
      await waitFor(async () => (await readDecimals()) === String(value), `decimal precision ${value}`);
    };
    const setInput = async (id, value) => page.$eval(selector(id), (node, next) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error(`Cannot set ${node.dataset.testid}`);
      setter.call(node, String(next));
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await writeDecimals(0);
    await setInput('pivot-exe-favorite-name', 'Smoke zero-decimal layout');
    await click(page, 'pivot-exe-favorite-save', 'save mock favorite');
    await waitFor(() => page.$eval('[data-testid="pivot-exe-favorite-status"]', node => node.textContent.includes('저장했습니다')), 'favorite save');
    assert(favoriteMutations.at(-1)?.method === 'POST' && favoriteMutations.at(-1)?.body.page === 'stats-pivot-exe', 'favorite POST must follow the mocked page/name/filterData contract');
    const savedFavoriteUser = favoriteMutations.at(-1).userId;
    const postedView = JSON.parse(favoriteMutations.at(-1).body.filterData);
    assert(postedView.decimals === 0 && postedView.zeroVisible === false, 'favorite must preserve explicit 0 decimals and false zeroVisible');
    const favoriteKey = await page.$eval(selector('pivot-exe-favorite-select'), node => node.value);
    assert(favoriteKey, 'newly saved mock favorite must be selected');

    await click(page, 'pivot-exe-reset', 'reset before favorite reload');
    assert((await readDecimals()) !== '0', 'reset should restore the default decimal precision');
    await click(page, 'pivot-exe-favorite-load', 'load mock favorite');
    await waitFor(async () => (await readDecimals()) === '0', 'favorite decimals=0 restore');
    assert((await page.$eval('[data-testid="pivot-exe-zone-rows"]', node => node.innerText)).includes('국가'), 'favorite load must restore the saved row layout');
    assert((await page.$eval('[data-testid="pivot-exe-row-height"]', node => node.value)) === '32', 'favorite load must restore saved row height');

    await setControl('pivot-exe-row-height', 33);
    await click(page, 'pivot-exe-favorite-update', 'update mock favorite');
    await waitFor(() => page.$eval('[data-testid="pivot-exe-favorite-status"]', node => node.textContent.includes('덮어썼습니다')), 'favorite update');
    assert(favoriteMutations.at(-1)?.method === 'PUT' && String(favoriteMutations.at(-1)?.body.favoriteKey) === String(favoriteKey), 'favorite PUT must target the selected fixture key');

    // Reauthentication scopes both local preferences and favorite lists to the current mock user.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(() => page.$eval('[data-testid="pivot-exe-row-height"]', node => node.value === '33'), 'user A local settings after reload');
    await waitFor(() => page.$eval('[data-testid="pivot-exe-favorite-select"]', node => [...node.options].some(option => option.textContent === 'Smoke zero-decimal layout')), 'user A favorite after reload');
    currentMockUserId = 'pivot-exe-ui-user-b';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(() => page.$eval('[data-testid="pivot-exe-favorite-select"]', node => !node.disabled), 'user B authenticated layout hydration');
    const userBLayoutKey = `pivotExeLayout:v2:${encodeURIComponent(currentMockUserId)}`;
    await waitFor(() => page.evaluate(key => {
      try { const view = JSON.parse(localStorage.getItem(key)); return view?.rowHeight === 24 && view?.decimals === 2; }
      catch { return false; }
    }, userBLayoutKey), 'user B default layout persisted after hydration');
    await waitFor(() => page.$eval('[data-testid="pivot-exe-favorite-select"]', node => node.options.length === 1), 'user B has no user A favorites');
    const storedViewsAfterUserSwitch = await page.evaluate(({ userAKey, userBKey }) => ({
      userA: JSON.parse(localStorage.getItem(userAKey) || 'null'),
      userB: JSON.parse(localStorage.getItem(userBKey) || 'null'),
    }), {
      userAKey: `pivotExeLayout:v2:${encodeURIComponent(savedFavoriteUser)}`,
      userBKey: userBLayoutKey,
    });
    assert(storedViewsAfterUserSwitch.userA?.rowHeight === 33 && storedViewsAfterUserSwitch.userA?.decimals === 0, 'switching users must retain user A saved layout');
    assert(storedViewsAfterUserSwitch.userB?.rowHeight === 24 && storedViewsAfterUserSwitch.userB?.decimals === 2, 'user B must persist its own default layout, not inherit user A view');

    currentMockUserId = savedFavoriteUser;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(() => page.$eval('[data-testid="pivot-exe-favorite-select"]', node => [...node.options].some(option => option.value)), 'return to user A favorite');
    await page.select(selector('pivot-exe-favorite-select'), favoriteKey);
    await waitFor(() => page.$eval('[data-testid="pivot-exe-favorite-delete"]', node => !node.disabled), 'user A delete control enabled');
    await click(page, 'pivot-exe-favorite-delete', 'delete mock favorite');
    await waitFor(() => page.$eval('[data-testid="pivot-exe-favorite-status"]', node => node.textContent.includes('삭제했습니다')), 'favorite delete');
    assert(favoriteDeleteConfirmation.includes('Smoke zero-decimal layout'), 'favorite delete must ask for confirmation naming only the mock fixture');
    assert(favoriteMutations.at(-1)?.method === 'DELETE' && String(favoriteMutations.at(-1)?.body.favoriteKey) === String(favoriteKey), 'favorite DELETE must target the selected fixture key');

    for (const width of [1920,1366]) {
      await page.setViewport({width,height:width===1920?1080:768,deviceScaleFactor:1});
      await click(page,'pivot-exe-filter-ListType','anchored type filter');
      const bounds = await page.evaluate(() => {
        const anchor=document.querySelector('[data-testid="pivot-exe-filter-ListType"]').getBoundingClientRect();
        const popup=document.querySelector('[data-testid="pivot-exe-value-filter"]').getBoundingClientRect();
        return {ax:anchor.left,ay:anchor.bottom,x:popup.left,y:popup.top,right:popup.right,bottom:popup.bottom,w:innerWidth,h:innerHeight};
      });
      assert(bounds.x>=0 && bounds.y>=0 && bounds.right<=bounds.w && bounds.bottom<=bounds.h, `filter outside ${width} viewport`);
      assert(Math.abs(bounds.x-bounds.ax)<350 && Math.abs(bounds.y-bounds.ay)<350, 'filter popup detached from clicked field');
      await page.screenshot({path:path.resolve(`outputs/pivot-exe-filter-${width}.png`),fullPage:false});
      await page.keyboard.press('Escape');
      assert(!(await page.$('[data-testid="pivot-exe-value-filter"]')), 'Escape did not close filter');
    }
    await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
    const wideLayout = await page.evaluate(() => {
      const deck = document.querySelector('[data-testid="pivot-exe-field-deck"]')?.getBoundingClientRect();
      const tools = document.querySelector('[data-testid="pivot-exe-view-tools"]')?.getBoundingClientRect();
      return deck && tools ? { deckRight: deck.right, toolsLeft: tools.left, toolsTop: tools.top, deckTop: deck.top } : null;
    });
    assert(wideLayout && wideLayout.toolsLeft >= wideLayout.deckRight && Math.abs(wideLayout.toolsTop - wideLayout.deckTop) <= 2, '1920px layout must place view tools to the right of the field deck');
    await setControl('pivot-exe-data-width', '400');
    await waitFor(() => page.$eval('[data-testid="pivot-exe-top-scroll"]', node => node.scrollWidth > node.clientWidth), 'top scrollbar overflow track');
    await page.$eval('[data-testid="pivot-exe-top-scroll"]', node => { node.scrollLeft = Math.min(240, node.scrollWidth - node.clientWidth); node.dispatchEvent(new Event('scroll')); });
    await waitFor(() => page.evaluate(() => {
      const top = document.querySelector('[data-testid="pivot-exe-top-scroll"]');
      const body = document.querySelector('[data-testid="pivot-exe-scroll"]');
      return top && body && top.scrollLeft > 0 && body.scrollLeft === top.scrollLeft;
    }), 'top scrollbar drives body scroll');
    await page.$eval('[data-testid="pivot-exe-scroll"]', node => { node.scrollLeft = Math.min(420, node.scrollWidth - node.clientWidth); node.dispatchEvent(new Event('scroll')); });
    await waitFor(() => page.evaluate(() => {
      const top = document.querySelector('[data-testid="pivot-exe-top-scroll"]');
      const body = document.querySelector('[data-testid="pivot-exe-scroll"]');
      return top && body && body.scrollLeft > 0 && top.scrollLeft === body.scrollLeft;
    }), 'body scrollbar keeps top scrollbar synchronized');
    await setControl('pivot-exe-data-width', '120');
    const downloads = path.resolve('outputs/pivot-exe-downloads', String(Date.now()));
    fs.mkdirSync(downloads, { recursive: true });
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    const priorFiles = new Set(fs.readdirSync(downloads));
    await click(page, testids.export, 'export', '엑셀');
    await waitFor(() => fs.readdirSync(downloads).some(name => name.endsWith('.xlsx') && !priorFiles.has(name)), 'XLSX download');

    // Scope-changing race: the first good response must survive a later 503.
    const before = await page.$eval('table', node => node.innerText);
    failNextRawData = true;
    const rangeSelects = await page.$$('main > div:first-child select');
    await rangeSelects[1].select('37-02');
    await waitFor(() => saw503, '503 race response');
    await page.waitForSelector('[data-testid="pivot-exe-error"]');
    const after = await page.$eval('table', node => node.innerText);
    assert(after === before, 'last good data was not preserved after scope-changing 503');

    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForSelector('[data-testid="pivot-exe-row-height"]');
    await waitFor(async () => await page.$eval('[data-testid="pivot-exe-row-height"]', node => node.value === '33'), 'saved row height hydration');
    assert((await page.$eval('[data-testid="pivot-exe-data-width"]', node => node.value)) === '120', 'saved width lost after reload');
    await page.waitForSelector('[data-testid="pivot-exe-grid"]');
    await waitFor(async () => (await page.$eval('table',node=>node.innerText)).includes('수국 화이트'), 'reloaded fixture');

    for (const width of [1366, 1920]) {
      await page.setViewport({ width, height: width === 1920 ? 1080 : 768, deviceScaleFactor: 1 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) problems.push(`${width}px horizontal overflow`);
      if (width === 1920) { fs.mkdirSync(path.dirname(screenshotPath), { recursive: true }); await page.screenshot({ path: screenshotPath, fullPage: false }); }
    }
    const delayedAuthRegression = await runDelayedAuthLayoutRegression(browser);
    if (forbiddenMutations.length) problems.push(`forbidden mutation requests: ${forbiddenMutations.map(r => `${r.method} ${r.path}`).join(', ')}`);
    assert(favoriteMutations.every(item => ['POST', 'PUT', 'DELETE'].includes(item.method) && item.userId === savedFavoriteUser), 'all favorite mutations must remain scoped to user A in the in-memory fixture');
    if (externalRequests.length) problems.push(`external requests: ${externalRequests.join(', ')}`);
    if (problems.length) process.exitCode = 1;
    console.log(JSON.stringify({ target: targetUrl.href, viewports: ['1920x1080', '1366x768'], columns, rawDataReads, hasCompleteFieldManifest, delayedAuthRegression, favoriteMutations: favoriteMutations.map(item => `${item.method} ${item.userId}`), requests: requests.map(r => `${r.method} ${r.path}?mode=${r.query.mode || ''}`), forbiddenMutations, externalRequests, problems, screenshotPath }, null, 2));
  } catch (error) {
    const failedPage = (await browser.pages()).at(-1);
    const failurePath = screenshotPath.replace(/\.png$/i, '-failure.png');
    if (failedPage) { fs.mkdirSync(path.dirname(failurePath), { recursive: true }); await failedPage.screenshot({ path: failurePath, fullPage: false }).catch(() => {}); }
    console.error(JSON.stringify({ failure: error.stack || error.message, requests, forbiddenMutations, externalRequests, screenshotPath: failurePath }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exit(1); });

// Local-only Puppeteer smoke for the EXE-compatible pivot UI.
// No network, ERP/DB access, downloads, installs, or mutation requests are allowed.
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
      if (method !== 'GET') { forbiddenMutations.push({ method, path: parsed.pathname, body }); return request.respond({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'SMOKE_MUTATIONS_FORBIDDEN' }) }); }
      if (parsed.pathname === '/api/auth/me') return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, user: { userId: 'pivot-exe-ui-smoke', role: 'admin' } }) });
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
    await click(page, testids.refresh, 'initial refresh', '새로고침');
    await waitFor(() => rawDataReads > 0, 'initial pivot data read');
    if (testids.dataRows) assert((await visibleCount(page, testids.dataRows)) > 0, 'mock rawdata rows are not displayed');

    // Every field move is a left-click on a UI-worker-supplied control; no drag or context menu.
    if (hasCompleteFieldManifest) for (const [field, moves] of Object.entries(testids.fieldMoves)) {
      for (const zone of ['row', 'column', 'filter', 'data']) {
        await click(page, moves[zone], `field ${field} -> ${zone}`);
        assert((await visibleCount(page, testids.fieldZones[zone])) > 0, `field zone ${zone} disappeared after ${field}`);
      }
    }
    if (!hasCompleteFieldManifest) {
      const labels = { CustName:['거래처명/농장명','거래처'], CounName:['국가'], OrderWeek:['주문차수','차수'], Quantity:['수량'], FlowerName:['꽃','품종'], ProdName:['품목명(색상)','품목명'], CountryFlower:['품목명(CountryFlower)','국가/품종'], CustArea:['지역'], ListType:['구분'], ShipmentDtm:['출고일'], OrderYear:['주문년도','연도'], UPrice:['입고단가','단가'], OrderNo:['AWB','주문번호'], CustDescr:['비고','거래처 비고'], TPrice:['입고총단가','총단가'] };
      for (const field of columns) for (const [zone, moveId] of [['row',testids.moveRow],['column',testids.moveColumn],['data',testids.moveValue],['filter',testids.moveFilter]]) {
        await click(page, `pivot-exe-field-${field}`, `field ${field} -> ${zone}`);
        await click(page, moveId, `field ${field} -> ${zone} menu`);
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
    await click(page, null, 'clear values', '없음');
    await click(page, null, 'apply empty selection', '적용');
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
    await click(page, null, 'sort', '정렬');
    await click(page, null, 'close menu', '닫기');
    const downloads = path.resolve('outputs/pivot-exe-downloads');
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
    await click(page, testids.refresh, 'refresh after scope change', '새로고침');
    await waitFor(() => saw503, '503 race response');
    await page.waitForSelector('[data-testid="pivot-exe-error"]');
    const after = await page.$eval('table', node => node.innerText);
    assert(after === before, 'last good data was not preserved after scope-changing 503');

    for (const width of [1366, 1920]) {
      await page.setViewport({ width, height: width === 1920 ? 1080 : 768, deviceScaleFactor: 1 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) problems.push(`${width}px horizontal overflow`);
      if (width === 1920) { fs.mkdirSync(path.dirname(screenshotPath), { recursive: true }); await page.screenshot({ path: screenshotPath, fullPage: false }); }
    }
    if (forbiddenMutations.length) problems.push(`forbidden mutation requests: ${forbiddenMutations.map(r => `${r.method} ${r.path}`).join(', ')}`);
    if (externalRequests.length) problems.push(`external requests: ${externalRequests.join(', ')}`);
    if (problems.length) process.exitCode = 1;
    console.log(JSON.stringify({ target: targetUrl.href, viewports: ['1920x1080', '1366x768'], columns, rawDataReads, hasCompleteFieldManifest, requests: requests.map(r => `${r.method} ${r.path}?mode=${r.query.mode || ''}`), forbiddenMutations, externalRequests, problems, screenshotPath }, null, 2));
  } catch (error) {
    const failedPage = (await browser.pages()).at(-1);
    const failurePath = screenshotPath.replace(/\.png$/i, '-failure.png');
    if (failedPage) { fs.mkdirSync(path.dirname(failurePath), { recursive: true }); await failedPage.screenshot({ path: failurePath, fullPage: false }).catch(() => {}); }
    console.error(JSON.stringify({ failure: error.stack || error.message, requests, forbiddenMutations, externalRequests, screenshotPath: failurePath }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exit(1); });

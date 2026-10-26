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
  await page.waitForSelector('[data-testid="pivot-loading-overlay"]', {hidden:true,timeout:30000});
  return label || value;
}
async function text(page) { return page.$eval('body', node => String(node.innerText || '').replace(/\s+/g, ' ').trim()); }
async function visibleCount(page, value) { return value ? page.$$eval(selector(value), nodes => nodes.filter(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden'; }).length) : 0; }
function assert(condition, message) { if (!condition) throw new Error(message); }

(async () => {
  
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
      if (parsed.pathname === '/api/stats/pivot-weeks') return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, weeks: ['37-01','37-02'], orderYear: '2026' }) });
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

    await page.waitForSelector('[data-testid="pivot-loading-overlay"]',{hidden:true,timeout:30000});
    // Recover a mutually restricted country/flower selection through visible controls.
    await click(page,'pivot-exe-filter-CounName','country values');
    await click(page,null,'deselect countries','전체 해제');
    await clickObservable(page,'콜롬비아');
    await click(page,null,'apply country','선택·순서 적용');
    await click(page,'pivot-exe-filter-FlowerName','flower values');
    await click(page,null,'deselect flowers','전체 해제');
    await clickObservable(page,'수국');
    await click(page,null,'apply flower','선택·순서 적용');
    await click(page,'pivot-exe-filter-CounName','locked country values');
    await click(page,'pivot-reset-product-filters','release product filters');
    await click(page,'pivot-exe-filter-CounName','country alternatives restored');
    assert((await page.$eval('[data-testid="pivot-exe-value-filter"]',n=>n.innerText)).includes('에콰도르'),'alternate country unavailable after reset');
    await click(page,null,'deselect countries','전체 해제');
    await clickObservable(page,'에콰도르');
    await click(page,null,'apply alternate country','선택·순서 적용');
    await waitFor(async()=> (await page.$eval('table',n=>n.innerText)).includes('장미 레드'),'alternate country result');
    assert(!(await page.$eval('table',n=>n.innerText)).includes('수국 화이트'),'old country remains in result');
    await click(page,'pivot-exe-reset-filters','global reset');
    await waitFor(async()=> (await page.$eval('table',n=>n.innerText)).includes('수국 화이트'),'reset restores results');
    await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
    await page.evaluate(()=>localStorage.setItem('pivotFieldLayout',JSON.stringify({filter:['country','flower'],fieldFilters:{country:['콜롬비아'],flower:['수국']},showFieldList:true})));
    await clickObservable(page,'기존 웹 피벗');
    await page.waitForSelector('[data-testid="pivot-legacy-reset-filters"]');
    await page.waitForFunction(()=>document.querySelector('select[title="선택 연도에 주문·입고·출고·재고 입력 이력이 있는 세부차수"]')?.value==='37-01');

    await waitFor(async()=> (await text(page)).includes('수국 화이트'),'legacy fixture');
    const triangle=await page.evaluateHandle(()=>{const th=[...document.querySelectorAll('th')].find(n=>n.textContent.trim().startsWith('국가'));return [...th.querySelectorAll('span')].find(n=>n.textContent==='▼');});
    await triangle.asElement().click(); await triangle.dispose();
    await clickObservable(page,'전체해제');
    await clickObservable(page,'에콰도르');
    await waitFor(async()=> (await page.$eval('table',n=>n.innerText)).includes('장미 레드'),'legacy new country result');
    assert(!(await page.$eval('table',n=>n.innerText)).includes('수국 화이트'),'legacy hidden field country still constrains header');
    const legacyStored=await page.evaluate(()=>JSON.parse(localStorage.getItem('pivotFieldLayout')));
    assert(legacyStored.fieldFilters.country?.[0]==='에콰도르'&&!legacyStored.fieldFilters.flower,'legacy header did not synchronize chip or clear child');
    await page.focus('[data-testid="pivot-legacy-reset-filters"]'); await page.keyboard.press('Enter');
    await waitFor(async()=> (await page.$eval('table',n=>n.innerText)).includes('수국 화이트'),'legacy keyboard reset');
    await page.screenshot({path:path.resolve('outputs/pivot-legacy-filter-reset.png'),fullPage:false});
    assert(!problems.length,problems.join('\n'));
    assert(!forbiddenMutations.length && !externalRequests.length,'unexpected network mutation');
    console.log('Pivot filter UI passed: country/flower recovery, alternate-country rows, legacy header/chip sync, keyboard reset, 1920x1080.');
  } catch(error) { const pages=await browser.pages(); await pages.at(-1).screenshot({path:'outputs/pivot-filter-failure.png'}); throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exit(1); });


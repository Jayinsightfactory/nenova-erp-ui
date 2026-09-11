// Local-only 1920x1080 smoke for the compact request/matching panel.
// API requests are intercepted; no ERP, LLM, external, or manual-write call is executed.
// Usage: NODE_PATH=... node scripts/paste-compact-match-ui-smoke.cjs [localhost URL]
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const target = process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3017/orders/paste?popup=1';
const screenshotPath = path.resolve(process.env.SMOKE_SCREENSHOT || 'outputs/paste-compact-match-ui-1920.png');
const targetUrl = new URL(target);
if (!['127.0.0.1', 'localhost'].includes(targetUrl.hostname) || !['http:', 'https:'].includes(targetUrl.protocol)) throw new Error(`SMOKE_BASE_URL must be localhost, received ${target}`);
const chromeCandidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
const executablePath = chromeCandidates.find(candidate => { try { return fs.existsSync(candidate); } catch { return false; } });
if (!executablePath) throw new Error('Chrome executable not found. Set CHROME_PATH.');

const year = '2026';
const week = '37-01';
const from = '2026-09-10';
const to = '2026-09-11';
const identities = Array.from({ length: 12 }, (_, index) => `kakao-sales|compact-match-smoke|message-${String(index + 1).padStart(2, '0')}`);
const customers = ['A농원', 'B농원', 'C농원', 'D농원', 'E농원', 'F농원', 'G농원', 'H농원', 'I농원', 'J농원', 'K농원', 'L농원'];
const products = ['수국 화이트', '장미 레드', '롤리팝 화이트 블루', '리시안셔스 핑크', '해바라기 옐로우', '카네이션 핑크', '튤립 화이트', '안개 블루'];
const messages = identities.map((identity, index) => ({
  source: 'kakao-sales', chat_id: 'compact-match-smoke', external_message_id: `message-${String(index + 1).padStart(2, '0')}`,
  chatroom: '영업방 compact smoke', sender: `담당자 ${String.fromCharCode(65 + index)}`,
  created_at: new Date(Date.UTC(2026, 8, 10 + Math.floor(index / 6), 0, index)).toISOString(),
  message: index === 3
    ? `37-1 변경사항\n${customers[index]}\n${products[index % products.length]} 2박스 취소\n재고 확인 필요`
    : index === 10
      ? `37-1 변경사항\n${customers[index]}\n업체·품목 미확인 1박스 추가`
      : `37-1 변경사항\n${customers[index]}\n${products[index % products.length]} ${index % 3 + 1}${index % 2 ? '박스' : '단'} 추가`,
}));
messages.push({source:'kakao-sales',chat_id:'compact-match-smoke',external_message_id:'stock-only',chatroom:'영업방',sender:'재고 담당',created_at:'2026-09-11T02:00:00.000Z',message:'37-1 잔량\n화이트 20\n블루 8'});
messages.push({source:'kakao-sales',chat_id:'compact-match-smoke',external_message_id:'review-only',chatroom:'영업방',sender:'확인 담당',created_at:'2026-09-11T02:01:00.000Z',message:'분류불명 확인메모\n내용을 확인해주세요'});
const productRows = products.map((prodName, index) => ({
  prodKey: 1500 + index, prodName, unit: index % 2 ? '박스' : '단', requestCount: index < 6 ? 1 : 0,
  requestedSignedDelta: index < 6 ? index % 3 + 1 : 0, observedSignedDelta: index === 1 || index === 4 ? 1 : index < 6 ? index % 3 + 1 : null,
  observedComplete: index < 6 && index !== 2 && index !== 5, expectedBalanceImpact: index < 6 ? -(index % 3 + 1) : 0,
  actualDistributionTotal: 10 + index, storedStockSnapshot: index === 5 ? null : 20 - index,
  snapshotSource: index === 5 ? null : 'PRODUCT_STOCK_SNAPSHOT', snapshotStatus: index === 5 ? 'UNKNOWN' : 'AVAILABLE',
  evidenceStatus: index === 1 ? 'PARTIAL' : index === 5 ? 'UNCONFIRMED' : index < 6 ? 'CONSISTENT' : 'UNCONFIRMED',
  visibleByDefault: index === 1 || index === 2 || index === 5, reasonCodes: index === 1 ? ['OBSERVED_DELTA_GAP'] : index === 5 ? ['BASE_STOCK_MISSING'] : [],
  sourceIdentities: index < 6 ? [identities[index]] : [], requestIds: index < 6 ? [`${identities[index]}:3`] : [],
  requests: index < 6 ? [{ requestId: `${identities[index]}:3`, sourceIdentity: identities[index], custKey: index === 5 ? null : 600 + index, prodKey: 1500 + index, requestedSignedDelta: index % 3 + 1, observedSignedDelta: index === 1 ? 1 : index === 5 ? null : index % 3 + 1, evidenceStatus: index === 1 ? 'PARTIAL' : index === 5 ? 'UNCONFIRMED' : 'CONSISTENT', reasonCodes: index === 1 ? ['OBSERVED_DELTA_GAP'] : index === 5 ? ['BASE_STOCK_MISSING'] : [] }] : [],
}));
productRows[3].requests[0].requestedSignedDelta=-2;
productRows[3].requests[0].observedSignedDelta=-2;
const historyItems = messages.map((message, index) => {
  if(index>=12)return {sourceIdentity:`${message.source}|${message.chat_id}|${message.external_message_id}`,status:'AMBIGUOUS',requests:[]};
  const product = productRows[index % productRows.length];
  const request = product.requests[0];
  const validRequest=index<6?request:null;
  return { sourceIdentity: `${message.source}|${message.chat_id}|${message.external_message_id}`, status: product.evidenceStatus === 'CONSISTENT' ? 'ORDER_AND_DISTRIBUTION' : product.evidenceStatus === 'PARTIAL' ? 'AMBIGUOUS' : 'NO_LIVE_EVIDENCE', reason: '요청별 확인 결과', requests: validRequest ? [{ id: request.requestId, quote: message.message, customerText: customers[index], productText: product.prodName, action:'ADD', qty: Math.abs(request.requestedSignedDelta), unit: product.unit, status: request.evidenceStatus==='CONSISTENT'?'DISTRIBUTION_EVIDENCE':'AMBIGUOUS', reason: '확인된 요청', custKey: request.custKey, prodKey: request.prodKey, orderEvents: [], shipmentEvents: request.observedSignedDelta===null?[]:[{eventId:index+1,before:0,after:request.observedSignedDelta,unit:product.unit}] }] : [] };
});
const balanceRequests = productRows.flatMap(product => product.requests.map(request => ({ ...request, prodName: product.prodName, unit: product.unit, actualDistributionTotal: product.actualDistributionTotal, storedStockSnapshot: product.storedStockSnapshot, snapshotSource: product.snapshotSource, snapshotStatus: product.snapshotStatus, expectedBalanceImpact: -request.requestedSignedDelta, productEvidenceStatus: product.evidenceStatus, productReasonCodes: product.reasonCodes })));
const pureStockRows = productRows.slice(0, 8).map((product, index) => ({ prodKey: product.prodKey, prodName: product.prodName, unit: product.unit, requestCount: 0, actualDistributionTotal: 30 + index, storedStockSnapshot: 40 - index, snapshotSource: 'PRODUCT_STOCK_SNAPSHOT', snapshotStatus: 'AVAILABLE', evidenceStatus: 'UNCONFIRMED', reasonCodes: ['STOCK_ONLY_REFERENCE'] }));
const apiRequests = [];
const forbiddenWrites = [];
const blockedExternal = [];
const problems = [];
let failHistory = false;
let liveHistoryPosts = 0;

function json(request, body, status = 200) { return request.respond({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) }); }
function bodyOf(request) { try { return request.postData() ? JSON.parse(request.postData()) : {}; } catch { return {}; } }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(check, description, timeout = 30000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check()) return; await delay(50); } throw new Error(`Timed out waiting for ${description}`); }
async function text(page) { return page.$eval('body', node => String(node.innerText || '').replace(/\s+/g, ' ').trim()); }
async function clickSemantic(page, pattern) {
  const clicked = await page.evaluate(source => {
    const regex = new RegExp(source);
    const testid = [...document.querySelectorAll('[data-testid]')].find(node => {
      if (node.disabled) return false;
      const id = node.getAttribute('data-testid') || '';
      const label = (node.textContent || '').replace(/\s+/g, ' ');
      return regex.test(id) || regex.test(label);
    });
    const direct = testid || [...document.querySelectorAll('button,[role="button"],summary,label')].find(node => !node.disabled && regex.test((node.textContent || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ')));
    if (!direct) return false;
    if (direct.matches('label')) direct.querySelector('input')?.click(); else direct.click();
    return true;
  }, pattern.source);
  if (!clicked) throw new Error(`semantic control not found: ${pattern}`);
}
async function fillDatesAndLoad(page) {
  await waitFor(async () => (await page.$$('section.sales-inbox input[type="date"]')).length >= 2, 'date controls');
  await page.$$eval('section.sales-inbox input[type="date"]', (nodes, values) => nodes.slice(0, 2).forEach((node, index) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(node, values[index]); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }), [from, to]);
  await page.evaluate(targetWeek => [...document.querySelectorAll('button')].find(node => (node.textContent || '').includes(targetWeek))?.click(), week);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(node => (node.textContent || '').trim() === '영업방 불러오기')?.click());
}

(async () => {
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('pageerror', error => problems.push(`pageerror: ${error.stack || error.message}`));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text()}`); });
    await page.evaluateOnNewDocument(() => localStorage.setItem('nenovaUser', JSON.stringify({ userId: 'compact-match-smoke', userName: 'compact-match-smoke', role: 'admin' })));
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const requestUrl = request.url();
      if (requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) return request.continue();
      let parsed;
      try { parsed = new URL(requestUrl); } catch { return request.abort('blockedbyclient'); }
      if (parsed.origin !== targetUrl.origin) { blockedExternal.push(requestUrl); return request.abort('blockedbyclient'); }
      if (!parsed.pathname.startsWith('/api/')) return request.continue();
      const method = request.method().toUpperCase();
      const payload = bodyOf(request);
      apiRequests.push({ method, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), body: payload });
      if (parsed.pathname === '/api/orders/distribution-live-history') {
        if (method !== 'POST') return json(request, { error: { code: 'METHOD_NOT_ALLOWED', message: 'fixture permits POST only' } }, 405);
        liveHistoryPosts += 1;
        if (failHistory) return json(request, { error: { code: 'COMPACT_MATCH_READ_FAILED', message: 'fixture compact match poll failure' } }, 503);
        if (String(payload.year) !== year || String(payload.week) !== week || payload.from !== from || payload.to !== to || !Array.isArray(payload.messages)) return json(request, { error: { code: 'BAD_FIXTURE_SCOPE', message: 'scope/messages mismatch' } }, 400);
        return json(request, { success: true, advisoryOnly: true, erpAction: 'NONE', scope: { year, weeks: [week], from, to }, asOf: '2026-09-11T02:00:00.000Z', items: historyItems, warnings: [], balanceComparison: { version: 1, defaultFilter: 'EXCEPTIONS', summary: { productCount: productRows.length, visibleCount: 3, consistentHiddenCount: 3, unresolvedRequestCount: 3 }, products: productRows, requests: balanceRequests, stockRows: pureStockRows } });
      }
      if (method !== 'GET') { forbiddenWrites.push({ method, path: parsed.pathname, body: payload }); return json(request, { error: { code: 'FIXTURE_WRITE_BLOCKED', message: `compact smoke forbids ${method} ${parsed.pathname}` } }, 405); }
      if (parsed.pathname === '/api/auth/me') return json(request, { success: true, user: { userId: 'compact-match-smoke', userName: 'compact-match-smoke', role: 'admin' } });
      if (parsed.pathname === '/api/kakao/sales-feed') return json(request, { ok: true, messages, hasMore: false, nextAfterKey: null });
      if (parsed.pathname === '/api/orders/mappings') return json(request, { success: true, mappings: {} });
      if (parsed.pathname === '/api/master') return json(request, { success: true, data: [] });
      if (parsed.pathname === '/api/orders/prod-units') return json(request, { success: true, units: {} });
      if (parsed.pathname === '/api/orders/weeks') return json(request, { success: true, weeks: [`${year}-${week}`] });
      if (parsed.pathname === '/api/favorites') return json(request, { success: true, favorites: [] });
      if (parsed.pathname === '/api/orders/paste-history') return json(request, { success: true, operations: [], hasMore: false, nextCursor: null });
      if (parsed.pathname === '/api/orders/history') return json(request, { success: true, history: [], page: 1, hasMore: false, orderYear: year });
      if (parsed.pathname === '/api/orders/distribution-change-audits') return json(request, { items: [], advisoryOnly: true, erpAction: 'NONE', limit: 20, asOf: '2026-09-11T00:00:00.000Z' });
      return json(request, { success: true, data: [], rows: [], items: [], applications: [], mappings: {}, favorites: [], hasMore: false, nextCursor: null });
    });

    await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitFor(() => page.$('section.sales-inbox'), 'sales inbox');
    await fillDatesAndLoad(page);
    await waitFor(() => liveHistoryPosts > 0, 'compact match read POST');
    await waitFor(async () => (await page.$$('[data-testid^="compact-match-row:"]')).length > 0, 'compact request rows');
    await clickSemantic(page, /^compact-match-tab-request$/);
    await waitFor(async () => (await page.$$('[data-testid^="compact-match-row:"]')).length > 0, 'request tab rows');
    const visibleRows = await page.$$eval('[data-testid^="compact-match-row:"]', nodes => {
      const rows = nodes.filter(node => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      return rows.map(node => {
        const summary = node.querySelector('.compact-match-summary');
        return { identity: node.getAttribute('data-testid'), text: String(summary ? summary.innerText : '').replace(/\s+/g, ' ') };
      });
    });
    const visibleStatusLabels = await page.$$eval('[data-testid^="compact-match-status:"]', nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map(node => ({ className: node.className, label: String(node.childNodes[0]?.textContent || '').replace(/\s+/g, ' ').trim(), text: String(node.innerText || '').replace(/\s+/g, ' ').trim() })));
    if (!visibleStatusLabels.some(status => /(?:^|\s)compact-match-status-MATCHED(?:\s|$)/.test(status.className) && status.label.startsWith('매칭'))) problems.push(`default request tab is missing MATCHED/매칭 status: ${JSON.stringify(visibleStatusLabels)}`);
    if (!visibleStatusLabels.some(status => /(?:^|\s)compact-match-status-PARTIAL(?:\s|$)/.test(status.className) && status.label.startsWith('일부 매칭'))) problems.push(`default request tab is missing PARTIAL/일부 매칭 status: ${JSON.stringify(visibleStatusLabels)}`);
    if (!visibleStatusLabels.some(status => /(?:^|\s)compact-match-status-UNCONFIRMED(?:\s|$)/.test(status.className) && status.label.startsWith('미확인'))) problems.push(`default request tab is missing UNCONFIRMED/미확인 status: ${JSON.stringify(visibleStatusLabels)}`);
    if (visibleStatusLabels.some(status => /부분|주문·분배|이력 확인/.test(status.label))) problems.push(`legacy compact status label remains visible: ${JSON.stringify(visibleStatusLabels)}`);
    if (visibleRows.length < 8) problems.push(`request tab exposes fewer than 8 visible request rows: ${visibleRows.length}`);
    if (!visibleRows.some(row => row.identity.endsWith('message-04'))) problems.push('mixed cancel/stock message is not visible in request rows');
    const visibleAutomaticBadges = await page.$$eval('[data-testid^="compact-match-row:"] .compact-automatic-badge', nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).length);
    const visibleManualBadges = await page.$$eval('[data-testid^="compact-match-row:"] .compact-manual-badge', nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).length);
    if (!visibleAutomaticBadges) problems.push('automatic match badge is not visible in default request rows');
    if (visibleManualBadges) problems.push(`manual badge is visible before row expansion: ${visibleManualBadges}`);
    const visibleManualMenus = await page.$$eval('[data-testid^="compact-manual-menu:"]', nodes => nodes.filter(node => {
      if(!node.checkVisibility())return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).length);
    if (visibleManualMenus) problems.push(`manual menu is visible before row expansion: ${visibleManualMenus}`);
    const openVisibleDetails = await page.$$eval('[data-testid^="compact-match-row:"] > details', nodes => nodes.filter(node => {
      const row = node.closest('[data-testid^="compact-match-row:"]');
      const rect = row?.getBoundingClientRect();
      const style = row ? getComputedStyle(row) : null;
      return row && rect && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && node.open;
    }).length);
    if (openVisibleDetails) problems.push(`visible request details expanded by default: ${openVisibleDetails}`);
    const requestDensity = await page.$eval('.compact-match-list', list => {
      const viewport = list.getBoundingClientRect();
      let clipTop=Math.max(0,viewport.top),clipBottom=Math.min(innerHeight,viewport.bottom);
      for(let parent=list.parentElement;parent;parent=parent.parentElement){if(/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)){const box=parent.getBoundingClientRect();clipTop=Math.max(clipTop,box.top);clipBottom=Math.min(clipBottom,box.bottom);}}
      const rows = [...list.querySelectorAll('[data-testid^="compact-match-row:"]')];
      const intersecting = rows.filter(row => {
        const rect = row.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right > viewport.left && rect.left < viewport.right && rect.top >= clipTop && rect.bottom <= clipBottom;
      }).length;
      return { viewport: { left: viewport.left, right: viewport.right, top:clipTop, bottom:clipBottom }, intersecting };
    });
    if (requestDensity.intersecting < 8) problems.push(`request tab first viewport shows fewer than 8 intersecting rows: ${JSON.stringify(requestDensity)}`);
    if (visibleRows.some(row => /stock-only|review-only/.test(row.identity))) problems.push('stock/review message leaked into default requests');
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    const initialScreenshotPath = screenshotPath.replace(/\.png$/i, '-initial.png');
    await page.screenshot({ path: initialScreenshotPath, fullPage: false });
    const postCountBeforeDetails=liveHistoryPosts;
    await page.click('[data-testid^="compact-match-row:"] > details > summary');
    await page.click('[data-testid^="compact-manual-menu:"] > summary');
    const manualMenu=await page.$eval('[data-testid^="compact-manual-menu:"]',node=>node.innerText);
    if(!/처리함/.test(manualMenu)||!/미처리/.test(manualMenu)||!/해제/.test(manualMenu))problems.push('manual menu controls missing');
    await page.click('[data-testid^="compact-match-row:"] > details > summary');
    if(liveHistoryPosts!==postCountBeforeDetails)problems.push('expanding details unexpectedly ran comparison');

    await clickSemantic(page, /^compact-match-tab-stock$/);
    await waitFor(async () => (await page.$$('[data-testid^="compact-match-row:"]')).length > 0, 'stock tab retained messages');
    const stockVisibleRows = await page.$$eval('[data-testid^="compact-match-row:"]', nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).length);
    if (!stockVisibleRows) problems.push('stock tab does not retain message rows');
    await clickSemantic(page, /^compact-match-tab-review$/);
    await waitFor(async () => (await page.$$('[data-testid^="compact-match-row:"]')).length > 0, 'review tab message');
    const reviewVisibleText = await page.$$eval('[data-testid^="compact-match-row:"]', nodes => nodes.filter(node => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }).map(node => String(node.innerText || '').replace(/\s+/g, ' ')).join(' '));
    if (!reviewVisibleText.includes('분류불명 확인메모')) problems.push('review tab does not retain review-unknown message');
    await clickSemantic(page, /^compact-match-tab-request$/);

    const draftSelector = '[data-testid="paste-main-input"], .paste-column-order-input textarea.paste-main-ta';
    const textarea = await page.$(draftSelector);
    if (textarea) {
      await textarea.focus();
      await page.keyboard.type(' compact draft preserve');
      const draftBefore = await page.$eval(draftSelector, node => node.value);
      const postsBeforeFailure = liveHistoryPosts;
      failHistory = true;
      await clickSemantic(page, /최신 이력 새로고침|다시.*조회|compact.*새로|잔량.*새로/);
      await waitFor(() => liveHistoryPosts > postsBeforeFailure, 'poll failure POST');
      await waitFor(async () => /기존.*유지|조회.*실패|fixture compact match poll failure/.test(await text(page)), 'poll failure notice');
      if (await page.$eval(draftSelector, node => node.value) !== draftBefore) problems.push('draft was lost after poll failure');
      await page.screenshot({ path: screenshotPath.replace(/\.png$/i, '-failure.png'), fullPage: false });
    } else problems.push('compact raw-message draft textarea is missing');

    const layout = await page.$eval('section.sales-inbox', element => { const box = element.getBoundingClientRect(); const controls = [...element.querySelectorAll('button,input,textarea')].map(node => { const r = node.getBoundingClientRect(); return { visible: r.width > 0 && r.height > 0, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }; }); const panels = [...element.querySelectorAll('[data-testid="compact-match-panel"], .live-history-panel, .live-balance-comparison')].slice(0, 1).map(node => { const r = node.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; }); return { container: { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom) }, controls, panels, documentOverflow: document.documentElement.scrollWidth > window.innerWidth }; });
    if (layout.documentOverflow) problems.push('1920x1080 compact matching causes horizontal overflow');
    if (layout.controls.filter(control => control.visible).some(control => control.left < layout.container.left || control.right > layout.container.right)) problems.push(`visible control bounds exceed sales-inbox container: ${JSON.stringify(layout.controls)}`);
    const listBounds=await page.$eval('.compact-match-list',node=>{const r=node.getBoundingClientRect();return {width:r.width,left:r.left,right:r.right};});
    if(listBounds.width<=0||listBounds.left<layout.container.left||listBounds.right>layout.container.right)problems.push('compact list bounds invalid');
    if (forbiddenWrites.length) problems.push(`forbidden write attempts: ${forbiddenWrites.map(write => `${write.method} ${write.path}`).join(', ')}`);
    if (blockedExternal.length) problems.push(`blocked external requests: ${blockedExternal.join(', ')}`);
    await page.setViewport({width:1366,height:768,deviceScaleFactor:1});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))problems.push('1366px horizontal overflow');
    if(!(await page.$eval('.compact-operation-summary',node=>node.checkVisibility())))problems.push('smaller screen hides corresponding operation');
    await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
    await page.$eval('section.sales-inbox input[type="date"]',node=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'2026-09-09');node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));});
    await waitFor(async()=>!(await page.$('.compact-match-status-MATCHED')),'old-scope matching cleared');
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(JSON.stringify({ viewport: '1920x1080', target: targetUrl.href, messages: messages.length, liveHistoryPosts, forbiddenWrites, blockedExternal, requestDensity, layout:{container:layout.container,documentOverflow:layout.documentOverflow}, screenshotPath, problems }, null, 2));
    if (problems.length) process.exitCode = 1;
  } catch (error) {
    const failedPage = (await browser.pages()).at(-1);
    if (failedPage) { fs.mkdirSync(path.dirname(screenshotPath), { recursive: true }); await failedPage.screenshot({ path: screenshotPath.replace(/\.png$/i, '-failure.png'), fullPage: false }).catch(() => {}); }
    console.error(JSON.stringify({ failure: error.stack || error.message, problems, apiRequests: apiRequests.map(request => `${request.method} ${request.path}`), pageText: await failedPage?.evaluate(() => document.body?.innerText || '').catch(() => '') || '', screenshotPath: screenshotPath.replace(/\.png$/i, '-failure.png') }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

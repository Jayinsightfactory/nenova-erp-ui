// Local-only 1920x1080 smoke for request-vs-balance comparison.
// All network/API calls are intercepted. Only the read-only live-history POST is allowed.
// Usage: NODE_PATH=... node scripts/paste-request-balance-ui-smoke.cjs [localhost URL]
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const target = process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3007/orders/paste?popup=1';
const screenshotPath = path.resolve(process.env.SMOKE_SCREENSHOT || 'outputs/paste-request-balance-ui-1920.png');
const targetUrl = new URL(target);
if (!['127.0.0.1', 'localhost'].includes(targetUrl.hostname) || !['http:', 'https:'].includes(targetUrl.protocol)) {
  throw new Error(`SMOKE_BASE_URL must be an http(s) localhost URL, received ${target}`);
}
const chromeCandidates = [
  process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser', '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = chromeCandidates.find(candidate => { try { return fs.existsSync(candidate); } catch { return false; } });
if (!executablePath) throw new Error('Chrome executable not found. Set CHROME_PATH.');

const year = '2026';
const week = '37-01';
const from = '2026-09-10';
const to = '2026-09-11';
const productKeys = { transfer: 1411, partial: 1412, unknown: 1413 };
const identities = {
  cancel: 'kakao-sales|request-balance-smoke|message-cancel',
  add: 'kakao-sales|request-balance-smoke|message-add',
  partial: 'kakao-sales|request-balance-smoke|message-partial',
  unknown: 'kakao-sales|request-balance-smoke|message-unknown',
};
const messages = [
  {
    source: 'kakao-sales', chat_id: 'request-balance-smoke', external_message_id: 'message-cancel',
    chatroom: '영업방 balance smoke', sender: '담당자 A', created_at: '2026-09-10T09:00:00+09:00',
    message: '37-1 변경사항\nA농원\n롤리팝 화이트 블루 1단 취소',
  },
  {
    source: 'kakao-sales', chat_id: 'request-balance-smoke', external_message_id: 'message-add',
    chatroom: '영업방 balance smoke', sender: '담당자 B', created_at: '2026-09-10T09:05:00+09:00',
    message: '37-1 변경사항\nB농원\n롤리팝 화이트 블루 1단 추가',
  },
  {
    source: 'kakao-sales', chat_id: 'request-balance-smoke', external_message_id: 'message-partial',
    chatroom: '영업방 balance smoke', sender: '담당자 C', created_at: '2026-09-11T09:00:00+09:00',
    message: '37-1 변경사항\nC농원\n수국 화이트 3박스 추가',
  },
  {
    source: 'kakao-sales', chat_id: 'request-balance-smoke', external_message_id: 'message-unknown',
    chatroom: '영업방 balance smoke', sender: '담당자 D', created_at: '2026-09-11T09:05:00+09:00',
    message: '37-1 변경사항\nD농원\n장미 레드 2박스 추가',
  },
];
const balanceProducts = [
  {
    prodKey: productKeys.transfer, prodName: '롤리팝 화이트 블루', unit: '단', requestCount: 2,
    requestedSignedDelta: 0, observedSignedDelta: 0, observedComplete: true, expectedBalanceImpact: 0,
    actualDistributionTotal: 20, storedStockSnapshot: 7,
    snapshotSource: 'PRODUCT_STOCK_SNAPSHOT', snapshotStatus: 'AVAILABLE', evidenceStatus: 'CONSISTENT', visibleByDefault: false,
    reasonCodes: [], sourceIdentities: [identities.cancel, identities.add], requestIds: [`${identities.cancel}:3`, `${identities.add}:3`],
    requests: [
      { requestId: `${identities.cancel}:3`, sourceIdentity: identities.cancel, custKey: 501, prodKey: productKeys.transfer, requestedSignedDelta: -1, observedSignedDelta: -1, evidenceStatus: 'CONSISTENT', reasonCodes: [] },
      { requestId: `${identities.add}:3`, sourceIdentity: identities.add, custKey: 502, prodKey: productKeys.transfer, requestedSignedDelta: 1, observedSignedDelta: 1, evidenceStatus: 'CONSISTENT', reasonCodes: [] },
    ],
  },
  {
    prodKey: productKeys.partial, prodName: '수국 화이트', unit: '박스', requestCount: 1,
    requestedSignedDelta: 3, observedSignedDelta: 1, observedComplete: true, expectedBalanceImpact: -3,
    actualDistributionTotal: 8, storedStockSnapshot: 6,
    snapshotSource: 'PRODUCT_STOCK_SNAPSHOT', snapshotStatus: 'AVAILABLE', evidenceStatus: 'PARTIAL', visibleByDefault: true,
    reasonCodes: ['OBSERVED_DELTA_GAP'], sourceIdentities: [identities.partial], requestIds: [`${identities.partial}:3`],
    requests: [{ requestId: `${identities.partial}:3`, sourceIdentity: identities.partial, custKey: 503, prodKey: productKeys.partial, requestedSignedDelta: 3, observedSignedDelta: 1, evidenceStatus: 'PARTIAL', reasonCodes: ['OBSERVED_DELTA_GAP'] }],
  },
  {
    prodKey: productKeys.unknown, prodName: '장미 레드', unit: '박스', requestCount: 1,
    requestedSignedDelta: 2, observedSignedDelta: null, observedComplete: false, expectedBalanceImpact: -2,
    actualDistributionTotal: null, storedStockSnapshot: null,
    snapshotSource: null, snapshotStatus: 'UNKNOWN', evidenceStatus: 'UNCONFIRMED', visibleByDefault: true,
    reasonCodes: ['BASE_STOCK_MISSING', 'DISTRIBUTION_UNCONFIRMED'], sourceIdentities: [identities.unknown], requestIds: [`${identities.unknown}:3`],
    requests: [{ requestId: `${identities.unknown}:3`, sourceIdentity: identities.unknown, custKey: null, prodKey: productKeys.unknown, requestedSignedDelta: 2, observedSignedDelta: null, evidenceStatus: 'UNCONFIRMED', reasonCodes: ['BASE_STOCK_MISSING', 'DISTRIBUTION_UNCONFIRMED'] }],
  },
];
const balanceRequests = balanceProducts.flatMap(product => product.requests.map(request => ({ ...request, prodKey: product.prodKey, prodName: product.prodName, unit: product.unit })));
const historyItems = messages.map(message => {
  const identity = `${message.source}|${message.chat_id}|${message.external_message_id}`;
  const product = identity === identities.cancel || identity === identities.add ? balanceProducts[0] : identity === identities.partial ? balanceProducts[1] : balanceProducts[2];
  const balanceRequest = product.requests.find(request => request.sourceIdentity === identity);
  return {
    sourceIdentity: identity,
    status: product.evidenceStatus === 'CONSISTENT' ? 'ORDER_AND_DISTRIBUTION' : product.evidenceStatus === 'PARTIAL' ? 'AMBIGUOUS' : 'NO_LIVE_EVIDENCE',
    reason: product.evidenceStatus === 'PARTIAL' ? '요청 3 중 관측 1 · gap 2' : product.evidenceStatus === 'UNCONFIRMED' ? '분배 이력과 잔량 근거 미확인' : '취소 1과 추가 1이 서로 다른 이력으로 확인',
    requests: [{ id: `${identity}:3`, quote: message.message.split('\n').slice(-2).join(' '), customerText: message.message.split('\n')[1], productText: product.prodName, qty: Math.abs(balanceRequest.requestedSignedDelta), unit: product.unit, status: product.evidenceStatus, reason: product.reasonCodes.join(',') || '유일한 전산 이력 확인', custKey: balanceRequest.custKey, prodKey: balanceRequest.prodKey, requestedSignedDelta: balanceRequest.requestedSignedDelta, observedSignedDelta: balanceRequest.observedSignedDelta, evidenceStatus: balanceRequest.evidenceStatus, reasonCodes: balanceRequest.reasonCodes, orderEvents: [], shipmentEvents: [] }],
  };
});
const apiRequests = [];
const blockedExternal = [];
const problems = [];
let failHistory = false;
let liveHistoryPosts = 0;

function json(request, body, status = 200) { return request.respond({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) }); }
function bodyOf(request) { try { return request.postData() ? JSON.parse(request.postData()) : {}; } catch { return {}; } }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(50); }
  throw new Error(`Timed out waiting for ${description}`);
}
async function visibleText(page) { return page.$eval('body', node => String(node.innerText || '').replace(/\s+/g, ' ').trim()); }
async function clickByText(page, pattern) {
  const clicked = await page.evaluate(source => {
    const regex = new RegExp(source);
    const button = [...document.querySelectorAll('button, [role="button"]')].find(node => !node.disabled && regex.test((node.textContent || '').replace(/\s+/g, ' ')));
    if (button) { button.click(); return true; }
    const label = [...document.querySelectorAll('label')].find(node => regex.test((node.textContent || '').replace(/\s+/g, ' ')));
    const input = label?.querySelector('input:not(:disabled)');
    if (input) { input.click(); return true; }
    return false;
  }, pattern.source);
  if (!clicked) throw new Error(`button not found: ${pattern}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('pageerror', error => problems.push(`pageerror: ${error.stack || error.message}`));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text()}`); });
    await page.evaluateOnNewDocument(() => localStorage.setItem('nenovaUser', JSON.stringify({ userId: 'request-balance-smoke', userName: 'request-balance-smoke', role: 'admin' })));
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
        if (failHistory) return json(request, { error: { code: 'BALANCE_COMPARISON_READ_FAILED', message: 'fixture balance comparison read failure' } }, 503);
        if (String(payload.year) !== year || String(payload.week) !== week || payload.from !== from || payload.to !== to || !Array.isArray(payload.messages)) return json(request, { error: { code: 'BAD_FIXTURE_SCOPE', message: 'scope/messages mismatch' } }, 400);
        return json(request, { success: true, advisoryOnly: true, erpAction: 'NONE', scope: { year, weeks: [week], from, to }, asOf: '2026-09-11T02:00:00.000Z', items: historyItems, warnings: [], balanceComparison: { version: 1, defaultFilter: 'EXCEPTIONS', summary: { productCount: 3, visibleCount: 2, consistentHiddenCount: 1, unresolvedRequestCount: 1 }, products: balanceProducts, requests: balanceRequests } });
      }
      if (method !== 'GET') return json(request, { error: { code: 'FIXTURE_WRITE_BLOCKED', message: `fixture blocks ${method} ${parsed.pathname}` } }, 405);
      if (parsed.pathname === '/api/auth/me') return json(request, { success: true, user: { userId: 'request-balance-smoke', userName: 'request-balance-smoke', role: 'admin' } });
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
    await waitFor(async () => (await page.$$('section.sales-inbox input[type="date"]')).length >= 2, 'inbox period controls');
    await page.$$eval('section.sales-inbox input[type="date"]', (nodes, values) => nodes.slice(0, 2).forEach((node, index) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(node, values[index]);
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }), [from, to]);
    await page.evaluate(targetWeek => [...document.querySelectorAll('button')].find(node => (node.textContent || '').includes(targetWeek))?.click(), week);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(node => (node.textContent || '').trim() === '영업방 불러오기')?.click());
    await waitFor(() => liveHistoryPosts > 0, 'initial balance-comparison POST');
    await waitFor(async () => (await visibleText(page)).includes('확인된 분배'), 'balance-comparison response rendered');
    const canonicalRequestFields = ['requestId', 'sourceIdentity', 'custKey', 'prodKey', 'requestedSignedDelta', 'observedSignedDelta', 'evidenceStatus', 'reasonCodes'];
    const invalidRequests = balanceProducts.flatMap(product => product.requests.filter(request => canonicalRequestFields.some(field => !Object.prototype.hasOwnProperty.call(request, field)) || request.prodKey !== product.prodKey || !product.sourceIdentities.includes(request.sourceIdentity)));
    if (invalidRequests.length) problems.push(`products[].requests canonical/source ownership is invalid: ${JSON.stringify(invalidRequests)}`);
    const messageIdentities = new Set(messages.map(message => `${message.source}|${message.chat_id}|${message.external_message_id}`));
    const requestIdentities = new Set(balanceProducts.flatMap(product => product.requests.map(request => request.sourceIdentity)));
    if ([...messageIdentities].some(identity => !requestIdentities.has(identity))) problems.push('a raw message has no per-message balanceComparison request');
    if (balanceProducts.some(product => !Array.isArray(product.requests) || product.requests.length === 0 || product.requests.some(request => !messageIdentities.has(request.sourceIdentity)))) problems.push('product without an owned request is not eligible for display');
    if (balanceProducts.every(product => product.requests.every(request => request.custKey !== null))) problems.push('nullable custKey fixture case is missing');
    if (balanceProducts.some(product => product.evidenceStatus === 'CONSISTENT' && (product.visibleByDefault !== false || product.requests.some(request => request.evidenceStatus !== 'CONSISTENT')))) problems.push('a default-hidden product is not fully consistent per request');
    const initialPosts = liveHistoryPosts;
    const initialText = await visibleText(page);
    if (!initialText.includes('수국 화이트') || !/요청\s*\+?3/.test(initialText) || !/확인된 분배\s*\+?1/.test(initialText) || !initialText.includes('차이 2')) problems.push('partial requested 3 / confirmed distribution 1 / 차이 2 is not visible');
    if (!initialText.includes('차수 품목 전체 분배 합계 8') || !initialText.includes('전산 저장 잔량 6')) problems.push('partial canonical balance values are not visible');
    if (!initialText.includes('미확정분 미반영')) problems.push('unconfirmed distribution caveat is not visible');
    if (!initialText.includes('전산 저장 잔량 미확인') && !initialText.includes('잔량 미확인')) problems.push('unknown stored balance is not visible as unknown');
    if (initialText.includes('롤리팝 화이트 블루') && initialText.includes('근거 일치')) problems.push('consistent product is visible before the include-consistent toggle');
    const comparisonText = await page.$$eval('.live-history-panel, [data-balance-comparison], .balance-comparison, .request-balance-comparison', nodes => nodes.map(node => String(node.textContent || '').replace(/\s+/g, ' ').trim()).join(' '));
    if (comparisonText && /완료|적용됨|미처리 확정/.test(comparisonText)) problems.push('comparison panel uses forbidden completion/application language');

    await clickByText(page, /일치\s*포함/);
    await waitFor(async () => /롤리팝 화이트 블루/.test(await visibleText(page)), 'consistent product after filter toggle');
    if (liveHistoryPosts !== initialPosts) problems.push('일치 포함 toggle triggered a new API request');
    const afterToggle = await visibleText(page);
    const perMessageTexts = await page.$$eval('section.sales-inbox article.message', nodes => nodes.map(node => String(node.textContent || '').replace(/\s+/g, ' ').trim()));
    const cancelText = perMessageTexts.find(text => text.includes('A농원')) || '';
    const addText = perMessageTexts.find(text => text.includes('B농원')) || '';
    if (!/요청\s*(?:Δ\s*)?-1/.test(cancelText) || !/확인된 분배\s*(?:Δ\s*)?-1/.test(cancelText)) problems.push(`cancel per-message values are not -1/-1: ${cancelText}`);
    if (!/요청\s*(?:Δ\s*)?\+?1/.test(addText) || !/확인된 분배\s*(?:Δ\s*)?\+?1/.test(addText)) problems.push(`add per-message values are not +1/+1: ${addText}`);
    if (perMessageTexts.some(text => /(?:A농원|B농원)/.test(text) && (/요청\s*(?:Δ\s*)?0/.test(text) || /확인된 분배\s*(?:Δ\s*)?0/.test(text)))) problems.push('global net-zero aggregate was incorrectly rendered as a per-message request value');
    if (!afterToggle.includes('차수 품목 전체 분배 합계 20') || !afterToggle.includes('전산 저장 잔량 7')) problems.push('transfer cancel/add global aggregate values are not visible in the product aggregate');
    const hasSelectedWeekScope = afterToggle.includes(`${year}-${week}`) || /선택\s*차수|전체\s*재고|현재\s*잔량|selected\s*week/i.test(afterToggle);
    const subtitles = await page.$$eval('.live-balance-scope', nodes => nodes.map(node => node.textContent).join(' '));
    if (!hasSelectedWeekScope || /50\s*건.*(?:분배|잔량)|50\s*메시지/.test(subtitles)) problems.push('overall stock subtitle is not scoped to the exact selected week');
    if (!afterToggle.includes('storedStockSnapshot') && !afterToggle.includes('전산 저장 잔량')) problems.push('stored stock snapshot is not labeled as a distinct value');
    if (!afterToggle.includes('7')) problems.push('storedStockSnapshot value 7 is not visible in the global product aggregate');
    if (!afterToggle.includes('미확정분 미반영 가능')) problems.push('stored snapshot disclaimer is not visible');

    const textarea = await page.$('section.sales-inbox textarea, textarea[aria-label*="원문"], textarea');
    if (!textarea) problems.push('request-balance raw-message textarea is not visible');
    else {
      await textarea.focus();
      await page.keyboard.type(' 보존할 balance 초안');
      const beforeFailure = await page.$eval('textarea', node => node.value);
      failHistory = true;
      await clickByText(page, /최신 이력 새로고침|balance.*새로|잔량.*새로|다시.*조회/);
      await waitFor(() => liveHistoryPosts > initialPosts, 'failed balance-comparison POST');
      await waitFor(async () => /fixture balance comparison read failure|기존.*유지|조회.*실패/.test(await visibleText(page)), 'balance failure notice');
      const afterFailure = await visibleText(page);
      if (!afterFailure.includes('수국 화이트') || !afterFailure.includes('롤리팝 화이트 블루')) problems.push('failed balance comparison cleared last good results');
      if (await page.$eval('textarea', node => node.value) !== beforeFailure) problems.push('textarea draft was lost after balance-comparison failure');
    }

    const layout = await page.$eval('section.sales-inbox', element => {
      const rect = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll('button, input, textarea')].map(node => { const box = node.getBoundingClientRect(); return { visible: box.width > 0 && box.height > 0, left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom) }; });
      const pairs = [...element.querySelectorAll('article.message .message-pair')].map(node => { const box = node.getBoundingClientRect(); return { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom), width: Math.round(box.width), height: Math.round(box.height) }; });
      return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), documentOverflow: document.documentElement.scrollWidth > window.innerWidth, controls, pairs };
    });
    if (layout.documentOverflow) problems.push('1920x1080 request-balance UI causes document-level horizontal overflow');
    if (layout.controls.some(box => !box.visible || box.left < layout.left || box.right > layout.right)) problems.push(`control bounding boxes exceed sales-inbox container: ${JSON.stringify(layout.controls)}`);
    if (layout.pairs.length !== messages.length || layout.pairs.some(pair => pair.width <= 0 || pair.height <= 0 || pair.left < layout.left || pair.right > layout.right)) problems.push(`per-message pair bounding boxes exceed container: ${JSON.stringify(layout.pairs)}`);

    const forbiddenPosts = apiRequests.filter(request => request.method !== 'GET' && request.path !== '/api/orders/distribution-live-history');
    if (forbiddenPosts.length) problems.push(`unexpected non-live-history POSTs: ${forbiddenPosts.map(request => `${request.method} ${request.path}`).join(', ')}`);
    if (blockedExternal.length) problems.push(`blocked external requests: ${blockedExternal.join(', ')}`);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(JSON.stringify({ viewport: '1920x1080', target: targetUrl.href, liveHistoryPosts, initialFilter: 'EXCEPTIONS', layout, forbiddenPosts, blockedExternal, screenshotPath, problems }, null, 2));
    if (problems.length) process.exitCode = 1;
  } catch (error) {
    const failedPage = (await browser.pages()).at(-1);
    if (failedPage) { fs.mkdirSync(path.dirname(screenshotPath), { recursive: true }); await failedPage.screenshot({ path: screenshotPath.replace(/\.png$/i, '-failure.png'), fullPage: false }).catch(() => {}); }
    console.error(JSON.stringify({ failure: error.stack || error.message, problems, pageText: await failedPage?.evaluate(() => document.body?.innerText || '').catch(() => '') || '', apiRequests: apiRequests.map(request => `${request.method} ${request.path}`), screenshotPath: screenshotPath.replace(/\.png$/i, '-failure.png') }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

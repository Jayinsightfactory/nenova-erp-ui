// Local-only 1920x1080 smoke for the read-only live-history pairing UI.
// Every network request is intercepted; only the live-history POST is allowed.
// Usage: NODE_PATH=... node scripts/paste-live-history-ui-smoke.cjs [localhost URL]
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const target = process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3007/orders/paste?popup=1';
const screenshotPath = path.resolve(process.env.SMOKE_SCREENSHOT || 'outputs/paste-live-history-ui-1920.png');
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
const firstIdentity = 'kakao-sales|live-history-smoke|message-001';
const secondIdentity = 'kakao-sales|live-history-smoke|message-002';
const messages = [
  {
    source: 'kakao-sales', chat_id: 'live-history-smoke', external_message_id: 'message-001',
    chatroom: '영업방 smoke', sender: '담당자 A', created_at: '2026-09-10T09:00:00+09:00',
    message: '37-1 변경사항\n서울꽃\n수국 화이트 1박스 추가',
  },
  {
    source: 'kakao-sales', chat_id: 'live-history-smoke', external_message_id: 'message-002',
    chatroom: '영업방 smoke', sender: '담당자 B', created_at: '2026-09-11T10:00:00+09:00',
    message: '37-1 변경사항\n부산농원\n장미 레드 2박스 추가',
  },
];
const responseItems = [
  {
    sourceIdentity: firstIdentity, status: 'ORDER_AND_DISTRIBUTION', reason: '동일 원문 이후 주문·분배 이력 모두 확인',
    requests: [{ id: 'request-001', quote: '서울꽃 · 수국 화이트 1박스 추가', customerText: '서울꽃', productText: '수국 화이트', qty: 1, unit: '박스', status: 'ORDER_AND_DISTRIBUTION', reason: '주문과 분배가 같은 요청에 대응',
      orderEvents: [{ eventId: 'order-001', before: 0, after: 1, unit: '박스', changeAt: '2026-09-10T10:00:00+09:00', shipmentDate: null, week: '37-01', custName: '서울꽃', prodName: '수국 화이트' }],
      shipmentEvents: [{ eventId: 'ship-001', before: 0, after: 1, unit: '박스', changeAt: '2026-09-10T11:00:00+09:00', shipmentDate: '2026-09-11', week: '37-01', custName: '서울꽃', prodName: '수국 화이트' }],
    }],
  },
  {
    sourceIdentity: secondIdentity, status: 'ORDER_ONLY', reason: '주문 이력만 확인',
    requests: [{ id: 'request-002', quote: '부산농원 · 장미 레드 2박스 추가', customerText: '부산농원', productText: '장미 레드', qty: 2, unit: '박스', status: 'ORDER_ONLY', reason: '분배 이력 미확인',
      orderEvents: [{ eventId: 'order-002', before: 0, after: 2, unit: '박스', changeAt: '2026-09-11T10:30:00+09:00', shipmentDate: null, week: '37-01', custName: '부산농원', prodName: '장미 레드' }],
      shipmentEvents: [],
    }],
  },
];
const apiRequests = [];
const blockedExternal = [];
const problems = [];
let failHistory = false;
let liveHistoryPosts = 0;

function json(request, body, status = 200) {
  return request.respond({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}
function bodyOf(request) { try { return request.postData() ? JSON.parse(request.postData()) : {}; } catch { return {}; } }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(check, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await wait(50); }
  throw new Error(`Timed out waiting for ${description}`);
}
async function clickHistoryRefresh(page) {
  const clicked = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('button, [role="button"]')];
    const button = nodes.find(node => !node.disabled && /이력.*조회|이력.*새로|실시간.*조회|다시.*조회|새로.*고침/.test((node.textContent || '').replace(/\s+/g, ' ')));
    if (!button) return false;
    button.click();
    return true;
  });
  if (!clicked) throw new Error('live-history refresh button was not found');
}
async function visibleText(page) {
  return page.$eval('body', node => String(node.innerText || '').replace(/\s+/g, ' ').trim());
}

(async () => {
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    let rejectEarlyPageError;
    const earlyPageError = new Promise((_, reject) => { rejectEarlyPageError = reject; });
    const runtimeClient = await page.target().createCDPSession();
    await runtimeClient.send('Runtime.enable');
    runtimeClient.on('Runtime.exceptionThrown', event => {
      const details = event.exceptionDetails || {};
      const exception = details.exception || {};
      const description = exception.description || details.text || 'Runtime exception';
      const stack = exception.stackTrace?.callFrames?.map(frame => `    at ${frame.functionName || '<anonymous>'} (${frame.url || 'unknown'}:${frame.lineNumber + 1}:${frame.columnNumber + 1})`).join('\n') || '';
      problems.push(`runtime-exception: ${description}${stack ? `\n${stack}` : ''}`);
    });
    page.on('pageerror', error => {
      problems.push(`pageerror: ${error.stack || error.message}`);
      rejectEarlyPageError(error);
    });
    page.on('console', async message => {
      if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
        const location = message.location?.() || {};
        const argumentStacks = await Promise.all(message.args().map(async argument => {
          try {
            const value = await argument.evaluate(value => value && (value.stack || value.message || (typeof value === 'string' ? value : null)));
            return typeof value === 'string' ? value : null;
          } catch { return null; }
        }));
        const stacks = argumentStacks.filter(Boolean);
        problems.push(`console: ${message.text()} @ ${location.url || 'unknown'}:${location.lineNumber ?? '?'}:${location.columnNumber ?? '?'}${stacks.length ? `\n${stacks.join('\n')}` : ''}`);
      }
    });
    await page.evaluateOnNewDocument(() => localStorage.setItem('nenovaUser', JSON.stringify({ userId: 'live-history-smoke', userName: 'live-history-smoke', role: 'admin' })));
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
        if (String(payload.year) !== year || String(payload.week) !== week || payload.from !== from || payload.to !== to || !Array.isArray(payload.messages)) {
          return json(request, { error: { code: 'BAD_FIXTURE_SCOPE', message: 'year/week/from/to/messages contract mismatch' } }, 400);
        }
        if (failHistory) return json(request, { error: { code: 'LIVE_HISTORY_READ_FAILED', message: 'fixture history read failure' } }, 503);
        return json(request, { success: true, advisoryOnly: true, erpAction: 'NONE', scope: { year, weeks: [week], from, to }, asOf: '2026-09-11T02:00:00.000Z', items: responseItems, warnings: ['fixture: 조회 범위가 제한될 수 있습니다.'] });
      }
      if (method !== 'GET') return json(request, { error: { code: 'FIXTURE_WRITE_BLOCKED', message: `fixture blocks ${method} ${parsed.pathname}` } }, 405);
      if (parsed.pathname === '/api/auth/me') return json(request, { success: true, user: { userId: 'live-history-smoke', userName: 'live-history-smoke', role: 'admin' } });
      if (parsed.pathname === '/api/kakao/sales-feed') return json(request, { ok: true, messages, hasMore: false, nextAfterKey: null });
      if (parsed.pathname === '/api/orders/mappings') return json(request, { success: true, mappings: {} });
      if (parsed.pathname === '/api/master') return json(request, { success: true, data: [] });
      if (parsed.pathname === '/api/orders/prod-units') return json(request, { success: true, units: {} });
      if (parsed.pathname === '/api/orders/weeks') return json(request, { success: true, weeks: [`${year}-${week}`] });
      if (parsed.pathname === '/api/favorites') return json(request, { success: true, favorites: [] });
      if (parsed.pathname === '/api/orders/paste-history') return json(request, { success: true, operations: [], hasMore: false, nextCursor: null });
      if (parsed.pathname === '/api/orders/history') return json(request, { success: true, history: [], page: Number(parsed.searchParams.get('page') || 1), hasMore: false, orderYear: parsed.searchParams.get('year') || year });
      if (parsed.pathname === '/api/orders/distribution-change-audits') return json(request, { items: [], advisoryOnly: true, erpAction: 'NONE', limit: 20, asOf: '2026-09-11T00:00:00.000Z' });
      if (parsed.pathname === '/api/erp/edit-presence') return json(request, { success: true, stale: false, digest: 'live-history-smoke', lease: { active: false } });
      if (parsed.pathname === '/api/orders') return json(request, { success: true, orders: [] });
      if (parsed.pathname === '/api/orders/distribution-baselines') return json(request, { items: [] });
      if (parsed.pathname === '/api/ping') return json(request, { success: true });
      return json(request, { success: true, data: [], rows: [], items: [], applications: [], mappings: {}, favorites: [], hasMore: false, nextCursor: null });
    });

    await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitFor(async () => (await page.$$('section.sales-inbox input[type="date"]')).length >= 2, 'inbox period controls');
    await page.$$eval('section.sales-inbox input[type="date"]', (nodes, values) => nodes.slice(0, 2).forEach((node, index) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(node, values[index]);
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }), [from, to]);
    await waitFor(async () => await page.evaluate(targetWeek => [...document.querySelectorAll('button')].some(node => (node.textContent || '').includes(targetWeek)), week), 'selected-week control');
    await page.evaluate(targetWeek => [...document.querySelectorAll('button')].find(node => (node.textContent || '').includes(targetWeek))?.click(), week);
    await page.evaluate(() => [...document.querySelectorAll('button')].find(node => (node.textContent || '').trim() === '영업방 불러오기')?.click());
    await Promise.race([
      page.waitForSelector('section.sales-inbox article.message', { visible: true, timeout: 30000 }),
      earlyPageError,
    ]);
    await waitFor(() => liveHistoryPosts > 0, 'initial live-history POST');
    await waitFor(async () => (await visibleText(page)).includes('서울꽃') && (await visibleText(page)).includes('부산농원'), 'paired history text');

    const orderCheck = await page.$$eval('section.sales-inbox article.message', nodes => nodes.map(node => String(node.textContent || '').replace(/\s+/g, ' ').trim()));
    if (orderCheck.length < 2 || !/부산농원/.test(orderCheck[0]) || !/서울꽃/.test(orderCheck[1])) problems.push(`messages are not newest-first: ${JSON.stringify(orderCheck.slice(0, 2))}`);
    if (orderCheck.some(text => /서울꽃/.test(text) && /부산농원/.test(text))) problems.push('history content crossed between the two raw-message cards');
    const returnedHistoryValues = await page.$$eval('section.sales-inbox article.message', nodes => nodes.map(node => String(node.textContent || '').replace(/\s+/g, ' ').trim()));
    const newestHistory = returnedHistoryValues.find(text => text.includes('부산농원')) || '';
    const oldestHistory = returnedHistoryValues.find(text => text.includes('서울꽃')) || '';
    if (!newestHistory.includes('ORDER_ONLY') && !newestHistory.includes('주문 이력 확인')) problems.push('newest message does not render ORDER_ONLY history status');
    if (!newestHistory.includes('0 → 2') || !newestHistory.includes('37-01') || !newestHistory.includes('장미 레드') || !newestHistory.includes('분배·출고 이력가 없습니다.')) problems.push(`newest message history values are incomplete: ${newestHistory}`);
    if (!oldestHistory.includes('주문·분배 이력 확인') || !oldestHistory.includes('0 → 1') || !oldestHistory.includes('37-01') || !oldestHistory.includes('수국 화이트') || !oldestHistory.includes('2026-09-11')) problems.push(`oldest message history values are incomplete: ${oldestHistory}`);
    const initialLivePost = apiRequests.find(request => request.path === '/api/orders/distribution-live-history' && request.method === 'POST');
    if (!initialLivePost?.body.messages?.every(message => typeof message.identity === 'string' && message.identity.length > 0)) problems.push('live-history POST did not preserve raw message identities');
    if (!initialLivePost?.body.messages?.some(message => message.identity === firstIdentity) || !initialLivePost?.body.messages?.some(message => message.identity === secondIdentity)) problems.push('live-history POST omitted one raw message');

    const textarea = await page.$('section.sales-inbox textarea, textarea[aria-label*="원문"], textarea');
    if (!textarea) problems.push('raw-message textarea is not visible');
    else {
      await textarea.focus();
      await page.keyboard.type(' 보존할 초안');
      const beforeRefresh = await page.$eval('textarea', node => node.value);
      await clickHistoryRefresh(page);
      await waitFor(() => liveHistoryPosts >= 2, 'explicit live-history refresh');
      const afterRefresh = await page.$eval('textarea', node => node.value);
      if (afterRefresh !== beforeRefresh) problems.push('textarea draft was lost after live-history refresh');
    }

    failHistory = true;
    const postsBeforeFailure = liveHistoryPosts;
    await clickHistoryRefresh(page);
    await waitFor(() => liveHistoryPosts > postsBeforeFailure, 'failed live-history refresh');
    await waitFor(async () => /실패|조회하지 못|유지|다시|fixture history read failure/.test(await visibleText(page)), 'live-history failure notice');
    const afterFailure = await visibleText(page);
    if (!afterFailure.includes('서울꽃') || !afterFailure.includes('부산농원')) problems.push('failed live-history refresh cleared the last good result');
    if (!afterFailure.includes('fixture: 조회 범위가 제한될 수 있습니다.')) problems.push('live-history warnings are not visible');

    const layout = await page.$eval('section.sales-inbox', element => {
      const rect = element.getBoundingClientRect();
      const boxes = [...element.querySelectorAll('button, input, textarea')].map(node => { const box = node.getBoundingClientRect(); return { visible: box.width > 0 && box.height > 0, left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom) }; });
      const pairs = [...element.querySelectorAll('article.message .message-pair')].map(pair => {
        const box = pair.getBoundingClientRect();
        const raw = pair.querySelector('.message-raw')?.getBoundingClientRect();
        const history = pair.querySelector('.live-history-panel')?.getBoundingClientRect();
        const historyNode = pair.querySelector('.live-history-panel');
        const orderEvent = pair.querySelector('.live-event-order');
        const shipmentEvent = pair.querySelector('.live-event-shipment');
        return { pair: { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom), width: Math.round(box.width), height: Math.round(box.height) }, raw: raw && { left: Math.round(raw.left), right: Math.round(raw.right), width: Math.round(raw.width) }, history: history && { left: Math.round(history.left), right: Math.round(history.right), width: Math.round(history.width), background: historyNode ? getComputedStyle(historyNode).backgroundColor : '' }, eventBackgrounds: { order: orderEvent ? getComputedStyle(orderEvent).backgroundColor : '', shipment: shipmentEvent ? getComputedStyle(shipmentEvent).backgroundColor : '' } };
      });
      return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), documentOverflow: document.documentElement.scrollWidth > window.innerWidth, controls: boxes, pairs };
    });
    if (layout.documentOverflow) problems.push('1920x1080 live-history UI causes document-level horizontal overflow');
    if (layout.controls.some(box => !box.visible || box.left < 0 || box.right > 1920 || box.top < 0 || box.bottom > 1080)) problems.push(`live-history input/button is outside the viewport: ${JSON.stringify(layout.controls)}`);
    if (layout.pairs.length !== 2 || layout.pairs.some(pair => pair.pair.width <= 0 || pair.pair.height <= 0 || !pair.raw || !pair.history || pair.raw.width <= 0 || pair.history.width <= 0 || pair.raw.left < 0 || pair.history.right > 1920)) problems.push(`per-message raw/history pair bounding boxes are invalid: ${JSON.stringify(layout.pairs)}`);
    if (layout.pairs.some(pair => pair.history.background === 'rgba(0, 0, 0, 0)' || pair.history.background === 'transparent' || pair.history.background !== 'rgb(248, 251, 253)' || pair.eventBackgrounds.order !== 'rgb(238, 245, 255)' || pair.eventBackgrounds.shipment !== 'rgb(239, 248, 241)')) problems.push(`live-history computed backgrounds are wrong or transparent: ${JSON.stringify(layout.pairs)}`);
    if (layout.right > 1920 || layout.left < 0) problems.push(`sales inbox bounds are outside 1920 viewport: ${JSON.stringify(layout)}`);

    const forbiddenPosts = apiRequests.filter(request => request.method !== 'GET' && request.path !== '/api/orders/distribution-live-history');
    const erpOrLlmPosts = forbiddenPosts.filter(request => /erp|orders$|shipment|llm|ai|openai/i.test(request.path));
    if (forbiddenPosts.length) problems.push(`unexpected non-live-history POSTs: ${forbiddenPosts.map(request => `${request.method} ${request.path}`).join(', ')}`);
    if (erpOrLlmPosts.length) problems.push(`ERP/LLM POSTs observed: ${erpOrLlmPosts.map(request => `${request.method} ${request.path}`).join(', ')}`);
    if (blockedExternal.length) problems.push(`blocked external requests: ${blockedExternal.join(', ')}`);

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(JSON.stringify({ viewport: '1920x1080', target: targetUrl.href, liveHistoryPosts, newestFirst: /부산농원/.test(orderCheck[0] || '') && /서울꽃/.test(orderCheck[1] || ''), layout, forbiddenPosts, blockedExternal, screenshotPath, problems }, null, 2));
    if (problems.length) process.exitCode = 1;
  } catch (error) {
    const failedPage = (await browser.pages()).at(-1);
    if (failedPage) { fs.mkdirSync(path.dirname(screenshotPath), { recursive: true }); await failedPage.screenshot({ path: screenshotPath.replace(/\.png$/i, '-failure.png'), fullPage: false }).catch(() => {}); }
    console.error(JSON.stringify({
      failure: error.stack || error.message,
      pageUrl: failedPage?.url() || null,
      problems,
      relevantApiUrls: apiRequests.filter(request => request.path !== '/api/auth/me').map(request => `${request.method} ${request.path}${Object.keys(request.query || {}).length ? `?${new URLSearchParams(request.query).toString()}` : ''}`),
      pageText: await failedPage?.evaluate(() => document.body?.innerText || '').catch(() => '') || '',
      screenshotPath: screenshotPath.replace(/\.png$/i, '-failure.png'),
    }, null, 2));
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });

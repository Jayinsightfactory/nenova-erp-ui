// Local-only 1920x1080 smoke for the read-only paired Kakao message/application UI.
// Every network request is intercepted; advisory live-history and zero-cost preanalysis fixtures are local only.
// Usage: NODE_PATH=... node scripts/paste-live-history-ui-smoke.cjs [localhost URL]
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');

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
const jwtSecret = process.env.JWT_SECRET || 'nenova-dev-only-secret-change-me';

const year = '2026';
const week = '37-01';
const from = '2026-09-29';
const to = '2026-10-05';
const firstIdentity = 'kakao-sales|live-history-smoke|message-001';
const secondIdentity = 'kakao-sales|live-history-smoke|message-002';
const quantityIdentity = 'kakao-sales|live-history-smoke|message-003';
const fullSqlIdentity = 'kakao-sales|live-history-smoke|message-004';
const messages = [
  {
    source: 'kakao-sales', chat_id: 'live-history-smoke', external_message_id: 'message-001',
    chatroom: '영업방 smoke', sender: '담당자 A', created_at: '2026-10-01T09:00:00+09:00',
    message: '37-1 변경사항\n서울꽃\n수국 화이트 1박스 추가\n장미 레드 2박스 추가',
  },
  {
    source: 'kakao-sales', chat_id: 'live-history-smoke', external_message_id: 'message-002',
    chatroom: '영업방 smoke', sender: '담당자 B', created_at: '2026-10-02T10:00:00+09:00',
    message: '37-1 변경사항\n부산농원\n장미 레드 2박스 추가',
  },
  {
    source: 'kakao-sales', chat_id: 'live-history-smoke', external_message_id: 'message-003',
    chatroom: '영업방 smoke', sender: '담당자 C', created_at: '2026-10-03T10:00:00+09:00',
    message: '37-1 변경사항\n양재동\n수국 Blue 1박스 취소',
  },
  {
    source: 'kakao-sales', chat_id: 'live-history-smoke', external_message_id: 'message-004',
    chatroom: '영업방 smoke', sender: '담당자 D', created_at: '2026-10-04T10:00:00+09:00',
    message: '37-1 변경사항\n대전꽃집\n튤립 옐로 3박스 추가',
  },
];
const responseItems = [
  {
    sourceIdentity: firstIdentity, status: 'ORDER_AND_DISTRIBUTION', reason: '동일 원문 이후 주문·분배 이력 모두 확인',
    requests: [
      { id: `${firstIdentity}:3`, sourceIdentity:firstIdentity, action:'ADD', custKey:501, prodKey:101, quote: '수국 화이트 1박스 추가', customerText: '서울꽃', productText: '수국 화이트', qty: 1, unit: '박스', status: 'ORDER_AND_DISTRIBUTION', reason: '주문과 분배가 같은 요청에 대응',
      orderEvents: [{ eventId: 'order-001', before: 0, after: 1, unit: '박스', changeAt: '2026-10-01T10:00:00+09:00', shipmentDate: null, week: '37-01', custName: '서울꽃', prodName: '수국 화이트' }],
      shipmentEvents: [{ eventId: 'ship-001', before: 0, after: 1, unit: '박스', changeAt: '2026-10-01T10:30:00+09:00', shipmentDate: '2026-10-01', week: '37-01', custName: '서울꽃', prodName: '수국 화이트' }],
      },
      { id: `${firstIdentity}:4`, sourceIdentity:firstIdentity, action:'ADD', custKey:501, prodKey:102, quote: '장미 레드 2박스 추가', customerText: '서울꽃', productText: '장미 레드', qty: 2, unit: '박스', status: 'NO_LIVE_EVIDENCE', reason: '분배 이력 미확인', orderEvents:[], shipmentEvents:[] },
    ],
  },
  {
    sourceIdentity: secondIdentity, status: 'ORDER_ONLY', reason: '주문 이력만 확인',
    requests: [{ id: `${secondIdentity}:3`, sourceIdentity:secondIdentity, action:'ADD', custKey:601, prodKey:201, quote: '장미 레드 2박스 추가', customerText: '부산농원', productText: '장미 레드', qty: 2, unit: '박스', status: 'ORDER_ONLY', reason: '분배 이력 미확인',
      orderEvents: [{ eventId: 'order-002', before: 0, after: 2, unit: '박스', changeAt: '2026-10-02T11:00:00+09:00', shipmentDate: null, week: '37-01', custName: '부산농원', prodName: '장미 레드' }],
      shipmentEvents: [],
    }],
  },
  {
    sourceIdentity: quantityIdentity, status: 'DISTRIBUTION_EVIDENCE', reason: '동일 수량변동 후보',
    requests: [{ id: `${quantityIdentity}:3`, sourceIdentity:quantityIdentity, action:'CANCEL', custKey:701, prodKey:301, quote:'수국 Blue 1박스 취소', customerText:'양재동', productText:'수국 Blue', inputQty:1, inputUnit:'박스', qty:1, unit:'박스', status:'PRODUCT_HISTORY_CANDIDATE', matchState:'NUMERIC_HISTORY_CANDIDATE', shipmentEvents:[{eventId:'ship-003',before:5,after:4,unit:'박스',changeAt:'2026-10-03T11:00:00+09:00',shipmentDate:'2026-10-03',week:'37-01'}] }],
  },
  {
    sourceIdentity: fullSqlIdentity, status: 'ORDER_AND_DISTRIBUTION', reason: '원문 이후 동일 차수 품목 SQL 이력 확인',
    requests: [{ id:`${fullSqlIdentity}:3`, sourceIdentity:fullSqlIdentity, action:'ADD', custKey:801, prodKey:401, quote:'튤립 옐로 3박스 추가', customerText:'대전꽃집', productText:'튤립 옐로', inputQty:3, inputUnit:'박스', qty:3, unit:'박스', status:'ORDER_AND_DISTRIBUTION', reason:'요청 ID와 SQL 변화량이 일치', shipmentEvents:[{eventId:'ship-004',before:0,after:3,unit:'박스',changeAt:'2026-10-04T11:00:00+09:00',shipmentDate:'2026-10-04',week:'37-01'}] }],
  },
];
const sourceTimes = new Map([[firstIdentity,messages[0].created_at],[secondIdentity,messages[1].created_at],[quantityIdentity,messages[2].created_at],[fullSqlIdentity,messages[3].created_at]]);
responseItems.forEach(item => { item.requests = item.requests.map(request => ({ ...request, year, week, sourceAt:sourceTimes.get(item.sourceIdentity), timestamp_approximate:false, ...(request.shipmentEvents?.length ? {shipmentEvents:request.shipmentEvents.map(event=>({...event,year,custKey:request.custKey,prodKey:request.prodKey}))} : {}) })); });
const balanceComparison = { version:1, defaultFilter:'EXCEPTIONS', summary:{productCount:3,visibleCount:0,consistentHiddenCount:3,unresolvedRequestCount:0}, products:[
  {prodKey:101,prodName:'수국 화이트',unit:'박스',evidenceStatus:'CONSISTENT',snapshotStatus:'AVAILABLE',sourceIdentities:[firstIdentity],requestedSignedDelta:1,observedSignedDelta:1,actualDistributionTotal:1,storedStockSnapshot:0,requests:[{requestId:`${firstIdentity}:3`,sourceIdentity:firstIdentity,custKey:501,prodKey:101,requestedSignedDelta:1,observedSignedDelta:1,evidenceStatus:'CONSISTENT',reasonCodes:[]}]},
  {prodKey:301,prodName:'수국 Blue',unit:'박스',evidenceStatus:'CONSISTENT',snapshotStatus:'AVAILABLE',sourceIdentities:[quantityIdentity],requestedSignedDelta:-1,observedSignedDelta:-1,actualDistributionTotal:4,storedStockSnapshot:0,requests:[{requestId:`${quantityIdentity}:3`,sourceIdentity:quantityIdentity,custKey:701,prodKey:301,requestedSignedDelta:-1,observedSignedDelta:-1,evidenceStatus:'CONSISTENT',reasonCodes:[]}]},
  {prodKey:401,prodName:'튤립 옐로',unit:'박스',evidenceStatus:'CONSISTENT',snapshotStatus:'AVAILABLE',sourceIdentities:[fullSqlIdentity],requestedSignedDelta:3,observedSignedDelta:3,actualDistributionTotal:3,storedStockSnapshot:0,requests:[{requestId:`${fullSqlIdentity}:3`,sourceIdentity:fullSqlIdentity,custKey:801,prodKey:401,requestedSignedDelta:3,observedSignedDelta:3,evidenceStatus:'CONSISTENT',reasonCodes:[]}]},
]};
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
    const button = document.querySelector('button[data-live-history-refresh]');
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
    await page.setCookie({ name: 'nenovaToken', value: jwt.sign({ userId: 'live-history-smoke', userName: 'live-history-smoke', authority: 'admin' }, jwtSecret, { expiresIn: '10m' }), url: targetUrl.origin, httpOnly: true, sameSite: 'Strict' });
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
      if (message.type() === 'error' && !/Failed to load resource|WebSocket connection to .*\/_next\/hmr.*failed/.test(message.text())) {
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
        if (String(payload.year) !== year || !/^\d{2}-\d{2}$/.test(String(payload.week)) || payload.from !== from || payload.to !== to || !Array.isArray(payload.messages)) {
          return json(request, { error: { code: 'BAD_FIXTURE_SCOPE', message: `year/week/from/to/messages contract mismatch: ${JSON.stringify({year:payload.year,week:payload.week,from:payload.from,to:payload.to,messageCount:Array.isArray(payload.messages)?payload.messages.length:null})}` } }, 400);
        }
        if (failHistory) return json(request, { error: { code: 'LIVE_HISTORY_READ_FAILED', message: 'fixture history read failure' } }, 503);
        const requestedWeek = String(payload.week);
        const scopedItems = payload.messages.map(message => responseItems.find(item=>item.sourceIdentity===message.identity) || {sourceIdentity:message.identity,status:'UNCONFIRMED',reason:'fixture',requests:[]});
        return json(request, { success: true, advisoryOnly: true, erpAction: 'NONE', scope: { year, weeks: [requestedWeek], from, to }, asOf: '2026-10-05T05:00:00.000Z', items: scopedItems, balanceComparison, warnings: ['fixture: 조회 범위가 제한될 수 있습니다.'] });
      }
      // The page may auto-request preanalysis. Answer locally so this UI smoke never calls an LLM.
      if (parsed.pathname === '/api/orders/paste-preanalysis' && method === 'POST') {
        if(payload.lookupOnly===true)return json(request,{success:true,analysisStorage:{cacheMiss:true}});
        return json(request, { success:false, error:'local smoke disables model analysis' }, 503);
      }
      if (method !== 'GET') return json(request, { error: { code: 'FIXTURE_WRITE_BLOCKED', message: `fixture blocks ${method} ${parsed.pathname}` } }, 405);
      if (parsed.pathname === '/api/auth/me') return json(request, { success: true, user: { userId: 'live-history-smoke', userName: 'live-history-smoke', role: 'admin' } });
      if (parsed.pathname === '/api/kakao/sales-feed') return json(request, { ok: true, messages, hasMore: false, nextAfterKey: null });
      if (parsed.pathname === '/api/orders/mappings') return json(request, { success: true, mappings: {} });
      if (parsed.pathname === '/api/master') return json(request, { success: true, data: [] });
      if (parsed.pathname === '/api/orders/distribution-manual-applications') return json(request, { applications: [{year,week,sourceIdentity:fullSqlIdentity,eventId:'a'.repeat(64),status:'MANUALLY_NOT_APPLIED',createdAt:'2026-10-04T10:45:00+09:00',memo:'SQL 근거보다 먼저 한 수동 미처리',advisoryOnly:true,erpAction:'NONE'}], advisoryOnly:true, erpAction:'NONE' });
      if (parsed.pathname === '/api/orders/prod-units') return json(request, { success: true, units: {} });
      if (parsed.pathname === '/api/orders/weeks') return json(request, { success: true, weeks: [`${year}-${week}`] });
      if (parsed.pathname === '/api/favorites') return json(request, { success: true, favorites: [] });
      if (parsed.pathname === '/api/orders/paste-history') return json(request, { success: true, operations: [], hasMore: false, nextCursor: null });
      if (parsed.pathname === '/api/orders/history') return json(request, { success: true, history: [], page: Number(parsed.searchParams.get('page') || 1), hasMore: false, orderYear: parsed.searchParams.get('year') || year });
      if (parsed.pathname === '/api/orders/distribution-change-audits') return json(request, { items: [], advisoryOnly: true, erpAction: 'NONE', limit: 20, asOf: '2026-09-23T00:00:00.000Z' });
      if (parsed.pathname === '/api/erp/edit-presence') return json(request, { success: true, stale: false, digest: 'live-history-smoke', lease: { active: false } });
      if (parsed.pathname === '/api/orders') return json(request, { success: true, orders: [] });
      if (parsed.pathname === '/api/orders/distribution-baselines') return json(request, { items: [] });
      if (parsed.pathname === '/api/ping') return json(request, { success: true });
      return json(request, { success: true, data: [], rows: [], items: [], applications: [], mappings: {}, favorites: [], hasMore: false, nextCursor: null });
    });

    await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitFor(async () => (await page.$$('section.sales-inbox input[type="date"]')).length >= 2, 'inbox period controls');
    const expandInboxTools=async()=>{
      const toolSummary=await page.$('section.sales-inbox details.inbox-tools > summary');
      if(!toolSummary)throw new Error('inbox tools disclosure was not found');
      const isOpen=await page.$eval('section.sales-inbox details.inbox-tools',node=>node.open);
      if(!isOpen){await toolSummary.focus();await page.keyboard.press('Space');}
      await waitFor(async()=>await page.$eval('section.sales-inbox details.inbox-tools',node=>node.open&&/접기/.test(node.querySelector('summary')?.innerText||'')),'inbox tools expanded and state applied');
    };
    await expandInboxTools();
    await waitFor(async () => await page.evaluate(targetWeek => [...document.querySelectorAll('button')].some(node => (node.textContent || '').includes(targetWeek)), week), 'selected-week control');
    await page.evaluate(targetWeek => [...document.querySelectorAll('button')].find(node => (node.textContent || '').includes(targetWeek))?.click(), week);
    await expandInboxTools();
    const dateHandles=await page.$$('section.sales-inbox input[type="date"]');
    if(dateHandles.length<2)throw new Error('inbox period controls disappeared after selecting the week');
    for(const [index,value] of [from,to].entries()) await dateHandles[index].evaluate((input,nextValue)=>{
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(input,nextValue);
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    },value);
    try { await waitFor(async () => (await page.$eval('[data-testid="sales-inbox-period"]', node => node.innerText)).includes(`${from} ~ ${to}`), `selected date period ${from} to ${to}`); }
    catch(error) { throw new Error(`${error.message}; requested=${from}..${to}; controls=${JSON.stringify(await page.$eval('section.sales-inbox',node=>[...node.querySelectorAll('input[type="date"]')].map(input=>({value:input.value,label:input.closest('label')?.innerText||''}))))}`); }
    await page.evaluate(() => [...document.querySelectorAll('button')].find(node => (node.textContent || '').trim() === '영업방 불러오기')?.click());
    await Promise.race([
      page.waitForSelector('section.sales-inbox article.message', { visible: true, timeout: 30000 }),
      earlyPageError,
    ]);
    await waitFor(() => liveHistoryPosts > 0, 'initial live-history POST');
    await waitFor(async () => (await visibleText(page)).includes('서울꽃') && (await visibleText(page)).includes('부산농원'), 'paired history text');

    await waitFor(async()=>await page.$eval('button[data-live-history-refresh]',node=>!node.disabled),'live-history refresh button enabled');
    const keyboardRefreshPrepared=await page.evaluate(()=>{
      const button=document.querySelector('button[data-live-history-refresh]');
      if(!button)return false;
      button.dataset.smokeKeyboardTarget='history-refresh';button.focus();return document.activeElement===button;
    });
    if(!keyboardRefreshPrepared) problems.push('keyboard smoke could not focus the live-history refresh button');
    else {
      await page.keyboard.press('Tab');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      const focusReturned=await page.$eval('[data-smoke-keyboard-target="history-refresh"]',node=>document.activeElement===node);
      if(!focusReturned)problems.push('Tab then Shift+Tab did not restore the live-history refresh button');
      const focusStyle=await page.$eval('[data-smoke-keyboard-target="history-refresh"]',node=>({outline:getComputedStyle(node).outlineStyle,width:getComputedStyle(node).outlineWidth,shadow:getComputedStyle(node).boxShadow}));
      if(focusStyle.outline==='none'&&focusStyle.width==='0px'&&focusStyle.shadow==='none')problems.push(`focused live-history refresh button has no visible focus indicator: ${JSON.stringify(focusStyle)}`);
      const beforeKeyboardRefresh=liveHistoryPosts;
      await page.keyboard.press('Enter');
      await waitFor(()=>liveHistoryPosts>beforeKeyboardRefresh,'keyboard Enter live-history refresh');
    }
    const keyboardDisclosure=await page.$('section.sales-inbox article.message .compact-source-evidence summary');
    if(!keyboardDisclosure)problems.push('keyboard Space smoke could not find a source-evidence disclosure');
    else {
      await keyboardDisclosure.focus();
      await page.keyboard.press('Space');
      const opened=await keyboardDisclosure.evaluate(node=>node.parentElement.open);
      await page.keyboard.press('Space');
      const closed=await keyboardDisclosure.evaluate(node=>!node.parentElement.open);
      if(!opened||!closed)problems.push(`Space did not toggle the live-history disclosure: opened=${opened}, closed=${closed}`);
    }

    const originalViewports = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const responsiveLayouts = [];
    for (const viewport of [{ width: 1366, height: 768 }, { width: 1100, height: 768 }]) {
      await page.setViewport(viewport);
      await wait(200);
    const result = await page.$eval('section.sales-inbox', element => {
        const box = element.getBoundingClientRect();
        const pair = element.querySelector('.paired-message-layout');
        const raw = pair?.querySelector('.paired-message-original')?.getBoundingClientRect();
        const applied = pair?.querySelector('.paired-applied-items')?.getBoundingClientRect();
        const list = element.querySelector('.list')?.getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, documentOverflow: document.documentElement.scrollWidth > innerWidth, inbox: { left: box.left, right: box.right, top: box.top, bottom: box.bottom }, raw: raw && { left: raw.left, right: raw.right, top:raw.top }, applied: applied && { left: applied.left, right: applied.right, top:applied.top }, list: list && { top: list.top, bottom: list.bottom } };
      });
      responsiveLayouts.push(result);
      if (result.documentOverflow || result.inbox.left < 0 || result.inbox.right > viewport.width) problems.push(`inbox overflows at ${viewport.width}x${viewport.height}: ${JSON.stringify(result)}`);
      if (!result.raw || !result.applied || result.raw.left < 0 || result.applied.right > viewport.width || (viewport.width > 1100 && result.raw.right > result.applied.left) || (viewport.width <= 1100 && result.applied.top < result.raw.top + 20)) problems.push(`paired layout is overlapped or off-screen at ${viewport.width}x${viewport.height}: ${JSON.stringify(result)}`);
      if (!result.list || result.list.bottom > result.inbox.bottom + 1) problems.push(`inbox list escapes its panel at ${viewport.width}x${viewport.height}: ${JSON.stringify(result)}`);
    }
    await page.setViewport(originalViewports);

    const orderCheck = await page.$$eval('section.sales-inbox article.message', nodes => nodes.map(node => String(node.textContent || '').replace(/\s+/g, ' ').trim()));
    if (orderCheck.length < 4 || !/대전꽃집/.test(orderCheck[0]) || !/양재동/.test(orderCheck[1]) || !/부산농원/.test(orderCheck[2]) || !/서울꽃/.test(orderCheck[3])) problems.push(`messages are not newest-first: ${JSON.stringify(orderCheck.slice(0, 4))}`);
    if (orderCheck.some(text => /서울꽃/.test(text) && /부산농원/.test(text))) problems.push('history content crossed between the two raw-message cards');
    const messageCards = await page.$$eval('section.sales-inbox article.message', nodes => nodes.map(node => ({ identity:node.dataset.testid||'', raw:node.querySelector('[data-testid="complete-kakao-message"]')?.innerText||'', items:[...node.querySelectorAll('.paired-applied-item')].map(item=>({text:String(item.innerText||'').replace(/\s+/g,' ').trim(),status:item.querySelector('b')?.innerText||'',requestId:item.dataset.requestId||'',background:getComputedStyle(item).backgroundColor})) })));
    const newestHistory = messageCards.find(item => item.identity.includes('message-002'));
    const oldestHistory = messageCards.find(item => item.identity.includes('message-001'));
    const quantityHistory = messageCards.find(item => item.identity.includes('message-003'));
    const fullSqlHistory = messageCards.find(item => item.identity.includes('message-004'));
    if (messageCards.length !== 4 || !newestHistory || !oldestHistory || !quantityHistory || !fullSqlHistory) problems.push(`all complete message cards are not present: ${JSON.stringify(messageCards)}`);
    if (!oldestHistory?.raw.includes('서울꽃') || !oldestHistory?.raw.includes('수국 화이트 1박스 추가') || !oldestHistory?.raw.includes('장미 레드 2박스 추가')) problems.push(`left side does not show the full Kakao message: ${JSON.stringify(oldestHistory)}`);
    if (oldestHistory?.items.length !== 2 || !oldestHistory.items.some(item=>item.text.includes('수국 화이트')&&item.status==='전산확인'&&item.requestId.endsWith(':3')) || !oldestHistory.items.some(item=>item.text.includes('장미 레드')&&item.status==='미확인'&&item.requestId.endsWith(':4'))) problems.push(`exact SQL evidence did not confirm only its matching item: ${JSON.stringify(oldestHistory?.items)}`);
    if (!newestHistory?.raw.includes('부산농원') || !newestHistory?.raw.includes('장미 레드 2박스 추가') || newestHistory?.items.length!==1 || newestHistory.items[0].status!=='미확인') problems.push(`newest full message/unconfirmed item is incomplete: ${JSON.stringify(newestHistory)}`);
    if (!quantityHistory?.items.some(item=>item.status==='수량확인'&&item.requestId.endsWith(':3')) || !quantityHistory?.raw.includes('수국 Blue 1박스 취소')) problems.push(`exact quantity history was not auto-confirmed: ${JSON.stringify(quantityHistory)}`);
    if (!fullSqlHistory?.raw.includes('튤립 옐로 3박스 추가') || fullSqlHistory?.items.length!==1 || fullSqlHistory.items[0].status!=='전산확인') problems.push(`full SQL history message is not confirmed by its exact request: ${JSON.stringify(fullSqlHistory)}`);
    const quantityCardClass=await page.$eval(`[data-testid="compact-match-row:${quantityIdentity}"]`,node=>node.className);
    const quantityConfirmText=await page.$eval(`[data-testid="compact-match-row:${quantityIdentity}"] .source-confirm-toggle`,node=>node.textContent.trim());
    if (!quantityCardClass.includes('history-completed')||quantityConfirmText!=='확인취소') problems.push(`full quantity coverage did not auto-confirm/highlight the source: ${quantityCardClass} / ${quantityConfirmText}`);
    const partialSqlClass=await page.$eval(`[data-testid="compact-match-row:${firstIdentity}"]`,node=>node.className);
    if (partialSqlClass.includes('history-completed')) problems.push(`partial SQL coverage incorrectly confirmed the full raw message: ${partialSqlClass}`);
    const fullSqlClass=await page.$eval(`[data-testid="compact-match-row:${fullSqlIdentity}"]`,node=>node.className);
    const fullSqlConfirmText=await page.$eval(`[data-testid="compact-match-row:${fullSqlIdentity}"] .source-confirm-toggle`,node=>node.textContent.trim());
    if (!fullSqlClass.includes('history-completed') || fullSqlConfirmText!=='확인취소') problems.push(`complete exact SQL coverage did not auto-confirm the source: ${fullSqlClass} / ${fullSqlConfirmText}`);
    if (oldestHistory?.items.find(item=>item.status==='전산확인')?.background!=='rgb(237, 248, 239)' || oldestHistory?.items.find(item=>item.status==='미확인')?.background!=='rgb(255, 248, 232)') problems.push(`SQL-confirmed and unconfirmed item colors are wrong: ${JSON.stringify(oldestHistory?.items)}`);
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
    const warningDetails = await page.$('section.sales-inbox details.compact-warnings');
    if (warningDetails) await warningDetails.evaluate(node => { node.open = true; });
    else problems.push('compact live-history warning disclosure is not present');
    const afterFailure = await visibleText(page);
    if (!afterFailure.includes('서울꽃') || !afterFailure.includes('부산농원')) problems.push('failed live-history refresh cleared the last good result');
    if (!afterFailure.includes('fixture: 조회 범위가 제한될 수 있습니다.')) problems.push('live-history warnings are not visible');

    const layout = await page.$eval('section.sales-inbox', element => {
      const rect = element.getBoundingClientRect();
      const boxes = [...element.querySelectorAll('.inbox-controls button, .inbox-controls input, article.message:first-of-type .source-confirm-toggle')].map(node => { const box = node.getBoundingClientRect(); return { visible: box.width > 0 && box.height > 0, left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom) }; });
      const pairs = [...element.querySelectorAll('article.message .paired-message-layout')].map(pair => {
        const box = pair.getBoundingClientRect();
        const rawNode=pair.querySelector('.paired-message-original');
        const appliedNode=pair.querySelector('.paired-applied-items');
        const raw=rawNode?.getBoundingClientRect();
        const applied=appliedNode?.getBoundingClientRect();
        const items=[...pair.querySelectorAll('.paired-applied-item')].map(item=>({status:item.querySelector('b')?.innerText||'',background:getComputedStyle(item).backgroundColor}));
        return { pair: { left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top), bottom: Math.round(box.bottom), width: Math.round(box.width), height: Math.round(box.height) }, raw: raw && { left: Math.round(raw.left), right: Math.round(raw.right), top:Math.round(raw.top), width: Math.round(raw.width) }, applied: applied && { left: Math.round(applied.left), right: Math.round(applied.right), top:Math.round(applied.top), width: Math.round(applied.width) }, items };
      });
      return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), documentOverflow: document.documentElement.scrollWidth > window.innerWidth, controls: boxes, pairs };
    });
    if (layout.documentOverflow) problems.push('1920x1080 live-history UI causes document-level horizontal overflow');
    if (layout.controls.some(box => !box.visible || box.left < 0 || box.right > 1920 || box.top < 0 || box.bottom > 1080)) problems.push(`live-history input/button is outside the viewport: ${JSON.stringify(layout.controls)}`);
    if (layout.pairs.length !== 4 || layout.pairs.some(pair => pair.pair.width <= 0 || pair.pair.height <= 0 || !pair.raw || !pair.applied || pair.raw.width <= 0 || pair.applied.width <= 0 || pair.raw.left < 0 || pair.applied.right > 1920 || pair.raw.right > pair.applied.left)) problems.push(`whole-message/application panes overlap or are out of bounds: ${JSON.stringify(layout.pairs)}`);
    const quantityItems=layout.pairs.find(pair=>pair.items.some(item=>item.status==='수량확인'))?.items||[];
    if (!quantityItems.some(item=>item.status==='수량확인'&&item.background==='rgb(237, 248, 239)')) problems.push(`exact quantity-history match is not green: ${JSON.stringify(layout.pairs)}`);
    const sqlItems=layout.pairs.find(pair=>pair.items.length===2&&pair.items.some(item=>item.status==='전산확인'))?.items||[];
    if (!sqlItems.some(item=>item.status==='전산확인'&&item.background==='rgb(237, 248, 239)') || !sqlItems.some(item=>item.status==='미확인'&&item.background==='rgb(255, 248, 232)')) problems.push(`exact SQL-confirmed and unconfirmed item colors are missing or incorrect: ${JSON.stringify(layout.pairs)}`);
    const sqlOnlyPair=layout.pairs.find(pair=>pair.items.length===1&&pair.items[0].status==='전산확인');
    if(!sqlOnlyPair)problems.push(`complete SQL-only message is missing its green confirmed item: ${JSON.stringify(layout.pairs)}`);
    if (layout.right > 1920 || layout.left < 0) problems.push(`sales inbox bounds are outside 1920 viewport: ${JSON.stringify(layout)}`);

    const fixturePosts = ['/api/orders/distribution-live-history', '/api/orders/paste-preanalysis'];
    const forbiddenPosts = apiRequests.filter(request => request.method !== 'GET' && !fixturePosts.includes(request.path));
    const erpOrLlmPosts = forbiddenPosts.filter(request => /erp|orders$|shipment|llm|ai|openai/i.test(request.path));
    if (forbiddenPosts.length) problems.push(`unexpected non-live-history POSTs: ${forbiddenPosts.map(request => `${request.method} ${request.path}`).join(', ')}`);
    if (erpOrLlmPosts.length) problems.push(`ERP/LLM POSTs observed: ${erpOrLlmPosts.map(request => `${request.method} ${request.path}`).join(', ')}`);
    if (blockedExternal.length) problems.push(`blocked external requests: ${blockedExternal.join(', ')}`);

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(JSON.stringify({ viewport: '1920x1080', responsiveViewports: responsiveLayouts, target: targetUrl.href, liveHistoryPosts, liveHistoryScopes: apiRequests.filter(request=>request.path==='/api/orders/distribution-live-history').map(request=>({year:request.body.year,week:request.body.week,from:request.body.from,to:request.body.to,messageCount:request.body.messages?.length})), newestFirst: /대전꽃집/.test(orderCheck[0] || '') && /양재동/.test(orderCheck[1] || ''), sqlEvidenceChronology: 'manual 10:45 KST < exact SQL event 11:00 KST; newer SQL confirmation wins', layout, forbiddenPosts, blockedExternal, screenshotPath, problems }, null, 2));
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

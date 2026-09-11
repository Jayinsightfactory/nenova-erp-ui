// Local-only 1920x1080 smoke for the inbox manual-application UI.
// It blocks every non-local request and supplies every /api response from memory.
// Usage: node scripts/paste-inbox-application-ui-smoke.cjs [http://127.0.0.1:3000/orders/paste?popup=1]
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const target = process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000/orders/paste?popup=1';
const screenshotPath = path.resolve(process.env.SMOKE_SCREENSHOT || 'outputs/paste-inbox-application-ui-1920.png');
const localHosts = new Set(['127.0.0.1', 'localhost']);
const targetUrl = new URL(target);
if (!localHosts.has(targetUrl.hostname) || !['http:', 'https:'].includes(targetUrl.protocol)) {
  throw new Error(`SMOKE_BASE_URL must be an http(s) localhost URL, received ${target}`);
}

const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = candidates.find(candidate => { try { return fs.existsSync(candidate); } catch { return false; } });
if (!executablePath) {
  console.error('Chrome executable not found. Set CHROME_PATH.');
  process.exit(2);
}

const sourceMessage = {
  source: 'kakao-sales',
  chat_id: 'sales-smoke-room',
  external_message_id: 'sales-smoke-message-001',
  chatroom: '영업방 smoke',
  sender: '영업 담당',
  created_at: '2026-09-11T09:00:00+09:00',
  message: 'Smoke Flower 3박스 수동 반영 확인',
};
const sourceIdentity = `${sourceMessage.source}|${sourceMessage.chat_id}|${sourceMessage.external_message_id}`;
const applications = new Map();
const apiRequests = [];
const manualGets = [];
const manualPosts = [];
const manualEvents = [];
const manualReceipts = new Map();
const blockedExternal = [];
let failApplicationReads = false;
let abortNextManualResponseAfterCommit = false;
let abortNextManualRequestBeforeCommit = false;
let abortedManualResponses = 0;
let delayNextManualStatusGet = true;
let delayedManualStatusGet = null;
let serial = 0;

function json(request, body, status = 200) {
  return request.respond({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

function apiError(request, code, message, status = 400) {
  return json(request, { error: { code, message } }, status);
}

function text(value) { return typeof value === 'string' ? value : ''; }
function scopeKey(year, week) { return `${year}|${week}`; }
function currentApplication(year, week, identity) { return applications.get(`${scopeKey(year, week)}|${identity}`) || null; }
function listApplications(year, week) {
  return [...applications.values()].filter(event => event.year === year && event.week === week);
}
function receiptKey({ year, week, requestId }) { return `${year}|${week}|inbox-ui-smoke|${requestId}`; }
function sameReceipt(receipt, payload) {
  return receipt.sourceIdentity === payload.sourceIdentity && receipt.status === payload.status && receipt.memo === payload.memo
    && receipt.expectedCurrentEventId === payload.expectedCurrentEventId;
}
function createApplication(body) {
  const year = text(body.year);
  const week = text(body.week);
  const identity = text(body.sourceIdentity);
  const status = text(body.status);
  const memo = text(body.memo);
  const current = currentApplication(year, week, identity);
  if (!/^20\d{2}$/.test(year) || !/^\d{2}-\d{2}$/.test(week)) return { error: ['INVALID_SCOPE', '연도와 전체 차수를 확인하세요.'] };
  if (identity !== sourceIdentity) return { error: ['UNEXPECTED_SOURCE_IDENTITY', 'fixture가 모르는 원문입니다.'] };
  if (!['MANUALLY_APPLIED', 'MANUALLY_NOT_APPLIED', 'CLEAR'].includes(status)) return { error: ['INVALID_STATUS', '수동 상태가 올바르지 않습니다.'] };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(body.requestId))) return { error: ['INVALID_REQUEST_ID', 'requestId가 UUID가 아닙니다.'] };
  const payload = { year, week, sourceIdentity: identity, status, memo, requestId: body.requestId, expectedCurrentEventId: body.expectedCurrentEventId ?? null };
  const existingReceipt = manualReceipts.get(receiptKey(payload));
  if (existingReceipt) {
    if (sameReceipt(existingReceipt, payload)) return { event: existingReceipt.event, idempotent: true };
    return { error: ['REQUEST_ID_CONFLICT', '같은 요청 ID로 다른 수동 적용 상태를 저장할 수 없습니다.'], status: 409 };
  }
  if ((body.expectedCurrentEventId ?? null) !== (current?.eventId ?? null)) return { error: ['CURRENT_EVENT_CONFLICT', '현재 이벤트와 다릅니다.'], status: 409 };
  const event = {
    eventId: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa${String(++serial).padStart(4, '0')}`,
    year, week, sourceIdentity: identity, status, memo,
    expectedCurrentEventId: body.expectedCurrentEventId ?? null,
    createdAt: new Date(Date.UTC(2026, 8, 11, 1, 0, serial)).toISOString(),
    author: { userId: 'inbox-ui-smoke', userName: 'inbox-ui-smoke' },
    advisoryOnly: true, erpAction: 'NONE',
  };
  applications.set(`${scopeKey(year, week)}|${identity}`, event);
  manualEvents.push(event);
  manualReceipts.set(receiptKey(payload), { ...payload, event });
  return { event };
}

function normalize(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function deferred() {
  let resolve;
  const promise = new Promise(nextResolve => { resolve = nextResolve; });
  return { promise, resolve };
}
function safeBody(request) {
  try { return request.postData() ? JSON.parse(request.postData()) : {}; }
  catch { return {}; }
}
function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
async function waitFor(check, description, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (check()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function clickManualAction(page, status) {
  const clicked = await page.evaluate(nextStatus => {
    const labels = {
      MANUALLY_APPLIED: [/^수동 적용함$/, /^적용됨$/, /^수동 적용$/, /수동.*적용/, /적용으로 표시/],
      MANUALLY_NOT_APPLIED: [/^미적용 표시$/, /적용 안 함/, /수동.*미적용/, /미적용으로 표시/],
      CLEAR: [/표시 해제/, /상태.*해제/, /수동.*지우기/, /^해제$/],
    };
    const selectors = [
      `[data-manual-application-action="${nextStatus}"]`,
      `[data-manual-status-action="${nextStatus}"]`,
      `[data-manual-action="${nextStatus}"]`,
      `[data-status="${nextStatus}"]`,
    ];
    const root = document.querySelector('[data-manual-application], [data-manual-application-card], .application-panel') || document.querySelector('article.message');
    const candidates = selectors.flatMap(selector => [...document.querySelectorAll(selector)]);
    const button = candidates.find(node => !node.disabled) || [...(root || document).querySelectorAll('button')].find(node => !node.disabled && labels[nextStatus].some(pattern => pattern.test(node.textContent.replace(/\s+/g, ' ').trim())));
    if (!button) return false;
    button.click();
    return true;
  }, status);
  if (!clicked) throw new Error(`manual application UI has no usable ${status} action button`);
}

async function fillDraft(page, value) {
  const filled = await page.evaluate(nextValue => {
    const root = document.querySelector('[data-manual-application], [data-manual-application-card], .application-panel') || document.querySelector('article.message');
    const field = root && [...root.querySelectorAll('textarea, input')].find(node => !node.disabled && node.type !== 'checkbox' && (/메모|memo|수동/i.test(`${node.getAttribute('aria-label') || ''} ${node.placeholder || ''} ${node.closest('label')?.textContent || ''}`) || node.tagName === 'TEXTAREA'));
    if (!field) return false;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
    setter?.call(field, nextValue);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, value);
  if (!filled) throw new Error('manual application UI has no editable memo field');
}

async function manualDraftValue(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-manual-application], [data-manual-application-card], .application-panel') || document.querySelector('article.message');
    const field = root && [...root.querySelectorAll('textarea, input')].find(node => !node.disabled && node.type !== 'checkbox' && (/메모|memo|수동/i.test(`${node.getAttribute('aria-label') || ''} ${node.placeholder || ''} ${node.closest('label')?.textContent || ''}`) || node.tagName === 'TEXTAREA'));
    return field ? field.value : null;
  });
}

async function clickManualRefresh(page) {
  const clicked = await page.evaluate(() => {
    const root = document.querySelector('[data-manual-application], [data-manual-application-card], .application-panel') || document.querySelector('article.message');
    const selectors = ['[data-manual-application-refresh]', '[data-manual-status-refresh]', '[data-manual-refresh]'];
    const explicit = selectors.flatMap(selector => [...document.querySelectorAll(selector)]).find(node => !node.disabled);
    const button = explicit || [...(root || document).querySelectorAll('button')].find(node => !node.disabled && /새로고침|다시.*조회|상태.*조회/.test(node.textContent.replace(/\s+/g, ' ').trim()));
    if (!button) return false;
    button.click();
    return true;
  });
  if (!clicked) throw new Error('manual application UI has no scoped refresh button');
}

async function confirmIfNeeded(page, postCount) {
  await delay(200);
  if (manualPosts.length > postCount) return;
  const clicked = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"], dialog, [data-manual-application]')];
    const root = dialogs.find(node => /수동 적용|적용 안 함|미적용|표시 해제/.test(node.textContent || ''));
    const button = root && [...root.querySelectorAll('button')].find(node => !node.disabled && /저장|확인|적용/.test(node.textContent.replace(/\s+/g, ' ').trim()));
    if (!button) return false;
    button.click();
    return true;
  });
  if (clicked) await waitFor(() => manualPosts.length > postCount, 'manual application POST after confirmation');
}

async function toggleInbox(page, open) {
  const changed = await page.evaluate(nextOpen => {
    const button = [...document.querySelectorAll('button')].find(node => /영업방 대화/.test(node.textContent || ''));
    if (!button || String(button.getAttribute('aria-expanded')) === String(nextOpen)) return false;
    button.click();
    return true;
  }, open);
  if (!changed) throw new Error(`could not ${open ? 'expand' : 'collapse'} the inbox`);
}

async function setAutoRefresh(page, enabled) {
  const changed = await page.evaluate(nextEnabled => {
    const input = [...document.querySelectorAll('input[type="checkbox"]')].find(node => /15초마다 자동 확인/.test(node.closest('label')?.textContent || ''));
    if (!input || input.checked === nextEnabled) return false;
    input.click();
    return true;
  }, enabled);
  if (!changed) throw new Error(`could not turn automatic inbox refresh ${enabled ? 'on' : 'off'}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
  const problems = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text()}`);
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('nenovaUser', JSON.stringify({ userId: 'inbox-ui-smoke', userName: 'inbox-ui-smoke', role: 'admin' }));
    });
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const requestUrl = request.url();
      if (requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) return request.continue();
      let parsed;
      try { parsed = new URL(requestUrl); } catch { return request.abort('blockedbyclient'); }
      if (parsed.origin !== targetUrl.origin) {
        blockedExternal.push(requestUrl);
        return request.abort('blockedbyclient');
      }
      if (!parsed.pathname.startsWith('/api/')) return request.continue();
      const method = request.method().toUpperCase();
      const body = safeBody(request);
      apiRequests.push({ method, path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), body });
      try {
        if (parsed.pathname === '/api/auth/me') return json(request, { success: true, user: { userId: 'inbox-ui-smoke', userName: 'inbox-ui-smoke', role: 'admin' } });
        if (parsed.pathname === '/api/kakao/sales-feed') return json(request, { ok: true, messages: [sourceMessage], hasMore: false, nextAfterKey: null });
        if (parsed.pathname === '/api/orders/distribution-manual-applications') {
          if (method === 'GET') {
            manualGets.push({ year: parsed.searchParams.get('year'), week: parsed.searchParams.get('week') });
            if (delayNextManualStatusGet) {
              delayNextManualStatusGet = false;
              delayedManualStatusGet = deferred();
              await delayedManualStatusGet.promise;
            }
            if (failApplicationReads) return apiError(request, 'MANUAL_APPLICATION_READ_FAILED', '수동 적용 상태 mock 조회 실패', 503);
            return json(request, { applications: listApplications(parsed.searchParams.get('year'), parsed.searchParams.get('week')) });
          }
          if (method === 'POST') {
            manualPosts.push(body);
            if (abortNextManualRequestBeforeCommit) {
              abortNextManualRequestBeforeCommit = false;
              abortedManualResponses += 1;
              return request.abort('failed');
            }
            const result = createApplication(body);
            if (result.error) return apiError(request, result.error[0], result.error[1], result.status || 400);
            if (abortNextManualResponseAfterCommit) {
              abortNextManualResponseAfterCommit = false;
              abortedManualResponses += 1;
              return request.abort('failed');
            }
            return json(request, { application: result.event }, 201);
          }
          return apiError(request, 'METHOD_NOT_ALLOWED', 'GET and POST only', 405);
        }
        if (method !== 'GET') return apiError(request, 'FIXTURE_WRITE_BLOCKED', `fixture blocks ${method} ${parsed.pathname}`, 405);
        if (parsed.pathname === '/api/orders/mappings') return json(request, { success: true, mappings: {} });
        if (parsed.pathname === '/api/master') return json(request, { success: true, data: [] });
        if (parsed.pathname === '/api/orders/prod-units') return json(request, { success: true, units: {} });
        if (parsed.pathname === '/api/orders/weeks') return json(request, { success: true, weeks: ['2026-37-01'] });
        if (parsed.pathname === '/api/favorites') return json(request, { success: true, favorites: [] });
        if (parsed.pathname === '/api/orders/paste-history') return json(request, { success: true, operations: [], hasMore: false, nextCursor: null });
        if (parsed.pathname === '/api/orders/history') return json(request, { success: true, history: [], page: Number(parsed.searchParams.get('page') || 1), hasMore: false, orderYear: parsed.searchParams.get('year') || '2026' });
        if (parsed.pathname === '/api/orders/distribution-change-audits') return json(request, { items: [], advisoryOnly: true, erpAction: 'NONE', limit: 20, asOf: '2026-09-11T00:00:00.000Z' });
        if (parsed.pathname === '/api/erp/edit-presence') return json(request, { success: true, stale: false, digest: 'inbox-smoke', lease: { active: false } });
        if (parsed.pathname === '/api/orders') return json(request, { success: true, orders: [] });
        if (parsed.pathname === '/api/orders/distribution-baselines') return json(request, { items: [] });
        if (parsed.pathname === '/api/ping') return json(request, { success: true });
        return json(request, { success: true, data: [], rows: [], items: [], customers: [], products: [], operations: [], hasMore: false });
      } catch (error) {
        return apiError(request, 'FIXTURE_ERROR', error.message, 500);
      }
    });

    await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('section.sales-inbox article.message', { visible: true, timeout: 30000 });
    await waitFor(() => delayedManualStatusGet !== null, 'delayed initial manual status GET');
    await page.waitForFunction(() => document.querySelector('[data-manual-application-refresh]')?.disabled === true, { timeout: 15000 });
    await setAutoRefresh(page, false);
    await page.waitForFunction(() => document.querySelector('[data-manual-application-refresh]')?.disabled === false, { timeout: 15000 });
    const unloadedApplicationText = await page.$eval('section.sales-inbox', element => ({
      batch: String(element.querySelector('.application-batch-status')?.textContent || '').replace(/\s+/g, ' ').trim(),
      audit: String(element.querySelector('.application-panel .audit-line')?.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    if (!unloadedApplicationText.batch.includes('아직 확인하지 못했습니다') || !unloadedApplicationText.audit.includes('아직 확인하지 못함') || unloadedApplicationText.audit.includes('최근 비교 결과 없음')) {
      problems.push(`unloaded application state has the wrong copy: ${JSON.stringify(unloadedApplicationText)}`);
    }
    delayedManualStatusGet.resolve();
    await delay(100);
    const getsBeforeAutoRefreshResume = manualGets.length;
    await setAutoRefresh(page, true);
    await waitFor(() => manualGets.length > getsBeforeAutoRefreshResume, 'manual status GET after auto refresh resumes');
    await page.waitForFunction(() => document.querySelector('[data-manual-application-refresh]')?.disabled === false && !document.querySelector('.application-batch-status')?.textContent.includes('아직 확인하지 못했습니다'), { timeout: 15000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /수동.*적용|적용.*표시|^적용됨$|^수동 적용함$/.test((button.textContent || '').trim())), { timeout: 30000 });
    await waitFor(() => manualGets.length > 0, 'initial manual-application GET');
    await delay(400);
    const initialWrites = apiRequests.filter(request => request.method !== 'GET');
    if (initialWrites.length) problems.push(`initial render made non-GET API requests: ${initialWrites.map(request => `${request.method} ${request.path}`).join(', ')}`);
    if (manualPosts.length) problems.push(`initial render made ${manualPosts.length} manual application POST(s)`);

    // A manual save aborts an explicitly refreshed status GET while automatic
    // refresh is off. Its failed POST must not leave the refresh button loading.
    await setAutoRefresh(page, false);
    delayNextManualStatusGet = true;
    delayedManualStatusGet = null;
    const getsBeforeSaveAbort = manualGets.length;
    await clickManualRefresh(page);
    await waitFor(() => delayedManualStatusGet !== null && manualGets.length > getsBeforeSaveAbort, 'delayed explicit manual status GET');
    await page.waitForFunction(() => document.querySelector('[data-manual-application-refresh]')?.disabled === true, { timeout: 15000 });
    const eventsBeforeSaveAbort = manualEvents.length;
    const postsBeforeSaveAbort = manualPosts.length;
    abortNextManualRequestBeforeCommit = true;
    await fillDraft(page, '응답 중단 저장은 원장을 만들지 않는 smoke 메모');
    await clickManualAction(page, 'MANUALLY_APPLIED');
    await confirmIfNeeded(page, postsBeforeSaveAbort);
    await waitFor(() => manualPosts.length === postsBeforeSaveAbort + 1, 'aborted manual save POST');
    await page.waitForFunction(() => /저장하지 못했습니다|다시 시도/.test(document.querySelector('.application-panel')?.textContent || ''), { timeout: 15000 });
    if (manualEvents.length !== eventsBeforeSaveAbort) problems.push('aborted manual save appended an application event');
    delayedManualStatusGet.resolve();
    await page.waitForFunction(() => document.querySelector('[data-manual-application-refresh]')?.disabled === false, { timeout: 15000 });
    const getsBeforeSaveAbortRecovery = manualGets.length;
    await clickManualRefresh(page);
    await waitFor(() => manualGets.length > getsBeforeSaveAbortRecovery, 'manual status refresh recovery after aborted save');
    await page.waitForFunction(() => document.querySelector('[data-manual-application-refresh]')?.disabled === false, { timeout: 15000 });

    const layout = await page.$eval('section.sales-inbox', element => {
      const rect = element.getBoundingClientRect();
      const message = element.querySelector('article.message')?.getBoundingClientRect();
      return {
        inboxWidth: Math.round(rect.width), inboxLeft: Math.round(rect.left), inboxRight: Math.round(rect.right),
        messageWidth: message ? Math.round(message.width) : 0,
        documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    if (layout.documentOverflow) problems.push('1920x1080 inbox causes document-level horizontal overflow');
    if (layout.inboxWidth > 500 || layout.messageWidth > 500) problems.push(`inbox does not fit the expected ~458px first column: ${JSON.stringify(layout)}`);

    const draft = '초안은 접기와 상태 조회 뒤에도 남아야 합니다.';
    await fillDraft(page, draft);
    await toggleInbox(page, false);
    await toggleInbox(page, true);
    if (await manualDraftValue(page) !== draft) problems.push('manual memo draft was lost when the inbox was collapsed and expanded');

    // The store commits before an interrupted HTTP response. A later retry must use
    // the exact persisted request receipt before evaluating the now-newer current event.
    const abortsBeforeLostReceipt = abortedManualResponses;
    abortNextManualResponseAfterCommit = true;
    let postsBefore = manualPosts.length;
    let eventsBefore = manualEvents.length;
    await clickManualAction(page, 'MANUALLY_APPLIED');
    await confirmIfNeeded(page, postsBefore);
    await waitFor(() => manualPosts.length === postsBefore + 1, 'interrupted MANUALLY_APPLIED POST');
    const interruptedPayload = { ...manualPosts.at(-1) };
    if (manualEvents.length !== eventsBefore + 1 || abortedManualResponses !== abortsBeforeLostReceipt + 1) problems.push('interrupted manual POST did not commit exactly one in-memory application event before aborting its response');
    await page.waitForFunction(() => /저장하지 못했습니다|재시도/.test(document.querySelector('.application-panel')?.textContent || ''), { timeout: 15000 });
    const readsBeforeReceiptRefresh = manualGets.length;
    await clickManualRefresh(page);
    await waitFor(() => manualGets.length > readsBeforeReceiptRefresh, 'manual status GET after interrupted response');
    await page.waitForFunction(() => /적용됨|수동 확인/.test(document.querySelector('.application-panel')?.textContent || ''), { timeout: 15000 });

    postsBefore = manualPosts.length;
    eventsBefore = manualEvents.length;
    let readsBeforeSave = manualGets.length;
    await clickManualAction(page, 'MANUALLY_APPLIED');
    await confirmIfNeeded(page, postsBefore);
    await waitFor(() => manualPosts.length === postsBefore + 1, 'idempotent MANUALLY_APPLIED retry');
    await waitFor(() => manualGets.length > readsBeforeSave, 'MANUALLY_APPLIED status reload');
    const retryPayload = manualPosts.at(-1);
    if (JSON.stringify(retryPayload) !== JSON.stringify(interruptedPayload)) problems.push('retry changed the committed request receipt payload after status GET');
    if (manualEvents.length !== eventsBefore) problems.push('idempotent retry appended another manual application event');

    const normalApplyMemo = '정상 수동 적용 smoke 메모';
    await fillDraft(page, normalApplyMemo);
    postsBefore = manualPosts.length;
    readsBeforeSave = manualGets.length;
    await clickManualAction(page, 'MANUALLY_APPLIED');
    await confirmIfNeeded(page, postsBefore);
    await waitFor(() => manualPosts.length === postsBefore + 1, 'normal MANUALLY_APPLIED POST');
    await waitFor(() => manualGets.length > readsBeforeSave, 'normal MANUALLY_APPLIED status reload');
    if (manualPosts.at(-1).status !== 'MANUALLY_APPLIED') problems.push('apply button did not send MANUALLY_APPLIED');
    if (manualPosts.at(-1).sourceIdentity !== sourceIdentity) problems.push('apply button did not preserve source identity');
    if (manualPosts.at(-1).memo !== normalApplyMemo) problems.push('apply button did not send the visible memo draft');
    const normalAppliedEvent = manualEvents.at(-1);
    const appliedStyles = await page.$eval('.application-panel', element => {
      const panel = getComputedStyle(element);
      const status = getComputedStyle(element.querySelector('.status-MANUALLY_APPLIED'));
      return {
        panelBackground: panel.backgroundColor,
        panelBorderTop: panel.borderTopColor,
        panelBorderTopWidth: panel.borderTopWidth,
        appliedStatusBackground: status.backgroundColor,
      };
    });
    if (appliedStyles.panelBackground !== 'rgb(248, 251, 253)' || appliedStyles.panelBorderTop !== 'rgb(215, 226, 236)' || appliedStyles.panelBorderTopWidth !== '1px') {
      problems.push(`manual application panel styles are not applied: ${JSON.stringify(appliedStyles)}`);
    }
    if (appliedStyles.appliedStatusBackground !== 'rgb(230, 245, 233)') {
      problems.push(`MANUALLY_APPLIED status badge style is not applied: ${JSON.stringify(appliedStyles)}`);
    }

    await fillDraft(page, '미적용으로 남기는 smoke 메모');
    postsBefore = manualPosts.length;
    readsBeforeSave = manualGets.length;
    await clickManualAction(page, 'MANUALLY_NOT_APPLIED');
    await confirmIfNeeded(page, postsBefore);
    await waitFor(() => manualPosts.length === postsBefore + 1, 'MANUALLY_NOT_APPLIED POST');
    await waitFor(() => manualGets.length > readsBeforeSave, 'MANUALLY_NOT_APPLIED status reload');
    if (manualPosts.at(-1).status !== 'MANUALLY_NOT_APPLIED') problems.push('not-applied button did not send MANUALLY_NOT_APPLIED');
    if (manualPosts.at(-1).expectedCurrentEventId !== normalAppliedEvent?.eventId) problems.push('not-applied action did not send the current event id for CAS');

    const readsBeforeReload = manualGets.length;
    await clickManualRefresh(page);
    await waitFor(() => manualGets.length > readsBeforeReload, 'manual status reload');
    const latestNotAppliedText = await page.$eval('section.sales-inbox', element => String(element.textContent || '').replace(/\s+/g, ' ').trim());
    if (!/미적용|적용 안 함/.test(latestNotAppliedText)) problems.push('reload did not show the MANUALLY_NOT_APPLIED state');

    failApplicationReads = true;
    const readsBeforeFailure = manualGets.length;
    await clickManualRefresh(page);
    await waitFor(() => manualGets.length > readsBeforeFailure, 'failed manual status reload');
    await page.waitForFunction(() => /실패|다시|유지/.test(document.querySelector('section.sales-inbox')?.textContent || ''), { timeout: 15000 });
    const afterFailureText = await page.$eval('section.sales-inbox', element => String(element.textContent || '').replace(/\s+/g, ' ').trim());
    if (!/미적용|적용 안 함/.test(afterFailureText)) problems.push('failed GET cleared the same-scope manual application state');
    failApplicationReads = false;

    await fillDraft(page, '표시 해제 smoke 메모');
    postsBefore = manualPosts.length;
    readsBeforeSave = manualGets.length;
    await clickManualAction(page, 'CLEAR');
    await confirmIfNeeded(page, postsBefore);
    await waitFor(() => manualPosts.length === postsBefore + 1, 'CLEAR POST');
    await waitFor(() => manualGets.length > readsBeforeSave, 'CLEAR status reload');
    if (manualPosts.at(-1).status !== 'CLEAR') problems.push('clear button did not send CLEAR');

    const erpPosts = apiRequests.filter(request => request.method !== 'GET' && (/^\/api\/(erp|shipment)\//.test(request.path) || request.path === '/api/orders'));
    const unexpectedWrites = apiRequests.filter(request => request.method !== 'GET' && request.path !== '/api/orders/distribution-manual-applications');
    if (erpPosts.length) problems.push(`manual status UI attempted ERP writes: ${erpPosts.map(request => `${request.method} ${request.path}`).join(', ')}`);
    if (unexpectedWrites.length) problems.push(`manual status UI made non-manual writes: ${unexpectedWrites.map(request => `${request.method} ${request.path}`).join(', ')}`);
    if (blockedExternal.length) problems.push(`blocked external requests: ${blockedExternal.join(', ')}`);

    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(JSON.stringify({
      viewport: '1920x1080', target: targetUrl.href, layout, sourceIdentity,
      manualGets: manualGets.length, manualPosts: manualPosts.map(({ year, week, sourceIdentity: identity, status, expectedCurrentEventId, memo }) => ({ year, week, sourceIdentity: identity, status, expectedCurrentEventId, memo })), appliedStyles,
      erpPosts: erpPosts.length, blockedExternal: blockedExternal.length, screenshotPath, problems,
    }, null, 2));
    if (problems.length) process.exitCode = 1;
  } catch (error) {
    const pages = await browser.pages();
    const failedPage = pages.at(-1);
    if (failedPage) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await failedPage.screenshot({ path: screenshotPath.replace(/\.png$/i, '-failure.png'), fullPage: false }).catch(() => {});
      console.error(await failedPage.evaluate(() => document.body.innerText.slice(-12000)).catch(() => ''));
    }
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });

'use strict';

// Process-level Electron smoke harness. Run with:
// desktop/node_modules/.bin/electron desktop/scripts/smoke.cjs
// The persistent work partition is fully intercepted by an in-memory fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, session, dialog } = require('electron');
process.on('uncaughtException', error => { console.error('Uncaught smoke error:', error.stack); app.exit(1); });
process.on('unhandledRejection', error => { console.error('Unhandled smoke error:', error?.stack || error); app.exit(1); });

const ORIGIN = 'https://nenovaweb.com';
const USER_DATA = path.join(os.tmpdir(), `nenova-desktop-smoke-${process.pid}`);
const OUTPUT = path.resolve(__dirname, '..', 'test-output');
let dialogAnswer = 1;
let accountActor = 'desktop-test';
let bootstrapOverride = null;
let holdAccountBAuth = false;
let accountBAuthStarted = false;
let releaseAccountBAuth;
let holdAccountABootstrap = false;
let accountABootstrapStarted = false;
let releaseAccountABootstrap;
const fixtureRequests = [];
const HOME_ROUTE = '/api/desktop/home-workspace';
const HOME_DATE = '2026-10-09';
const homeStores = new Map(), homeRequests = [], homeHolds = [];
let homeFailNextPost = false;
let main;
dialog.showMessageBoxSync = () => dialogAnswer;

app.setPath('userData', USER_DATA);
app.setPath('sessionData', USER_DATA);
app.setName('Nenova Desktop Smoke');

function homeStore(owner) {
  if (!homeStores.has(owner)) homeStores.set(owner, { revision: 1, tasks: [{
    id: `${owner}-task`, title: `${owner} 확인 업무`, startDate: HOME_DATE, weekdays: [],
    occurrenceDate: HOME_DATE, done: false, carried: false, archived: false, stopped: false,
  }], guidance: [{ id: 'guide-1', title: '업무 안내 <img src=x onerror="window.__homeInjected=true">',
    summary: '실제 운영 데이터 없는 스모크 안내', updatedAt: `${HOME_DATE}T00:00:00.000Z`, href: '/test/fixture',
    sourceKey: 'guidance:smoke-1', unread: true, priority: 'normal' }], feedback: [{ id: 'feedback-1',
    title: '연도와 차수 확인', summary: '2026년 40-01차 테스트 피드백', updatedAt: `${HOME_DATE}T01:00:00.000Z`,
    href: '/test/fixture?year=2026&week=40-01', sourceKey: 'feedback:smoke-1', unread: true,
    priority: 'high', orderYear: 2026, orderWeek: '40-01' }] });
  return homeStores.get(owner);
}
function homeSnapshot(owner, date = HOME_DATE) {
  const store = homeStore(owner);
  return structuredClone({ success: true, schemaVersion: 1, ownerId: owner, date, ...store,
    feedErrors: {}, syncedAt: `${HOME_DATE}T02:00:00.000Z`, totalTasks: store.tasks.length, nextOffset: null });
}
function holdHome(predicate) {
  const held = { predicate, started: false, release: null };
  homeHolds.push(held);
  return held;
}
async function homeFixture(request, url) {
  const owner = accountActor;
  const body = request.method === 'POST' ? await request.json() : null;
  const date = body?.date || url.searchParams.get('date') || HOME_DATE;
  const expectedOwnerId = body?.expectedOwnerId || url.searchParams.get('expectedOwnerId');
  assert.equal(url.pathname, HOME_ROUTE);
  assert.equal(request.headers.get('origin'), ORIGIN, 'home bridge supplies the fixed Origin');
  assert.match(date, /^20\d{2}-\d{2}-\d{2}$/);
  assert.equal(new Date(date + 'T00:00:00Z').toISOString().slice(0, 10), date);
  const record = { method: request.method, pathname: url.pathname, owner, expectedOwnerId, date, body };
  homeRequests.push(record);
  if (expectedOwnerId !== owner) return Response.json({ success: false, code: 'OWNER_CHANGED', error: '계정 변경' }, { status: 409 });
  const store = homeStore(owner);
  if (request.method === 'POST') {
    if (homeFailNextPost) { homeFailNextPost = false; return Response.json({ success: false, code: 'FIXTURE_FAILURE', error: '스모크 저장 실패 · 입력 보존 확인' }, { status: 503 }); }
    if (body.expectedRevision !== store.revision) return Response.json({ success: false, code: 'REVISION_CONFLICT', error: '다시 조회하세요.' }, { status: 409 });
    assert.match(body.requestId, /^[\w-]{8,100}$/);
    if (body.action === 'create') store.tasks.push({ id: `${owner}-created-${store.revision}`, title: body.title,
      startDate: body.startDate || date, weekdays: body.weekdays || [], occurrenceDate: date,
      done: false, carried: false, archived: false, stopped: false });
    else if (body.action === 'read') {
      const feed = [...store.guidance, ...store.feedback].find(item => item.sourceKey === body.sourceKey);
      assert.ok(feed, 'read command uses a known fixture sourceKey'); feed.unread = false;
    } else {
      const task = store.tasks.find(item => item.id === body.taskId);
      assert.ok(task, 'mutation uses an account-owned task');
      if (body.action === 'complete') task.done = body.done;
      else if (body.action === 'update') Object.assign(task, Object.fromEntries(['title', 'weekdays', 'startDate'].filter(key => body[key] !== undefined).map(key => [key, body[key]])));
      else if (body.action === 'archive') task.archived = true;
      else if (body.action === 'restore') task.archived = false;
      else if (body.action === 'stop') task.stopped = true;
      else assert.fail(`Unexpected fixture home action: ${body.action}`);
    }
    store.revision++;
  } else assert.equal(request.method, 'GET');
  // Snapshot before waiting: delayed A data must never become B data by accident.
  const result = homeSnapshot(owner, date);
  const held = homeHolds.find(item => !item.started && item.predicate(record));
  if (held) { held.started = true; await new Promise(resolve => { held.release = resolve; }); }
  return Response.json(result);
}

function fixturePage(pathname) {
  const title = pathname.includes('second') ? '두 번째 업무 화면' : '스모크 업무 화면';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
    <style>html,body{margin:0;min-height:100%;font:16px sans-serif}main{padding:24px}</style></head>
    <body><main><h1>${title}</h1><label for="smoke-input">업무 입력</label><input id="smoke-input" value="초기값">
    <button id="popup-button" onclick="openFixturePopup()">팝업 열기</button><output id="popup-state">대기</output></main>
    <script>
      window.__popupReceived = false;
      window.__nonblankReceived = false;
      window.__blockUnload = false;
      window.addEventListener('beforeunload', event => { if (window.__blockUnload) { event.preventDefault(); event.returnValue = 'unsaved'; } });
      window.addEventListener('message', event => { if (event.data === 'nenova-smoke-popup-ready') window.__popupReceived = true; });
      window.addEventListener('message', event => { if (event.data === 'nenova-smoke-nonblank-ready') window.__nonblankReceived = true; });
      window.openFixturePopup = () => {
        const child = window.open('about:blank', 'nenova-smoke-print');
        window.__popupOpened = Boolean(child);
        if (!child) return;
        child.document.open();
        child.document.write('<!doctype html><title>인쇄 확인</title><p>인쇄 팝업</p>');
        child.document.close();
        child.opener.postMessage('nenova-smoke-popup-ready', location.origin);
      };
      window.openSameOriginPopup = () => {
        window.__nonblankHandle = Boolean(window.open('/test/popup', 'nenova-smoke-nonblank'));
      };
    </script></body></html>`;
}

function installFixtureProtocol() {
  const workSession = session.fromPartition('persist:nenova-work');
  session.defaultSession.protocol.handle('https', () => new Response('Blocked by smoke fixture', { status: 403 }));
  for (const isolated of [session.defaultSession, workSession]) isolated.protocol.handle('http', () => new Response('Blocked by smoke fixture', { status: 403 }));
  // The session protocol hook catches every HTTPS request, including any URL
  // the application might construct. No request can reach the real service.
  workSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== ORIGIN) return new Response('Blocked by smoke fixture', { status: 403 });
    fixtureRequests.push({ method: request.method, pathname: url.pathname });
    if (url.pathname === HOME_ROUTE) return homeFixture(request, url);
    if (url.pathname === '/api/auth/me') {
      if (accountActor === 'desktop-test-b' && holdAccountBAuth) {
        accountBAuthStarted = true;
        await new Promise(resolve => { releaseAccountBAuth = resolve; });
      }
      return Response.json({ success: true, user: { userId: accountActor, userName: accountActor } });
    }
    if (url.pathname === '/api/desktop/bootstrap') {
      const bootstrapActor = accountActor;
      if (bootstrapActor === 'desktop-test' && holdAccountABootstrap) {
        accountABootstrapStarted = true;
        await new Promise(resolve => { releaseAccountABootstrap = resolve; });
      }
      return Response.json(bootstrapOverride || {
        success: true, schemaVersion: 1, user: { userId: bootstrapActor }, webVersion: 'web-1',
        menuVersion: (bootstrapActor === 'desktop-test-b' ? 'd' : 'a').repeat(64), menus: [{ group: '업무', items: [{ href: '/test/fixture', labelKey: 'fixture', popup: false }] }],
      });
    }
    if (url.pathname.startsWith('/api/')) return Response.json({ success: true, data: [] });
    if (url.pathname === '/test/popup') {
      return new Response(`<!doctype html><title>동일 출처 팝업</title><script>window.opener.postMessage('nenova-smoke-nonblank-ready', location.origin);</script>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (url.pathname.startsWith('/test/')) {
      return new Response(fixturePage(url.pathname), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response(fixturePage(url.pathname), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(predicate, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { last = await predicate(); if (last) return last; } catch { /* Keep polling until settled. */ }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function waitForTab(tab, predicate, description) {
  await waitFor(() => predicate(tab), description);
}
function capture(window, name) {
  return window.webContents.capturePage().then(image => {
    fs.writeFileSync(path.join(OUTPUT, name), image.toPNG());
  });
}

async function homeIpc(contents, payload) {
  return contents.executeJavaScript(`window.desktop.invoke('homeWorkspace', ${JSON.stringify(payload)})`);
}

async function verifyHomeBridge(contents) {
  const initial = await homeIpc(contents, { method: 'GET', date: HOME_DATE, url: 'https://outside.invalid/', ownerId: 'forged' });
  assert.equal(initial.ownerId, 'desktop-test');
  assert.equal(initial.date, HOME_DATE);
  const create = { action: 'create', title: 'IPC 생성 업무', startDate: HOME_DATE, weekdays: [1, 3],
    date: HOME_DATE, requestId: 'smoke-home-create', expectedRevision: initial.revision,
    expectedOwnerId: 'forged', ownerId: 'forged', url: 'https://outside.invalid/' };
  const created = await homeIpc(contents, { method: 'POST', command: create });
  const task = created.tasks.find(item => item.title === 'IPC 생성 업무');
  assert.ok(task, 'create IPC returns the persisted fixture task');
  assert.equal(created.revision, initial.revision + 1);
  const posted = homeRequests.filter(request => request.method === 'POST').at(-1);
  assert.equal(posted.expectedOwnerId, 'desktop-test', 'owner is supplied by authenticated main');
  assert.equal(posted.pathname, HOME_ROUTE, 'shell cannot replace the home endpoint');
  assert.equal('url' in posted.body, false); assert.equal('ownerId' in posted.body, false);
  const completed = await homeIpc(contents, { method: 'POST', command: { action: 'complete', taskId: task.id, done: true,
    date: HOME_DATE, requestId: 'smoke-home-complete', expectedRevision: created.revision } });
  assert.equal(completed.tasks.find(item => item.id === task.id).done, true);
  const read = await homeIpc(contents, { method: 'POST', command: { action: 'read', sourceKey: 'guidance:smoke-1',
    date: HOME_DATE, requestId: 'smoke-home-read', expectedRevision: completed.revision } });
  assert.equal(read.guidance[0].unread, false);
  assert.equal(read.feedback[0].orderYear, 2026); assert.equal(read.feedback[0].orderWeek, '40-01');
  const conflict = await homeIpc(contents, { method: 'POST', command: { action: 'complete', taskId: task.id, done: false,
    date: HOME_DATE, requestId: 'smoke-home-conflict', expectedRevision: created.revision } });
  assert.equal(conflict.success, false); assert.equal(conflict.status, 409);
  assert.equal(homeStore('desktop-test').tasks.find(item => item.id === task.id).done, true, 'stale revision cannot undo completion');
  const beforeInvalid = homeRequests.length;
  await assert.rejects(homeIpc(contents, { method: 'DELETE', date: HOME_DATE }));
  await assert.rejects(homeIpc(contents, { method: 'GET', date: '2026-02-30' }));
  assert.equal(homeRequests.length, beforeInvalid, 'invalid bridge requests never reach fixture transport');
  console.log('Smoke: home IPC fixed route, owner, date, create/complete/read and conflict');
}

async function verifyHomeUi(contents, window) {
  const previousActive = window.activeId;
  main.command(window, 'menu', { open: true });
  await waitFor(() => contents.executeJavaScript('typeof window.homeWorkspace?.applyState === "function" && Boolean(document.querySelector(".hw-task"))'), 'home module loads under native shell CSP');
  const boundary = await contents.executeJavaScript(`({ protocol: location.protocol,
    module: [...document.scripts].some(script => script.src === 'nenova-app://shell/home-workspace.js'),
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content })`);
  assert.equal(boundary.protocol, 'nenova-app:'); assert.equal(boundary.module, true);
  assert.match(boundary.csp, /connect-src 'none'/, 'home UI does not relax browser network CSP');
  await contents.executeJavaScript(`(() => { const date = document.querySelector('.hw-heading input[type=date]');
    date.value = '${HOME_DATE}'; date.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await waitFor(() => contents.executeJavaScript(`document.querySelector('.hw-rows').textContent.includes('IPC 생성 업무') && !document.querySelector('.hw-add>button').disabled`), 'home reload shows server-confirmed IPC snapshot');
  assert.equal(await contents.executeJavaScript('Boolean(document.querySelector("#homeWorkspace img")) || Boolean(window.__homeInjected)'), false, 'feed HTML remains inert text');
  assert.match(await contents.executeJavaScript('document.querySelector(".hw-feeds").textContent'), /2026년 40-01차/);

  homeFailNextPost = true;
  window.win.focus(); contents.focus();
  await contents.executeJavaScript(`(() => { const input = document.querySelector('.hw-add>input'); input.value = 'UI 저장 실패 후 재시도'; input.dispatchEvent(new Event('input',{bubbles:true})); input.focus(); })()`);
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); contents.sendInputEvent({ type: 'char', keyCode: '\r' }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(() => contents.executeJavaScript('!document.querySelector(".hw-error").hidden && document.querySelector(".hw-error").textContent.includes("스모크 저장 실패")'), 'home save failure is visible').catch(async error => {
    console.error('Home failure diagnostic', await contents.executeJavaScript(`({ focused: document.activeElement.outerHTML, input: document.querySelector('.hw-add>input').value, disabled: document.querySelector('.hw-add>button').disabled, error: document.querySelector('.hw-error').textContent, status: document.querySelector('.hw-status').textContent })`), homeRequests.slice(-3)); throw error;
  });
  assert.equal(await contents.executeJavaScript('document.querySelector(".hw-add>input").value'), 'UI 저장 실패 후 재시도');
  assert.equal(homeStore(accountActor).tasks.some(task => task.title === 'UI 저장 실패 후 재시도'), false, 'failed save creates no task');
  await contents.executeJavaScript('document.querySelector(".hw-error button").click()');
  await waitFor(() => contents.executeJavaScript('document.querySelector(".hw-rows").textContent.includes("UI 저장 실패 후 재시도") && document.querySelector(".hw-add>input").value === ""'), 'home retry saves and clears input');
  const uiTask = homeStore(accountActor).tasks.find(task => task.title === 'UI 저장 실패 후 재시도');
  assert.ok(uiTask);
  const attempts = homeRequests.filter(request => request.body?.title === 'UI 저장 실패 후 재시도');
  assert.equal(attempts.length, 2); assert.equal(attempts[0].body.requestId, attempts[1].body.requestId, 'retry retains request identity');
  await contents.executeJavaScript(`document.querySelector('[data-task="${uiTask.id}|${HOME_DATE}"] input[type=checkbox]').focus()`);
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await waitFor(() => homeStore(accountActor).tasks.find(task => task.id === uiTask.id).done, 'Space completes a personal task through native IPC');
  await waitFor(() => contents.executeJavaScript(`document.querySelector('[data-task="${uiTask.id}|${HOME_DATE}"] input[type=checkbox]')?.checked === true`), 'completion renders server confirmation');
  await contents.executeJavaScript(`document.querySelector('[data-feed-control="feedback:detail"]').focus(); document.querySelector('[data-feed-control="feedback:detail"]').click()`);
  await waitFor(() => contents.executeJavaScript('!document.querySelector(".hw-detail").hidden'), 'feedback details expand');
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(() => contents.executeJavaScript('document.querySelector(".hw-detail").hidden && document.activeElement.dataset.feedControl === "feedback:detail"'), 'Escape restores feed trigger focus');
  await contents.executeJavaScript(`document.querySelector('[data-feed-control="feedback:detail"]').click(); document.querySelector('.hw-detail article button').click()`);
  await waitFor(() => homeStore(accountActor).feedback[0].unread === false, 'opening source records explicit read through home API');
  main.command(window, 'menu', { open: true });
  await waitFor(() => contents.executeJavaScript('document.querySelector(".hw-rows").textContent.includes("UI 저장 실패 후 재시도")'), 'return to home preserves saved personal tasks');
  assert.equal(homeRequests.every(request => request.expectedOwnerId === request.owner), true);
  assert.equal(fixtureRequests.filter(request => request.method === 'POST' && request.pathname !== HOME_ROUTE).length, 0, 'home controls never POST to ERP endpoints');
  main.command(window, 'activate', { id: previousActive });
  await waitFor(() => [...main.tabs.values()].every(tab => !tab.loading), 'home source tabs finish loading before synthetic shell-state checks');
  await contents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  console.log('Smoke: native home CSP, keyboard create/complete, failure/retry, safe feeds and source read');
}

async function run() {
  const watchdog = setTimeout(() => { console.error('Electron smoke timed out'); app.exit(1); }, 60000);
  watchdog.unref();
  console.log('Smoke: start');
  fs.mkdirSync(OUTPUT, { recursive: true });
  await app.whenReady();
  const workSession = session.fromPartition('persist:nenova-work');
  assert.ok(workSession, 'persistent work partition was created');
  await waitFor(() => main.windows.size > 0, 'main browser window');
  await main.verifyAccount(true);
  await waitFor(() => main.snapshot().actor === 'desktop-test', 'fixture authentication');

  const sourceWindow = [...main.windows.values()][0];
  assert.equal(main.command(sourceWindow, 'state', {}).syncStatus, 'ready', 'bootstrap menu is ready after login');
  console.log('Smoke: authenticated');
  sourceWindow.win.setContentSize(1920, 1080);
  sourceWindow.win.show();
  sourceWindow.win.focus();

  // Two tabs may point at the same route while retaining separate WebContents.
  const route = '/test/fixture?year=2025&week=1';
  main.command(sourceWindow, 'open', { url: route, title: '스모크 A' });
  const first = [...main.tabs.values()].find(tab => new URL(tab.url).pathname === '/test/fixture');
  assert.ok(first, 'first fixture tab opened');
  const firstContents = first.view.webContents;
  await waitForTab(first, async tab => !tab.loading && await tab.view.webContents.executeJavaScript('Boolean(document.querySelector("#smoke-input"))'), 'first fixture content');
  main.command(sourceWindow, 'open', { url: route, title: '스모크 B' });
  const second = [...main.tabs.values()].find(tab => tab.id !== first.id && new URL(tab.url).pathname === '/test/fixture');
  assert.ok(second, 'second same-route tab opened');
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.view.webContents.id, second.view.webContents.id);
  await waitForTab(second, async tab => !tab.loading && await tab.view.webContents.executeJavaScript('Boolean(document.querySelector("#smoke-input"))'), 'second fixture content');
  assert.deepEqual(await first.view.webContents.executeJavaScript(`({requireType:typeof require, processType:typeof process, desktopType:typeof window.desktop})`), {
    requireType: 'undefined', processType: 'undefined', desktopType: 'undefined',
  }, 'business pages do not receive Node, process, or desktop preload globals');
  await first.view.webContents.executeJavaScript(`localStorage.setItem('account-specific-value', 'belongs-to-A')`);

  await first.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value = '편집 후에도 유지'`);
  const initialShell = await sourceWindow.win.webContents.executeJavaScript(`(() => ({
    brand: getComputedStyle(document.querySelector('.brandbar')).visibility,
    toolbar: getComputedStyle(document.querySelector('.toolbar')).visibility,
    status: getComputedStyle(document.querySelector('.statusbar')).visibility,
    tabbar: getComputedStyle(document.querySelector('.tabbar')).visibility,
    toolsTabIndex: document.querySelector('#toolsButton').tabIndex,
    toolsTag: document.querySelector('#toolsButton').tagName,
  }))()`);
  assert.equal(initialShell.brand, 'hidden', 'compact workspace hides brand bar');
  assert.equal(initialShell.toolbar, 'hidden', 'compact workspace hides tools toolbar');
  assert.equal(initialShell.status, 'hidden', 'compact workspace hides status bar');
  assert.equal(initialShell.tabbar, 'visible', 'compact workspace keeps tabs visible');
  assert.equal(initialShell.toolsTabIndex, 0, 'tools toggle is keyboard reachable');
  assert.equal(initialShell.toolsTag, 'BUTTON');
  assert.match(await first.view.webContents.executeJavaScript('navigator.userAgent'), new RegExp(`NenovaDesktop/${require('../package.json').version.replaceAll('.', '\\.')}`), 'business session UA identifies desktop 1.2');
  assert.equal(first.view.getBounds().y, 44, 'compact tab workspace starts below the 44px tab bar');
  assert.equal(first.view.getBounds().height, 1036, 'compact tab workspace uses the remaining 1036px');
  const shellContents = sourceWindow.win.webContents;
  await verifyHomeBridge(shellContents);
  await verifyHomeUi(shellContents, sourceWindow);
  for (const [phase, label, disabled] of [['available', '앱 1.4.0 다운로드', false], ['downloading', '다운로드 42%', true], ['downloaded', '재시작하여 업데이트', false], ['unavailable', '앱 업데이트 확인', true]]) {
    shellContents.send('desktop:state', { appUpdate: { phase, version: '1.4.0', percent: 42, message: '검증 상태' } });
    await new Promise(r => setTimeout(r, 50));
    const updateUi = await shellContents.executeJavaScript("({label:document.getElementById('appUpdateButton').textContent,disabled:document.getElementById('appUpdateButton').disabled,cancel:!document.getElementById('cancelUpdateButton').hidden,notice:!document.getElementById('appUpdateNotice').hidden,noticeLabel:document.getElementById('appUpdateNotice').getAttribute('aria-label')})");
    assert.equal(updateUi.label, label); assert.equal(updateUi.disabled, disabled); assert.equal(updateUi.cancel, phase === 'downloading');
    assert.equal(updateUi.notice, ['available', 'downloaded'].includes(phase), 'update notice is visible in the compact tab bar without opening home');
    if (phase === 'available') {
      assert.match(updateUi.noticeLabel, /업데이트가 필요합니다/);
      const activeId = sourceWindow.activeId, count = main.tabs.size;
      await shellContents.executeJavaScript("document.getElementById('appUpdateNotice').click()");
      await waitFor(() => sourceWindow.menuOpen, 'update notice opens the home update controls');
      assert.equal(sourceWindow.activeId, activeId); assert.equal(main.tabs.size, count);
      main.command(sourceWindow, 'menu', { open: false });
    }
  }
  // Network recovery only asks main to check. It never activates download or
  // changes the currently edited business tab, even from an available UI state.
  const beforeAutomaticUpdate = { activeId: sourceWindow.activeId, tabCount: main.tabs.size, menuOpen: sourceWindow.menuOpen };
  await shellContents.executeJavaScript("window.dispatchEvent(new Event('online'))");
  assert.deepEqual({ activeId: sourceWindow.activeId, tabCount: main.tabs.size, menuOpen: sourceWindow.menuOpen }, beforeAutomaticUpdate);
  const compactFavorite = await shellContents.executeJavaScript(`(() => {
    const button = document.querySelector('#compactFavoriteButton');
    return button && { text: button.textContent.trim(), pressed: button.getAttribute('aria-pressed'), visibility: getComputedStyle(button).visibility };
  })()`);
  assert.deepEqual(compactFavorite, { text: '☆', pressed: 'false', visibility: 'visible' }, 'compact shell exposes an unselected favorite button');
  await shellContents.executeJavaScript(`document.querySelector('#compactFavoriteButton').click()`);
  await waitFor(() => main.snapshot().favorites.some(item => item.url === first.url), 'compact favorite is saved');
  const selectedCompactFavorite = await shellContents.executeJavaScript(`(() => ({ text: document.querySelector('#compactFavoriteButton').textContent.trim(), pressed: document.querySelector('#compactFavoriteButton').getAttribute('aria-pressed') }))()`);
  assert.deepEqual(selectedCompactFavorite, { text: '★', pressed: 'true' }, 'compact favorite button reflects selection');
  main.command(sourceWindow, 'menu', { open: true });
  await waitFor(() => shellContents.executeJavaScript('document.querySelector("#favoritesSection").hidden === false'), 'home menu shows favorites section');
  assert.ok(await shellContents.executeJavaScript(`document.querySelectorAll('#favoritesList .favorite-card').length > 0`), 'home favorites list displays the favorited tab');
  main.command(sourceWindow, 'menu', { open: false });
  await waitFor(() => shellContents.executeJavaScript('!document.querySelector(".app-shell").classList.contains("menu-open")'), 'return to compact workspace');

  const toggleToolsWithKeyboard = async expectedOpen => {
    shellContents.focus();
    await shellContents.executeJavaScript(`document.querySelector('#toolsButton').focus()`);
    assert.equal(await shellContents.executeJavaScript('document.activeElement.id'), 'toolsButton', 'tools toggle receives keyboard focus');
    shellContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
    shellContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
    await waitFor(() => main.command(sourceWindow, 'state', {}).toolsOpen === expectedOpen, `tools panel ${expectedOpen ? 'opens' : 'closes'} from keyboard`);
  };
  await toggleToolsWithKeyboard(true);
  assert.deepEqual(first.view.getBounds(), { x: 0, y: 128, width: 1920, height: 924 }, 'expanded tools reserve 128px top and 28px bottom');
  await waitFor(() => first.view.webContents.executeJavaScript(`document.documentElement.dataset.nenovaDesktopTools === 'open'`), 'remote desktop tools marker opens');
  assert.equal(first.view.webContents.id, firstContents.id, 'opening tools preserves the existing WebContents');
  assert.equal(await first.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value`), '편집 후에도 유지', 'opening tools preserves the edited input');
  await toggleToolsWithKeyboard(false);
  assert.deepEqual(first.view.getBounds(), { x: 0, y: 44, width: 1920, height: 1036 }, 'collapsing tools restores compact workspace bounds');
  await waitFor(() => first.view.webContents.executeJavaScript(`document.documentElement.dataset.nenovaDesktopTools === 'closed'`), 'remote desktop tools marker closes');
  assert.equal(first.view.webContents.id, firstContents.id, 'closing tools preserves the existing WebContents');
  assert.equal(await first.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value`), '편집 후에도 유지', 'closing tools preserves the edited input');

  const bootstrapRequestCount = fixtureRequests.filter(request => request.pathname === '/api/desktop/bootstrap').length;
  const firstPageRequestCount = fixtureRequests.filter(request => request.pathname === '/test/fixture').length;
  bootstrapOverride = {
    success: true, schemaVersion: 1, user: { userId: accountActor }, webVersion: 'web-2',
    menuVersion: 'b'.repeat(64), menus: [{ group: '업데이트', items: [{ href: '/test/fixture', labelKey: 'fixture', popup: false }, { href: '/test/new-route', labelKey: 'newRoute', popup: true }] }],
  };
  await main.verifyAccount();
  const refreshedState = main.command(sourceWindow, 'state', {});
  assert.equal(refreshedState.syncStatus, 'ready');
  assert.equal(refreshedState.menuVersion, 'b'.repeat(64));
  assert.equal(refreshedState.webVersion, 'web-2');
  assert.ok(refreshedState.menus[0].items.some(item => item.href === '/test/new-route' && item.labelKey === 'newRoute'));
  main.command(sourceWindow, 'menu', { open: true });
  await waitFor(() => shellContents.executeJavaScript("Boolean(document.querySelector('[data-menu-favorite=\"/test/new-route\"]'))"), 'new menu has a favorite toggle');
  await shellContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const tabIdsBeforeFavorite = [...main.tabs.keys()];
  sourceWindow.win.focus(); shellContents.focus();
  await shellContents.executeJavaScript("document.querySelector('[data-menu-favorite=\"/test/new-route\"]').focus()");
  shellContents.sendInputEvent({type:'keyDown',keyCode:'Enter'}); shellContents.sendInputEvent({type:'char',keyCode:'\r'}); shellContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await waitFor(() => main.snapshot().favorites.some(f => new URL(f.url).pathname === '/test/new-route'), 'Enter adds unopened menu to favorites');
  assert.deepEqual([...main.tabs.keys()],tabIdsBeforeFavorite,'favoriting does not open a tab');
  await waitFor(() => shellContents.executeJavaScript("document.activeElement?.dataset.menuFavorite === '/test/new-route' && document.activeElement.getAttribute('aria-pressed') === 'true'"),'favorite toggle preserves focus and selected state');
  shellContents.sendInputEvent({type:'keyDown',keyCode:'Space'}); shellContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
  await waitFor(() => !main.snapshot().favorites.some(f => new URL(f.url).pathname === '/test/new-route'),'Space removes menu favorite');
  const unchangedFavorites = main.snapshot().favorites;
  main.command(sourceWindow,'menuFavorite',{href:'https://evil.test/'});
  assert.deepEqual(main.snapshot().favorites,unchangedFavorites,'unknown menu cannot create a favorite');

  assert.ok(fixtureRequests.filter(request => request.pathname === '/api/desktop/bootstrap').length > bootstrapRequestCount, 'explicit verification refetches bootstrap');
  assert.equal(fixtureRequests.filter(request => request.pathname === '/test/fixture').length, firstPageRequestCount, 'bootstrap refresh does not reload the business page');
  assert.equal([...main.tabs.values()].find(tab => tab.id === first.id).view.webContents.id, firstContents.id, 'bootstrap refresh preserves the same WebContents');
  assert.equal(await first.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value`), '편집 후에도 유지', 'bootstrap refresh preserves the live edited page');
  bootstrapOverride = { ...bootstrapOverride, user: { userId: 'wrong-actor' } };
  await main.verifyAccount();
  const failedSync = main.command(sourceWindow, 'state', {});
  assert.equal(failedSync.syncStatus, 'error', 'invalid bootstrap reports sync error');
  assert.deepEqual(failedSync.menus, [], 'invalid bootstrap exposes no partial menu');
  assert.match(failedSync.notice, /최신 메뉴 확인에 실패/, 'bootstrap failure creates a shell notice');
  const noticeButton = await shellContents.executeJavaScript(`(() => ({
    visible: !document.querySelector('#toolsNotice').hidden,
    label: document.querySelector('#toolsButton').getAttribute('aria-label'),
    title: document.querySelector('#toolsButton').title,
  }))()`);
  assert.equal(noticeButton.visible, true, 'compact tools button shows its red notice badge');
  assert.match(noticeButton.label, /최신 메뉴 확인에 실패/, 'tools button accessible name includes the notice');
  assert.match(noticeButton.title, /최신 메뉴 확인에 실패/, 'tools button title includes the notice');
  await shellContents.executeJavaScript(`document.querySelector('#toolsButton').click()`);
  await waitFor(() => main.command(sourceWindow, 'state', {}).notice === '', 'opening tools marks notice handled');
  assert.equal(main.command(sourceWindow, 'state', {}).message.includes('최신 메뉴 확인에 실패'), true, 'marking the notice handled retains the status message');
  const clearedNotice = await shellContents.executeJavaScript(`({ hidden: document.querySelector('#toolsNotice').hidden, pressed: document.querySelector('#toolsButton').getAttribute('aria-pressed') })`);
  assert.deepEqual(clearedNotice, { hidden: true, pressed: 'true' }, 'handled notice badge clears while tools expand');
  await shellContents.executeJavaScript(`document.querySelector('#toolsButton').click()`);
  await waitFor(() => main.command(sourceWindow, 'state', {}).toolsOpen === false, 'tools return to compact layout');
  assert.equal(main.tabs.has(first.id), true, 'bootstrap failure preserves current tabs');
  bootstrapOverride = null;
  await main.verifyAccount();
  assert.equal(main.command(sourceWindow, 'state', {}).syncStatus, 'ready', 'later bootstrap retry recovers');
  assert.equal(await first.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value`), '편집 후에도 유지');
  main.command(sourceWindow, 'activate', { id: second.id });
  main.command(sourceWindow, 'activate', { id: first.id });
  assert.equal(await first.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value`), '편집 후에도 유지');

  // Detach, then move the same WebContents back to its original window.
  console.log('Smoke: independent tabs');
  const webContentsId = first.view.webContents.id;
  main.command(sourceWindow, 'detach', { id: first.id });
  await waitFor(() => main.windows.size === 2 && first.windowId !== sourceWindow.id, 'detached tab window');
  const detachedWindow = main.windows.get(first.windowId);
  assert.ok(detachedWindow);
  assert.equal(first.view.webContents.id, webContentsId);
  assert.equal(await first.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value`), '편집 후에도 유지');
  main.moveTab(first, sourceWindow);
  await waitFor(() => first.windowId === sourceWindow.id && sourceWindow.ids.includes(first.id), 'tab moved to original window');
  assert.equal(first.view.webContents.id, webContentsId);
  assert.equal(await first.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value`), '편집 후에도 유지');

  // Zoom belongs to a tab and does not alter another tab.
  console.log('Smoke: detach/move');
  main.command(sourceWindow, 'zoom', { id: first.id, value: 1.2 });
  assert.equal(first.zoom, 1.2);
  assert.equal(second.zoom, 1);
  await waitFor(() => Math.abs(first.view.webContents.getZoomFactor() - 1.2) < 0.001, 'first tab zoom factor');
  assert.ok(Math.abs(second.view.webContents.getZoomFactor() - 1) < 0.001, 'second tab keeps 100% zoom');

  // Persisted snapshots preserve year/week identity while dropping secret query values.
  main.command(sourceWindow, 'open', { url: '/test/second?year=2026&week=1&access_token=private', title: '연도 확인' });
  const yearTab = [...main.tabs.values()].find(tab => new URL(tab.url).pathname === '/test/second');
  assert.ok(yearTab);
  await waitForTab(yearTab, async tab => !tab.loading && await tab.view.webContents.executeJavaScript('Boolean(document.querySelector("#smoke-input"))'), 'cross-year fixture content');
  const snapshot = main.snapshot();
  const savedUrls = snapshot.windows.flatMap(window => window.tabs.map(tab => tab.url));
  assert.ok(savedUrls.some(url => url.includes('year=2025') && url.includes('week=1')));
  assert.ok(savedUrls.some(url => url.includes('year=2026') && url.includes('week=1')));
  assert.ok(savedUrls.every(url => !/access_token|private/.test(url)));

  main.command(sourceWindow, 'favorite', { id: yearTab.id });
  assert.ok(main.snapshot().favorites.some(item => item.title === '연도 확인'));

  // Validate the allowed same-origin about:blank opener used by print workflows.
  console.log('Smoke: favorites and year scope');
  await first.view.webContents.executeJavaScript(`window.openFixturePopup()`);
  await waitFor(() => first.view.webContents.executeJavaScript('window.__popupReceived === true'), 'same-origin popup opener message');
  assert.equal(await first.view.webContents.executeJavaScript('window.__popupOpened'), true);
  await first.view.webContents.executeJavaScript(`window.openSameOriginPopup()`);
  await waitFor(() => first.view.webContents.executeJavaScript('window.__nonblankReceived === true'), 'nonblank popup opener message');
  assert.equal(await first.view.webContents.executeJavaScript('window.__nonblankHandle'), true, 'same-origin nonblank popup returns a usable handle');

  console.log('Smoke: popup opener');
  const assertShellWidth = async (width, filename) => {
    sourceWindow.win.setContentSize(width, 1080);
    await delay(150);
    main.command(sourceWindow, 'menu', { open: false });
    main.command(sourceWindow, 'tools');
    await delay(100);
    const dims = await shellContents.executeJavaScript(`(() => {
      const toolbar = document.querySelector('.toolbar');
      const controls = [...toolbar.children].filter(el => !el.classList.contains('move-label') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
      const rects = controls.map(el => ({ name: el.id || el.className, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right }));
      const brandActions = document.querySelector('.brand-actions').getBoundingClientRect();
      return { innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
        toolbarVisibility: getComputedStyle(toolbar).visibility, statusVisibility: getComputedStyle(document.querySelector('.statusbar')).visibility, rects, brandActionsRight: brandActions.right };
    })()`);
    assert.ok(dims.documentWidth <= dims.innerWidth, `${width}px shell horizontal overflow: ${JSON.stringify(dims)}`);
    assert.ok(dims.bodyWidth <= dims.innerWidth, `${width}px body horizontal overflow: ${JSON.stringify(dims)}`);
    assert.equal(dims.toolbarVisibility, 'visible', `${width}px expanded toolbar is visible`);
    assert.ok(dims.brandActionsRight <= dims.innerWidth - 140 + 0.5, `${width}px expanded brand actions avoid native caption controls: ${dims.brandActionsRight} <= ${dims.innerWidth - 140}`);
    for (let i = 1; i < dims.rects.length; i++) {
      assert.ok(dims.rects[i - 1].right <= dims.rects[i].left + 0.5, `${width}px toolbar controls overlap: ${JSON.stringify(dims.rects[i - 1])}, ${JSON.stringify(dims.rects[i])}`);
    }
    const expandedFooter = await shellContents.executeJavaScript('({top:document.querySelector(".statusbar").getBoundingClientRect().top,bottom:document.querySelector(".statusbar").getBoundingClientRect().bottom,height:innerHeight})');
    assert.equal(expandedFooter.top, expandedFooter.height - 28, `${width}px expanded footer top`);
    assert.equal(expandedFooter.bottom, expandedFooter.height, `${width}px expanded footer bottom`);
    main.command(sourceWindow, 'tools');
    await delay(100);
    const compactVisibility = await shellContents.executeJavaScript(`({toolbar:getComputedStyle(document.querySelector('.toolbar')).visibility,status:getComputedStyle(document.querySelector('.statusbar')).visibility})`);
    assert.deepEqual(compactVisibility, { toolbar: 'hidden', status: 'hidden' }, `${width}px compact shell hides toolbar and status`);
    main.command(sourceWindow, 'menu', { open: true });
    await delay(100);
    const menuFooter = await shellContents.executeJavaScript('({top:document.querySelector(".statusbar").getBoundingClientRect().top,bottom:document.querySelector(".statusbar").getBoundingClientRect().bottom,height:innerHeight})');
    assert.equal(menuFooter.top, menuFooter.height - 28, `${width}px menu footer top`);
    assert.equal(menuFooter.bottom, menuFooter.height, `${width}px menu footer bottom`);
    const homeGeometry = await shellContents.executeJavaScript(`(() => {
      const home = document.querySelector('#home');
      const parts = [...document.querySelectorAll('.hw-panel,.hw-rows,.hw-feeds')].map(el => ({ width:el.scrollWidth, client:el.clientWidth, overflow:getComputedStyle(el).overflowY }));
      return { parts, homeOverflow:getComputedStyle(home).overflowY, zoom:devicePixelRatio, viewport:innerWidth };
    })()`);
    assert.equal(homeGeometry.parts.length, 3, 'native personal home module rendered its sections');
    assert.ok(['auto', 'scroll'].includes(homeGeometry.homeOverflow), 'home uses its main page scroll region');
    assert.ok(homeGeometry.parts.every(part => !['auto','scroll'].includes(part.overflow) && part.width <= part.client + 1), `${width}px personal home has no nested vertical scrollers or horizontal clipping`);
    const notes = ['<img src=x onerror="window.__notesExecuted=true">', '긴 변경 내용 '.repeat(80), '세 번째 변경 내용', '표시하지 않을 네 번째'];
    shellContents.send('desktop:state', { appUpdate: { phase: 'available', version: '9.9.9', message: '업데이트 준비', releaseNotes: notes } });
    await waitFor(() => shellContents.executeJavaScript("document.querySelector('#appUpdateNotesHeading').textContent.includes('9.9.9')"), 'release note target version');
    const updateLayout = await shellContents.executeJavaScript(`(() => {
      const heading = document.querySelector('.home-heading');
      const rect = el => { const r = el.getBoundingClientRect(); return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}; };
      return { children: [...heading.children].map(rect), ids: ['appUpdateButton','cancelUpdateButton','appUpdateStatus'].map(id => document.querySelectorAll('#'+id).length),
        notes: [...document.querySelectorAll('#appUpdateNotes li')].map(el => el.textContent), html: !!document.querySelector('#appUpdateNotes img'), executed: !!window.__notesExecuted,
        width: document.documentElement.scrollWidth, viewport: innerWidth, notice: rect(document.querySelector('#appUpdateNotice')), tabs: rect(document.querySelector('#tabs')) };
    })()`);
    assert.deepEqual(updateLayout.ids, [1,1,1], 'update controls remain unique');
    assert.deepEqual(updateLayout.notes, notes.slice(0,3), 'only three plain-text notes render');
    assert.equal(updateLayout.html, false); assert.equal(updateLayout.executed, false, 'release note HTML is inert text');
    assert.ok(updateLayout.width <= updateLayout.viewport, 'long release notes do not overflow');
    assert.ok(updateLayout.notice.top >= 0 && updateLayout.notice.bottom <= 44 && updateLayout.notice.right <= updateLayout.tabs.left, `${width}px update notice stays inside the tab bar without overlapping tabs`);
    const [welcome, updatePanel, search] = updateLayout.children;
    if (width > 1120) {
      assert.ok(welcome.right <= updatePanel.left && updatePanel.right <= search.left, 'update panel occupies the center header column');
    } else if (width <= 800) {
      assert.ok(welcome.bottom <= updatePanel.top && updatePanel.bottom <= search.top, 'small header follows title-update-search order');
    } else {
      assert.ok(welcome.right <= updatePanel.left && search.top >= Math.max(welcome.bottom, updatePanel.bottom), 'medium header keeps search below title and update');
    }
    shellContents.send('desktop:state', { appUpdate: { phase: 'idle', message: '앱 업데이트를 확인할 수 있습니다.' } });
    await waitFor(() => shellContents.executeJavaScript("document.querySelector('#appUpdateNotes li')?.textContent === '확인 필요 지침도 홈에 표시하고 상황·처리 방법을 보여줍니다.'"), 'installed-version note fallback');
    await capture(sourceWindow.win, filename);
  };
  await assertShellWidth(1920, 'shell-1920x1080.png');
  await assertShellWidth(1024, 'shell-1024x1080.png');
  await assertShellWidth(800, 'shell-800x1080.png');

  // Overflow tabs reveal a new selection, but leave a manually browsed strip alone.
  const overflowTabs = [];
  for (let i = 0; i < 10; i++) {
    main.command(sourceWindow, 'open', { url: `/test/fixture?overflow=${i}`, title: `가로 탭 확인 ${i}` });
    overflowTabs.push(sourceWindow.activeId);
  }
  const lastOverflow = overflowTabs.at(-1);
  const tabVisible = id => shellContents.executeJavaScript(`(() => {
    const root = document.querySelector('#tabs');
    const item = root.querySelector('[data-id="${id}"]');
    if (!item) return false;
    const r = root.getBoundingClientRect(), t = item.getBoundingClientRect();
    return t.left >= r.left - 1 && t.right <= r.right + 1;
  })()`);
  await waitFor(() => tabVisible(lastOverflow), 'new active overflow tab is visible');
  await waitFor(() => overflowTabs.every(id => !main.tabs.get(id)?.loading), 'overflow fixtures finish loading');
  await shellContents.executeJavaScript(`document.querySelector('[data-id="${first.id}"] .tab-main').focus(); document.querySelector('#tabs').scrollLeft = 0`);
  main.command(sourceWindow, 'rename', { id: lastOverflow, title: '주기적 상태 변경 후 탭' });
  await waitFor(() => shellContents.executeJavaScript(`document.querySelector('[data-id="${lastOverflow}"] .tab-text')?.textContent === '주기적 상태 변경 후 탭'`), 'tab title update rendered');
  const manualStrip = await shellContents.executeJavaScript(`({ scroll: document.querySelector('#tabs').scrollLeft, focused: document.activeElement.closest('.tab')?.dataset.id })`);
  assert.equal(manualStrip.scroll, 0, 'title/state redraw preserves manual scroll');
  assert.equal(manualStrip.focused, first.id, 'tab redraw preserves keyboard focus');
  main.command(sourceWindow, 'activate', { id: first.id });
  await waitFor(() => tabVisible(first.id), 'selecting first tab reveals it');
  main.command(sourceWindow, 'activate', { id: lastOverflow });
  await waitFor(() => tabVisible(lastOverflow), 'selecting last tab reveals it again');
  main.command(sourceWindow, 'activate', { id: first.id });

  // Ctrl+T reopens the menu from a focused workspace.
  console.log('Smoke: shell layout');
  main.command(sourceWindow, 'menu', { open: false });
  await waitFor(() => shellContents.executeJavaScript('!document.querySelector(".app-shell").classList.contains("menu-open")'), 'compact shell before Ctrl+T');
  shellContents.focus();
  shellContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] });
  shellContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control'] });
  await waitFor(() => sourceWindow.menuOpen, 'Ctrl+T menu shortcut');
  console.log('Smoke: keyboard');
  await waitFor(() => shellContents.executeJavaScript('document.querySelector(".app-shell").classList.contains("menu-open") && document.activeElement.id === "menuSearch"'), 'Ctrl+T moves focus to menu search').catch(async error => {
    console.error('Menu focus diagnostic', await shellContents.executeJavaScript('({active:document.activeElement.outerHTML,menu:document.querySelector(".app-shell").classList.contains("menu-open"),visible:!document.querySelector("#home").hidden})')); throw error;
  });
  console.log('Smoke: menu search focused');
  // The focus assertion already establishes DOM readiness. Do not wait for an
  // animation frame here: an occluded native window can suspend rAF indefinitely.
  await shellContents.executeJavaScript(`document.querySelector('[data-id="${first.id}"] .tab-main').focus()`);
  await waitFor(() => shellContents.executeJavaScript(`document.activeElement.matches('.tab-main') && document.activeElement.closest('.tab')?.dataset.id === ${JSON.stringify(first.id)}`), 'tab focus settles before F2');
  shellContents.sendInputEvent({ type: 'keyDown', keyCode: 'F2' });
  shellContents.sendInputEvent({ type: 'keyUp', keyCode: 'F2' });
  await waitFor(() => shellContents.executeJavaScript('Boolean(document.querySelector(".tab-rename"))'), 'F2 name editor');
  console.log('Smoke: F2 editor ready');
  await shellContents.executeJavaScript('document.querySelector(".tab-rename").value = "키보드 이름"');
  shellContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  shellContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(() => first.title === '키보드 이름', 'keyboard rename');
  console.log('Smoke: F2 name saved');
  const beforeKeyboardReorder = sourceWindow.ids.indexOf(first.id);
  assert.ok(beforeKeyboardReorder > 0);
  await shellContents.executeJavaScript(`document.querySelector('[data-id="${first.id}"] .tab-main').focus()`);
  shellContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['control', 'shift'] });
  shellContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['control', 'shift'] });
  await waitFor(() => sourceWindow.ids.indexOf(first.id) === beforeKeyboardReorder - 1, 'keyboard tab reorder');

  // A close confirmation can be cancelled, then accepted and completed.
  dialog.showMessageBoxSync = (_window, options) => { assert.deepEqual(options.buttons, ['닫기', '취소']); assert.equal(options.cancelId, 1); assert.equal(options.defaultId, 0, 'Enter defaults to close while Escape cancels'); return dialogAnswer; };
  dialogAnswer = 1;
  console.log('Smoke: cancel close begin');
  main.command(sourceWindow, 'close', { id: second.id });
  console.log('Smoke: cancel close returned');
  assert.ok(main.tabs.has(second.id), 'cancelled close retains tab');
  dialogAnswer = 0;
  second.view.webContents.on('will-prevent-unload', () => console.log('Smoke: second will-prevent-unload'));
  second.view.webContents.on('close', () => console.log('Smoke: second close event'));
  second.view.webContents.on('destroyed', () => console.log('Smoke: second destroyed event'));
  console.log('Smoke: confirm close begin');
  main.command(sourceWindow, 'close', { id: second.id });
  console.log('Smoke: confirm close returned');
  await waitFor(() => !main.tabs.has(second.id), 'confirmed tab close');
  console.log('Smoke: close confirmation');

  // A page-level beforeunload veto can cancel an already confirmed generic close.
  main.command(sourceWindow, 'open', { url: '/test/beforeunload', title: '저장 확인' });
  const guardedTab = [...main.tabs.values()].find(tab => new URL(tab.url).pathname === '/test/beforeunload');
  assert.ok(guardedTab);
  await waitForTab(guardedTab, async tab => !tab.loading && await tab.view.webContents.executeJavaScript('Boolean(document.querySelector("#smoke-input"))'), 'beforeunload fixture content');
  await guardedTab.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value='beforeunload 값'; window.__blockUnload=true`);
  const confirmAnswers = [0, 1];
  dialog.showMessageBoxSync = () => confirmAnswers.shift() ?? 1;
  main.command(sourceWindow, 'close', { id: guardedTab.id });
  await delay(400);
  assert.ok(main.tabs.has(guardedTab.id), 'beforeunload cancellation leaves the tab registered');
  assert.equal(await guardedTab.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value`), 'beforeunload 값');
  await guardedTab.view.webContents.executeJavaScript(`window.__blockUnload=false`);
  dialog.showMessageBoxSync = () => 0;
  main.command(sourceWindow, 'close', { id: guardedTab.id });
  await waitFor(() => !main.tabs.has(guardedTab.id), 'beforeunload tab close after page allows it');
  console.log('Smoke: unload guard');

  // Closing an empty secondary window must not touch a destroyed BrowserWindow.
  assert.ok(detachedWindow && !detachedWindow.win.isDestroyed());
  detachedWindow.win.close();
  await waitFor(() => !main.windows.has(detachedWindow.id) && detachedWindow.win.isDestroyed(), 'empty secondary window close');
  console.log('Smoke: secondary close');

  // Change accounts while auth is deliberately pending. The old account is
  // locked immediately, writes are blocked, then its views and origin storage
  // are cleared before the new account becomes active. Keep an A bootstrap
  // response pending across that transition to prove it cannot overwrite B.
  const heldHomeUi = holdHome(request => request.method === 'GET' && request.date === HOME_DATE);
  await shellContents.executeJavaScript(`document.querySelector('.hw-add>input').value = '계정 A의 남은 입력'; document.querySelector('.hw-add>input').dispatchEvent(new Event('input',{bubbles:true}))`);
  main.command(sourceWindow, 'menu', { open: true });
  await waitFor(() => heldHomeUi.started, 'account A UI refresh held across authentication change');
  const heldHomeRead = holdHome(request => request.method === 'GET' && request.date === '2026-10-08');
  const heldHomeWrite = holdHome(request => request.body?.requestId === 'smoke-home-delayed-write');
  // Attach rejection handlers immediately so the harness's unhandled trap stays meaningful.
  const oldHomeRead = homeIpc(shellContents, { method: 'GET', date: '2026-10-08' }).then(value => ({ value }), error => ({ error: error.message }));
  const oldHomeWrite = homeIpc(shellContents, { method: 'POST', command: { action: 'read', sourceKey: 'feedback:smoke-1',
    date: HOME_DATE, requestId: 'smoke-home-delayed-write', expectedRevision: homeStore(accountActor).revision } }).then(value => ({ value }), error => ({ error: error.message }));
  await waitFor(() => heldHomeRead.started && heldHomeWrite.started, 'account A delayed home GET and POST');
  holdAccountABootstrap = true;
  accountABootstrapStarted = false;
  const accountASync = main.verifyAccount();
  await waitFor(() => accountABootstrapStarted, 'account A bootstrap request');
  accountActor = 'desktop-test-b';
  holdAccountBAuth = true;
  accountBAuthStarted = false;
  await workSession.cookies.set({ url: ORIGIN, name: 'nenovaToken', value: 'fixture-account-b', secure: true, httpOnly: true });
  await waitFor(() => accountBAuthStarted, 'account B authentication request');
  assert.equal(main.command(sourceWindow, 'state', {}).online, false, 'old account is locked during pending authentication');
  assert.equal(main.command(sourceWindow, 'state', {}).homeOwnerId, '', 'pending auth exposes no home owner');
  await waitFor(() => shellContents.executeJavaScript('document.querySelectorAll(".hw-task").length === 0 && document.querySelector(".hw-add>input").value === "" && document.querySelector(".hw-add>button").disabled'), 'auth lock removes previous home tasks and drafts');
  await assert.rejects(homeIpc(shellContents, { method: 'GET', date: HOME_DATE }), 'locked home bridge rejects reads');
  await assert.rejects(workSession.fetch(`${ORIGIN}/api/smoke-mutation`, { method: 'POST', body: 'blocked' }));
  assert.equal(fixtureRequests.some(request => request.pathname === '/api/smoke-mutation' && request.method === 'POST'), false, 'locked session sends no mutation request');
  assert.ok(main.tabs.has(first.id), 'old tab remains tracked while auth is pending');
  holdAccountBAuth = false;
  releaseAccountBAuth();
  await waitFor(() => main.snapshot().actor === 'desktop-test-b', 'account B activation');
  heldHomeRead.release(); heldHomeWrite.release(); heldHomeUi.release();
  const [staleRead, staleWrite] = await Promise.all([oldHomeRead, oldHomeWrite]);
  assert.ok(staleRead.error && !staleRead.value, 'old account home GET cannot return data after account switch');
  assert.ok(staleWrite.error && !staleWrite.value, 'old account home POST cannot expose its response after account switch');
  const newHome = await homeIpc(shellContents, { method: 'GET', date: HOME_DATE });
  assert.equal(newHome.ownerId, 'desktop-test-b');
  assert.equal(newHome.tasks.length, 1, 'new account has only its own fixture tasks');
  assert.equal(newHome.tasks[0].id, 'desktop-test-b-task');
  await waitFor(() => shellContents.executeJavaScript('document.querySelector(".hw-rows").textContent.includes("desktop-test-b 확인 업무")'), 'account B UI shows its own home snapshot');
  assert.equal(await shellContents.executeJavaScript('document.querySelector("#homeWorkspace").textContent.includes("UI 저장 실패 후 재시도") || document.querySelector("#homeWorkspace").textContent.includes("IPC 생성 업무")'), false, 'late account A results do not leak into B home');
  assert.equal(main.command(sourceWindow, 'state', {}).menuVersion, 'd'.repeat(64), 'account B menu wins while the earlier account A bootstrap is pending');
  holdAccountABootstrap = false;
  releaseAccountABootstrap();
  await accountASync;
  assert.equal(main.snapshot().actor, 'desktop-test-b', 'stale account A response cannot switch the active actor back');
  assert.equal(main.command(sourceWindow, 'state', {}).menuVersion, 'd'.repeat(64), 'stale account A response cannot overwrite account B menu');
  assert.equal(main.tabs.has(first.id), false, 'account switch removes old WebContents tabs');
  assert.ok(firstContents.isDestroyed(), 'old account WebContents is destroyed');
  main.command(sourceWindow, 'open', { url: '/test/second', title: '계정 B 저장소 확인' });
  const accountBTab = [...main.tabs.values()].find(tab => new URL(tab.url).pathname === '/test/second');
  assert.ok(accountBTab);
  await waitForTab(accountBTab, async tab => !tab.loading && await tab.view.webContents.executeJavaScript('Boolean(document.querySelector("#smoke-input"))'), 'account B fixture content');
  assert.equal(await accountBTab.view.webContents.executeJavaScript(`localStorage.getItem('account-specific-value')`), null, 'account A localStorage is cleared before account B content loads');

  console.log('Electron smoke passed: personal home native IPC/UI/failure retry/account races, tab lifecycle, isolated zoom and web globals, same-origin popup opener, account transition lock/storage clear, viewport overflow, and unload/close confirmation.');
  console.log(`Screenshots: ${OUTPUT}`);
}

// Register the isolated fixture session before main.cjs installs its own
// app-ready callback, while still loading main.cjs before Electron is ready
// so its privileged app-scheme registration remains valid.
app.whenReady().then(installFixtureProtocol);
main = require('../main.cjs');
app.whenReady().then(() => run()).then(() => app.exit(0)).catch(error => {
  console.error('Electron smoke failed:', error && error.stack || error);
  app.exit(1);
});

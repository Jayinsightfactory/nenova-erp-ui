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
let dialogAnswer = 0;
let accountActor = 'desktop-test';
let holdAccountBAuth = false;
let accountBAuthStarted = false;
let releaseAccountBAuth;
const fixtureRequests = [];
let main;
dialog.showMessageBoxSync = () => dialogAnswer;

app.setPath('userData', USER_DATA);
app.setPath('sessionData', USER_DATA);
app.setName('Nenova Desktop Smoke');

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
  // The session protocol hook catches every HTTPS request, including any URL
  // the application might construct. No request can reach the real service.
  workSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== ORIGIN) return new Response('Blocked by smoke fixture', { status: 403 });
    fixtureRequests.push({ method: request.method, pathname: url.pathname });
    if (url.pathname === '/api/auth/me') {
      if (accountActor === 'desktop-test-b' && holdAccountBAuth) {
        accountBAuthStarted = true;
        await new Promise(resolve => { releaseAccountBAuth = resolve; });
      }
      return Response.json({ success: true, user: { userId: accountActor, userName: accountActor } });
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

  const shellContents = sourceWindow.win.webContents;
  console.log('Smoke: popup opener');
  const assertShellWidth = async (width, filename) => {
    sourceWindow.win.setContentSize(width, 1080);
    await delay(150);
    const dims = await shellContents.executeJavaScript('({innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth})');
    assert.ok(dims.documentWidth <= dims.innerWidth, `${width}px shell horizontal overflow: ${JSON.stringify(dims)}`);
    assert.ok(dims.bodyWidth <= dims.innerWidth, `${width}px body horizontal overflow: ${JSON.stringify(dims)}`);
    for (const open of [true, false]) {
      main.command(sourceWindow, 'menu', { open });
      await delay(50);
      const footer = await shellContents.executeJavaScript('({top:document.querySelector(".statusbar").getBoundingClientRect().top,bottom:document.querySelector(".statusbar").getBoundingClientRect().bottom,height:innerHeight})');
      assert.equal(footer.top, footer.height - 28, `footer top, menu=${open}`);
      assert.equal(footer.bottom, footer.height, `footer bottom, menu=${open}`);
    }
    main.command(sourceWindow, 'menu', { open: true });
    await delay(100);
    await capture(sourceWindow.win, filename);
  };
  await assertShellWidth(1920, 'shell-1920x1080.png');
  await assertShellWidth(800, 'shell-800x1080.png');

  // Ctrl+T reopens the menu from a focused workspace.
  console.log('Smoke: shell layout');
  main.command(sourceWindow, 'menu', { open: false });
  shellContents.focus();
  shellContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] });
  shellContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control'] });
  await waitFor(() => sourceWindow.menuOpen, 'Ctrl+T menu shortcut');
  console.log('Smoke: keyboard');
  await waitFor(() => shellContents.executeJavaScript('document.activeElement.id === "menuSearch"'), 'menu keyboard focus');
  await shellContents.executeJavaScript(`document.querySelector('[data-id="${first.id}"] .tab-main').focus()`);
  shellContents.sendInputEvent({ type: 'keyDown', keyCode: 'F2' });
  shellContents.sendInputEvent({ type: 'keyUp', keyCode: 'F2' });
  await waitFor(() => shellContents.executeJavaScript('Boolean(document.querySelector(".tab-rename"))'), 'F2 name editor');
  await shellContents.executeJavaScript('document.querySelector(".tab-rename").value = "키보드 이름"');
  shellContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  shellContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await waitFor(() => first.title === '키보드 이름', 'keyboard rename');
  const beforeKeyboardReorder = sourceWindow.ids.indexOf(first.id);
  assert.ok(beforeKeyboardReorder > 0);
  await shellContents.executeJavaScript(`document.querySelector('[data-id="${first.id}"] .tab-main').focus()`);
  shellContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left', modifiers: ['control', 'shift'] });
  shellContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left', modifiers: ['control', 'shift'] });
  await waitFor(() => sourceWindow.ids.indexOf(first.id) === beforeKeyboardReorder - 1, 'keyboard tab reorder');

  // A close confirmation can be cancelled, then accepted and completed.
  dialog.showMessageBoxSync = () => dialogAnswer;
  dialogAnswer = 0;
  console.log('Smoke: cancel close begin');
  main.command(sourceWindow, 'close', { id: second.id });
  console.log('Smoke: cancel close returned');
  assert.ok(main.tabs.has(second.id), 'cancelled close retains tab');
  dialogAnswer = 1;
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
  const confirmAnswers = [1, 0];
  dialog.showMessageBoxSync = () => confirmAnswers.shift() ?? 0;
  main.command(sourceWindow, 'close', { id: guardedTab.id });
  await delay(400);
  assert.ok(main.tabs.has(guardedTab.id), 'beforeunload cancellation leaves the tab registered');
  assert.equal(await guardedTab.view.webContents.executeJavaScript(`document.querySelector('#smoke-input').value`), 'beforeunload 값');
  await guardedTab.view.webContents.executeJavaScript(`window.__blockUnload=false`);
  dialog.showMessageBoxSync = () => 1;
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
  // are cleared before the new account becomes active.
  accountActor = 'desktop-test-b';
  holdAccountBAuth = true;
  accountBAuthStarted = false;
  await workSession.cookies.set({ url: ORIGIN, name: 'nenovaToken', value: 'fixture-account-b', secure: true, httpOnly: true });
  await waitFor(() => accountBAuthStarted, 'account B authentication request');
  assert.equal(main.command(sourceWindow, 'state', {}).online, false, 'old account is locked during pending authentication');
  await assert.rejects(workSession.fetch(`${ORIGIN}/api/smoke-mutation`, { method: 'POST', body: 'blocked' }));
  assert.equal(fixtureRequests.some(request => request.pathname === '/api/smoke-mutation' && request.method === 'POST'), false, 'locked session sends no mutation request');
  assert.ok(main.tabs.has(first.id), 'old tab remains tracked while auth is pending');
  holdAccountBAuth = false;
  releaseAccountBAuth();
  await waitFor(() => main.snapshot().actor === 'desktop-test-b', 'account B activation');
  assert.equal(main.tabs.has(first.id), false, 'account switch removes old WebContents tabs');
  assert.ok(firstContents.isDestroyed(), 'old account WebContents is destroyed');
  main.command(sourceWindow, 'open', { url: '/test/second', title: '계정 B 저장소 확인' });
  const accountBTab = [...main.tabs.values()].find(tab => new URL(tab.url).pathname === '/test/second');
  assert.ok(accountBTab);
  await waitForTab(accountBTab, async tab => !tab.loading && await tab.view.webContents.executeJavaScript('Boolean(document.querySelector("#smoke-input"))'), 'account B fixture content');
  assert.equal(await accountBTab.view.webContents.executeJavaScript(`localStorage.getItem('account-specific-value')`), null, 'account A localStorage is cleared before account B content loads');

  console.log('Electron smoke passed: tab lifecycle, isolated zoom and web globals, same-origin popup opener, account transition lock/storage clear, viewport overflow, and unload/close confirmation.');
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

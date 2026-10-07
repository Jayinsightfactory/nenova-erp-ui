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
let bootstrapOverride = null;
let holdAccountBAuth = false;
let accountBAuthStarted = false;
let releaseAccountBAuth;
let holdAccountABootstrap = false;
let accountABootstrapStarted = false;
let releaseAccountABootstrap;
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
  assert.match(await first.view.webContents.executeJavaScript('navigator.userAgent'), /NenovaDesktop\/1\.2\.0/, 'business session UA identifies desktop 1.2');
  assert.equal(first.view.getBounds().y, 44, 'compact tab workspace starts below the 44px tab bar');
  assert.equal(first.view.getBounds().height, 1036, 'compact tab workspace uses the remaining 1036px');
  const shellContents = sourceWindow.win.webContents;
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
    await capture(sourceWindow.win, filename);
  };
  await assertShellWidth(1920, 'shell-1920x1080.png');
  await assertShellWidth(800, 'shell-800x1080.png');

  // Ctrl+T reopens the menu from a focused workspace.
  console.log('Smoke: shell layout');
  main.command(sourceWindow, 'menu', { open: false });
  await waitFor(() => shellContents.executeJavaScript('!document.querySelector(".app-shell").classList.contains("menu-open")'), 'compact shell before Ctrl+T');
  shellContents.focus();
  shellContents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control'] });
  shellContents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control'] });
  await waitFor(() => sourceWindow.menuOpen, 'Ctrl+T menu shortcut');
  console.log('Smoke: keyboard');
  await waitFor(() => shellContents.executeJavaScript('document.querySelector(".app-shell").classList.contains("menu-open") && document.activeElement.id === "menuSearch"'), 'Ctrl+T moves focus to menu search');
  await shellContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await shellContents.executeJavaScript(`document.querySelector('[data-id="${first.id}"] .tab-main').focus()`);
  await waitFor(() => shellContents.executeJavaScript(`document.activeElement.matches('.tab-main') && document.activeElement.closest('.tab')?.dataset.id === ${JSON.stringify(first.id)}`), 'tab focus settles before F2');
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
  // are cleared before the new account becomes active. Keep an A bootstrap
  // response pending across that transition to prove it cannot overwrite B.
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
  await assert.rejects(workSession.fetch(`${ORIGIN}/api/smoke-mutation`, { method: 'POST', body: 'blocked' }));
  assert.equal(fixtureRequests.some(request => request.pathname === '/api/smoke-mutation' && request.method === 'POST'), false, 'locked session sends no mutation request');
  assert.ok(main.tabs.has(first.id), 'old tab remains tracked while auth is pending');
  holdAccountBAuth = false;
  releaseAccountBAuth();
  await waitFor(() => main.snapshot().actor === 'desktop-test-b', 'account B activation');
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

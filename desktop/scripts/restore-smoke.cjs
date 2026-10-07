'use strict';

// One phase of the separate-process persistence smoke. The runner invokes this
// twice with the same isolated profile: first `write`, then `read`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, session, safeStorage } = require('electron');

const ORIGIN = 'https://nenovaweb.com';
const PHASE = process.argv[2];
const PROFILE = path.resolve(process.argv[3] || '');
const ACTOR = 'restore-test';
const PLAINTEXT_SENTINEL = 'NEVER_PERSIST_FORM_VALUE_74cc';
const TITLE_2025 = 'Restore fixture 2025 title';
const TITLE_2026 = 'Restore fixture 2026 title';
const requests = [];
let main;

function assertIsTestProfile() {
  const tmp = path.resolve(os.tmpdir());
  const relative = path.relative(tmp, PROFILE);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'profile must be inside the OS temp directory');
  assert.ok(path.basename(PROFILE).startsWith('nenova-restore-smoke-'), 'profile must use the restore smoke prefix');
  assert.ok(PHASE === 'write' || PHASE === 'read', 'phase must be write or read');
}

app.setPath('userData', PROFILE);
app.setPath('sessionData', PROFILE);
app.setName('Nenova Desktop Restore Smoke');

function html(url) {
  const title = new URL(url).pathname.includes('2025') ? TITLE_2025 : TITLE_2026;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>
    <h1>${title}</h1><input id="unsaved-form-value" value="fixture initial form value">
    <script>window.__restoreFixtureReady=true; localStorage.setItem('restore-smoke-key','must-not-be-in-snapshot');</script>
    </body></html>`;
}

function installFixtureProtocol() {
  const workSession = session.fromPartition('persist:nenova-work');
  workSession.protocol.handle('https', async request => {
    const url = new URL(request.url);
    if (url.origin !== ORIGIN) return new Response('Blocked by restore fixture', { status: 403 });
    requests.push({ method: request.method, pathname: url.pathname });
    if (url.pathname === '/api/auth/me') return Response.json({ success: true, user: { userId: ACTOR, userName: ACTOR } });
    if (url.pathname === '/api/desktop/bootstrap') return Response.json({
      success: true, schemaVersion: 1, user: { userId: ACTOR }, webVersion: 'web-1',
      menuVersion: 'c'.repeat(64), menus: [{ group: '업무', items: [{ href: '/test/orders', labelKey: 'orders', popup: false }] }],
    });
    if (url.pathname.startsWith('/api/')) return Response.json({ success: true, data: [] });
    return new Response(html(url.href), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(predicate, description, timeoutMs = 12000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { const value = await predicate(); if (value) return value; } catch { /* Wait for Electron navigation and restore work to settle. */ }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function waitForTab(tab, description) {
  await waitFor(async () => !tab.loading && await tab.view.webContents.executeJavaScript('window.__restoreFixtureReady === true'), description);
}

async function writePhase() {
  await waitFor(() => main.windows.size === 1, 'initial window');
  await main.verifyAccount(true);
  await waitFor(() => main.snapshot().actor === ACTOR, 'matching restore actor');
  const firstWindow = [...main.windows.values()][0];
  firstWindow.win.setContentSize(1920, 1080);

  main.command(firstWindow, 'open', {
    url: '/test/orders?year=2025&week=1&orderYear=2025&orderWeek=1', title: TITLE_2025,
  });
  const tab2025 = [...main.tabs.values()].find(tab => new URL(tab.url).searchParams.get('year') === '2025');
  assert.ok(tab2025, '2025 week 1 tab was created');
  await waitForTab(tab2025, '2025 fixture content');
  await tab2025.view.webContents.executeJavaScript(`document.querySelector('#unsaved-form-value').value=${JSON.stringify(PLAINTEXT_SENTINEL)}`);
  main.command(firstWindow, 'zoom', { id: tab2025.id, value: 1.2 });
  main.command(firstWindow, 'favorite', { id: tab2025.id });

  main.command(firstWindow, 'open', {
    url: '/test/orders?year=2026&week=1&orderYear=2026&orderWeek=1', title: TITLE_2026,
  });
  const tab2026 = [...main.tabs.values()].find(tab => new URL(tab.url).searchParams.get('year') === '2026');
  assert.ok(tab2026, '2026 week 1 tab was created');
  await waitForTab(tab2026, '2026 fixture content');
  main.command(firstWindow, 'zoom', { id: tab2026.id, value: 0.9 });

  const secondWindow = main.createWindow();
  secondWindow.win.setContentSize(1920, 1080);
  main.command(secondWindow, 'open', { url: '/test/shipment?year=2026&week=1', title: '출고창 2026 차수 1' });
  const shipmentTab = [...main.tabs.values()].find(tab => new URL(tab.url).pathname === '/test/shipment');
  assert.ok(shipmentTab);
  await waitForTab(shipmentTab, 'second-window fixture content');

  const statePath = path.join(PROFILE, 'workspace.encrypted');
  // The normal main-process debounce is 500 ms. Wait for its encrypted write.
  await delay(900);
  await waitFor(() => fs.existsSync(statePath) && fs.statSync(statePath).size > 0, 'encrypted workspace state');
  const encrypted = fs.readFileSync(statePath);
  const encryptedText = encrypted.toString('utf8');
  for (const plaintext of [TITLE_2025, TITLE_2026, '/test/orders', ORIGIN, PLAINTEXT_SENTINEL]) {
    assert.equal(encryptedText.includes(plaintext), false, `encrypted file does not expose ${plaintext}`);
  }
  assert.ok(safeStorage.isEncryptionAvailable(), 'Electron safeStorage is available');
  const decrypted = JSON.parse(safeStorage.decryptString(encrypted));
  assert.deepEqual(Object.keys(decrypted).sort(), ['actor', 'favorites', 'version', 'windows']);
  assert.equal(decrypted.actor, ACTOR);
  assert.equal(decrypted.version, 1);
  assert.equal(decrypted.windows.length, 2);
  assert.deepEqual(decrypted.windows.map(window => window.tabs.length), [2, 1]);
  assert.equal(decrypted.favorites.length, 1);
  assert.ok(decrypted.windows.flatMap(window => window.tabs).some(tab => tab.url.includes('year=2025') && tab.url.includes('week=1')));
  assert.ok(decrypted.windows.flatMap(window => window.tabs).some(tab => tab.url.includes('year=2026') && tab.url.includes('week=1')));
  assert.ok(decrypted.windows.flatMap(window => window.tabs).every(tab => Object.keys(tab).sort().join(',') === 'title,url,zoom'));
  assert.ok(decrypted.favorites.every(tab => Object.keys(tab).sort().join(',') === 'title,url,zoom'));
  assert.equal(JSON.stringify(decrypted).includes(PLAINTEXT_SENTINEL), false, 'unsaved form data is absent from the persisted snapshot');
  assert.ok(Math.abs(tab2025.view.webContents.getZoomFactor() - 1.2) < 0.001);
  assert.ok(Math.abs(tab2026.view.webContents.getZoomFactor() - 0.9) < 0.001);
  assert.equal(requests.some(request => request.method !== 'GET' && request.method !== 'HEAD'), false, 'write phase sent no mutation requests');
  console.log(`Write phase passed: encrypted snapshot at ${statePath}`);
}

async function readPhase() {
  const statePath = path.join(PROFILE, 'workspace.encrypted');
  assert.ok(fs.existsSync(statePath), 'write phase produced encrypted workspace state');
  await waitFor(() => main.windows.size === 2, 'two restored windows');
  await waitFor(() => main.snapshot().actor === ACTOR, 'restored matching actor');
  await waitFor(() => main.tabs.size === 3, 'three restored tabs');
  const tabs = [...main.tabs.values()];
  const tab2025 = tabs.find(tab => new URL(tab.url).searchParams.get('year') === '2025');
  const tab2026 = tabs.find(tab => new URL(tab.url).searchParams.get('year') === '2026' && new URL(tab.url).pathname === '/test/orders');
  const shipment = tabs.find(tab => new URL(tab.url).pathname === '/test/shipment');
  assert.ok(tab2025 && tab2026 && shipment, 'distinct cross-year week tabs and shipment tab restore');
  await Promise.all([waitForTab(tab2025, 'restored 2025 content'), waitForTab(tab2026, 'restored 2026 content'), waitForTab(shipment, 'restored shipment content')]);
  assert.equal(tab2025.title, TITLE_2025);
  assert.equal(tab2026.title, TITLE_2026);
  assert.ok(Math.abs(tab2025.view.webContents.getZoomFactor() - 1.2) < 0.001, '2025 tab zoom restores');
  assert.ok(Math.abs(tab2026.view.webContents.getZoomFactor() - 0.9) < 0.001, '2026 tab zoom restores');
  assert.ok(main.snapshot().favorites.some(item => item.title === TITLE_2025), 'favorite restores');
  assert.ok([...main.windows.values()].every(window => window.menuOpen), 'startup opens menus with favorites while retaining restored tabs');
  assert.equal(new Set(tabs.map(tab => tab.windowId)).size, 2, 'tabs restore across both windows');
  assert.equal(tabs.filter(tab => tab.windowId === tab2025.windowId || tab.windowId === tab2026.windowId).length, 2, 'cross-year tabs remain in their original window');
  assert.equal(await tab2025.view.webContents.executeJavaScript(`document.querySelector('#unsaved-form-value').value`), 'fixture initial form value', 'form fixture starts with its default value, not prior unsaved edits');
  assert.equal(JSON.stringify(main.snapshot()).includes(PLAINTEXT_SENTINEL), false);
  assert.equal(requests.some(request => request.method !== 'GET' && request.method !== 'HEAD'), false, 'read phase sent no mutation requests');
  console.log('Read phase passed: matching actor restored tabs, windows, favorite, cross-year routes, and isolated zoom.');
}

assertIsTestProfile();
app.whenReady().then(installFixtureProtocol);
main = require('../main.cjs');
app.whenReady().then(async () => {
  if (PHASE === 'write') await writePhase();
  else await readPhase();
  app.exit(0);
}).catch(error => {
  console.error(`Restore smoke ${PHASE} phase failed:`, error && error.stack || error);
  app.exit(1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { savePasteWorkspace, loadPasteWorkspace, buildPasteWorkspaceFingerprint } = require('../lib/pasteWorkspace');
const root = path.resolve(__dirname, '..');
const actor = 'paste-current-name-fixture', week = '2026-41-02';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('current DB names refresh restored completed paste work without changing mapping or replaying writes', { timeout: 180000 }, async () => {
  const port = 40100 + Math.floor(Math.random() * 700);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '-p', String(port)], { cwd: root, windowsHide: true, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      if (server.exitCode != null) throw Error('Next exited');
      try { if ((await fetch(base)).ok) break; } catch {}
      await pause(500);
    }
    browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const orders = [{ id: 0, custName: '미우 원문', custMatch: { CustKey: 456, CustName: '옛 업체명', CustArea: '보존지역' }, distributionCompleted: true, items: [{ idx: 0, inputName: '문라이트 원문', prodKey: 447, prodName: 'OLD PRODUCT', displayName: '옛 품목명', qty: 3, unit: '단', cost: 700, action: '추가', manualMatch: true, skip: false }] }];
    const pasteText = '41-2 미우 원문\n문라이트 원문 3단 추가';
    const state = { pasteText, orders, evidenceMessages: [], baseStockText: '문라이트 원문 10', baseStockMatches: [], bulkResult: { orderId: 'ALL', verified: true, okCount: 1, failCount: 0, details: [{ orderId: 0, custKey: 456, prodKey: 447, qty: 3, unit: '단', type: 'ADD', ok: true }] } };
    const storage = { data: {}, setItem(k,v) { this.data[k] = v; }, getItem(k) { return this.data[k] || null; } };
    savePasteWorkspace(storage, { actorId: actor, week, state, completionFingerprint: buildPasteWorkspaceFingerprint({ week, ...state }) });
    await context.addInitScript(({ data, actor }) => {
      if (!localStorage.getItem('current-names-seeded')) {
        for (const [key,value] of Object.entries(data)) localStorage.setItem(key,value);
        localStorage.setItem('current-names-seeded','1');
      }
      localStorage.setItem('nenovaUser', JSON.stringify({ userId: actor, userName: 'fixture', authority: 1 }));
    }, { data: storage.data, actor });
    let revision = 1, failCatalog = false, catalogReads = 0, analyses = 0;
    const writes = [], errors = [];
    await context.route('**/api/**', async route => {
      const req = route.request(), u = new URL(req.url());
      const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
      if (u.pathname === '/api/orders/distribution-live-history') return reply({ success: true, items: [], scope: { year: '2026', weeks: ['41-02'] }, warnings: [] });
      if (u.pathname === '/api/orders/paste-preanalysis') { analyses++; return reply({ success: false, error: 'Completed work must not reanalyse' }, 409); }
      if (req.method() !== 'GET') { writes.push(u.pathname); return reply({ success: false, error: 'writes forbidden' }, 405); }
      if (u.pathname === '/api/auth/me') return reply({ success: true, user: { userId: actor, userName: 'fixture', authority: 1 } });
      if (u.pathname === '/api/orders/weeks') return reply({ success: true, weeks: [week, '2025-41-02'] });
      if (u.pathname === '/api/master') {
        catalogReads++;
        if (failCatalog) return reply({ success: false, error: 'fixture catalog unavailable' }, 503);
        return reply({ success: true, data: u.searchParams.get('entity') === 'products'
          ? [{ ProdKey: 447, ProdName: `CURRENT PRODUCT ${revision}`, DisplayName: revision === 1 ? '최신 품목명' : null, OutUnit: '박스', Cost: 999, BunchOf1Box: 20 }, ...(revision > 1 ? [{ ProdKey: 998, ProdName: '문라이트 원문', DisplayName: '새 후보', OutUnit: '단' }] : [])]
          : [{ CustKey: 456, CustName: `아이엠（미우）${revision}`, CustArea: '새지역' }] });
      }
      if (u.pathname === '/api/orders/mappings') return reply({ success: true, mappings: { '문라이트 원문': { prodKey: 447, prodName: `CURRENT PRODUCT ${revision}`, displayName: revision === 1 ? '최신 품목명' : null, savedAt: '2026-06-04T00:00:00Z', manual: true } } });
      if (u.pathname === '/api/orders/customer-mappings') return reply({ success: true, mappings: { 미우: { custKey: 456, custName: `아이엠（미우）${revision}`, savedAt: '2026-06-04T00:00:00Z' } } });
      if (u.pathname === '/api/kakao/sales-feed') return reply({ ok: true, messages: [], hasMore: false });
      if (u.pathname === '/api/orders/paste-history') return reply({ success: true, operations: [], hasMore: false });
      return reply({ success: true, data: [], orders: [], items: [], history: [], applications: [], mappings: {}, units: {}, favorites: [], rows: [], lease: { active: false }, digest: 'fixture' });
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/orders/paste`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-paste-order-status="DISTRIBUTED"]').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.paste-preview-customer')].some(el => el.textContent.includes('아이엠（미우）1')));
    await page.waitForFunction(() => [...document.querySelectorAll('.paste-preview-matched')].some(el => el.textContent.includes('최신 품목명')));
    const assertSaved = async () => {
      const data = await page.evaluate(() => ({ ...localStorage }));
      const saved = loadPasteWorkspace({ getItem: key => data[key] || null }, { actorId: actor, week });
      assert.ok(saved?.state.bulkResult?.verified, 'verified completion survives name refresh and storage');
      assert.equal(saved.state.orders[0].distributionCompleted, true);
      assert.equal(saved.state.orders[0].custMatch.CustKey, 456);
      assert.equal(saved.state.orders[0].items[0].prodKey, 447);
      assert.equal(saved.state.orders[0].items[0].qty, 3);
      assert.equal(saved.state.orders[0].items[0].unit, '단');
      assert.equal(saved.state.orders[0].items[0].cost, 700);
      assert.equal(saved.state.orders[0].items[0].inputName, '문라이트 원문');
      assert.equal(saved.state.baseStockText, '문라이트 원문 10');
      return saved;
    };
    await pause(500);
    const baseBeforeRefresh = (await assertSaved()).state.baseStockMatches;
    await page.locator('.paste-analyze-button').evaluate(el => el.click());
    await pause(100);
    assert.equal(analyses, 0, 'name-only refresh cannot reanalyse completed work');
    revision = 2;
    const beforeReads = catalogReads;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => [...document.querySelectorAll('.paste-preview-matched')].some(el => el.textContent.includes('CURRENT PRODUCT 2')));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-current-base-stock-name]')].some(el => el.textContent.includes('CURRENT PRODUCT 2')));
    assert.ok(catalogReads > beforeReads, 'focus re-reads current DB catalogs');
    await pause(500);
    assert.deepEqual((await assertSaved()).state.baseStockMatches, baseBeforeRefresh, 'catalog count change never rematches base-stock intent');
    failCatalog = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByText(/fixture catalog unavailable|최신.*실패|이름.*실패/).first().waitFor();
    assert.ok((await assertSaved()).state.orders[0].items[0].prodName.includes('2'), 'failed refresh keeps last good names');
    failCatalog = false;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('[data-paste-order-status="DISTRIBUTED"]').first().waitFor();
    await assertSaved();
    fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
    for (const size of [{width:1920,height:1080},{width:1366,height:768},{width:390,height:844}]) {
      await page.setViewportSize(size);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(root, 'outputs', `paste-current-names-${size.width}.png`) });
    }
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (process.platform === 'win32') await new Promise(resolve => { const kill=spawn('taskkill',['/pid',String(server.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'}); kill.on('close',resolve); });
    else server.kill('SIGTERM');
  }
});

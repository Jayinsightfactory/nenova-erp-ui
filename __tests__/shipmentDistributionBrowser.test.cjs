const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 39000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const bounded = (promise, label) => Promise.race([promise, pause(15000).then(() => { throw new Error(`Timed out: ${label}`); })]);
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

async function waitForServer(process) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (process.exitCode != null) throw new Error(`Next server exited (${process.exitCode})`);
    try { const response = await fetch(base); if (response.ok) return; } catch { /* starting */ }
    await pause(500);
  }
  throw new Error('Next server did not start');
}

test('distribution workspace keyboard, favorites, safe drafts, stale reads, and viewports', { timeout: 180000 }, async () => {
  const server = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '-p', String(port)], {
    cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  let browser;
  try {
    await waitForServer(server);
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    let userId = 'fixture-user-a';
    let shipmentQty = 48;
    let savePosts = 0;
    let failNextSave = true;
    let delayOldProducts = false;
    let holdNextQuery = false;
    const heldQueryStarted = deferred();
    const releaseHeldQuery = deferred();
    let holdNextSave = false;
    const heldSaveStarted = deferred();
    const releaseHeldSave = deferred();
    const oldProductsStarted = deferred();
    const releaseOldProducts = deferred();
    const spStarted = deferred();
    const releaseSp = deferred();
    const favorites = new Map([['fixture-user-a', []], ['fixture-user-b', []]]);
    let nextFavoriteKey = 1;
    const reply = (route, payload, status = 200) => route.fulfill({ status,
      contentType: 'application/json', body: JSON.stringify(payload) });
    await context.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const type = url.searchParams.get('type');
      if (url.pathname === '/api/auth/me') return reply(route, { success: true, user: { userId } });
      if (url.pathname === '/api/favorites') {
        if (request.method() === 'GET') return reply(route, { success: true,
          favorites: favorites.get(userId) || [] });
        const body = JSON.parse(request.postData() || '{}');
        if (request.method() === 'POST') {
          const row = { FavoriteKey: nextFavoriteKey++, FavName: body.name, FilterData: body.filterData };
          favorites.get(userId).push(row);
          return reply(route, { success: true, favoriteKey: row.FavoriteKey });
        }
        if (request.method() === 'DELETE') {
          favorites.set(userId, favorites.get(userId).filter(row => row.FavoriteKey !== body.favoriteKey));
          return reply(route, { success: true });
        }
      }
      if (url.pathname === '/api/shipment/ship-days') return reply(route, { success: true, configs: [] });
      if (url.pathname === '/api/shipment/fix' && request.method() === 'GET')
        return reply(route, { success: true, issueCount: 1, week: '2026-41-02', negative: [] });
      if (url.pathname === '/api/shipment/history') return reply(route, { success: true, history: [] });
      if (url.pathname === '/api/shipment/distribute-sp') {
        spStarted.resolve();
        await releaseSp.promise;
        return reply(route, { success: false, error: 'fixture SP blocked' }, 409);
      }
      if (url.pathname === '/api/shipment/distribute') {
        if (request.method() === 'POST') {
          savePosts += 1;
          const body = JSON.parse(request.postData() || '{}');
          assert.equal(body.year, '2026');
          assert.equal(body.week, '2026-41-02');
          if (body.entries.length === 1) {
            assert.equal(body.entries[0].outQty, 51, 'customer mode Ctrl+S submits customer draft');
            assert.equal(body.entries[0].cost, 100);
          } else {
            assert.equal(body.entries[0].outQty, 50);
            assert.equal(body.entries[0].cost, 700, 'quantity-only save preserves native customer price');
            assert.equal(body.entries[1].custKey, 436);
            assert.equal(body.entries[1].outQty, 0);
          }
          if (failNextSave) { failNextSave = false; return reply(route, { success: false, error: 'fixture 검증 실패' }, 409); }
          if (holdNextSave) { heldSaveStarted.resolve(); await releaseHeldSave.promise; holdNextSave = false; }
          shipmentQty = body.entries[0].outQty;
          return reply(route, { success: true, verified: true, results: [{ verified: true }] });
        }
        if (type === 'groups') return reply(route, { success: true, groups: [] });
        if (type === 'products') {
          const week = url.searchParams.get('week');
          if (week === '2026-41-02' && holdNextQuery) {
            holdNextQuery = false;
            heldQueryStarted.resolve();
            await releaseHeldQuery.promise;
          }
          if (week === '2026-41-02' && delayOldProducts) {
            oldProductsStarted.resolve();
            await releaseOldProducts.promise;
          }
          const products = week === '2026-42-01'
            ? [{ ProdKey: 53, ProdName: 'Carnation', OutUnit: '단', inQty: 10, outQty: 0 }]
            : [
              { ProdKey: 90, ProdName: 'Zinnia', OutUnit: '박스', inQty: 100, outQty: 0 },
              { ProdKey: 2429, ProdName: 'Alstroemeria', OutUnit: '단', Cost: 33, inQty: 100, outQty: shipmentQty },
            ];
          return reply(route, { success: true, products });
        }
        if (type === 'custList' || type === 'customers') return reply(route, { success: true,
          customers: [{ CustKey: 478, CustName: 'Alpha Florist' }, { CustKey: 436, CustName: 'Zulu Florist' }] });
        if (type === 'custDist') return reply(route, { success: true, totalOut: shipmentQty,
          customers: [{ CustKey: 478, CustName: 'Alpha Florist', 주문수량: 60, 출고수량: shipmentQty,
            OutUnit: '단', ShipmentDescr: '기존 출고 비고', 비고: '주문 메모', Cost: 700 },
          { CustKey: 436, CustName: 'Zulu Florist', 주문수량: 0, 출고수량: 0,
            OutUnit: '단', ShipmentDescr: '', 비고: '', Cost: 300 }] });
        if (type === 'custItems') return reply(route, { success: true, items: [{
          ProdKey: 2429, ProdName: 'Alstroemeria', OutUnit: '단', 주문수량: 60,
          출고수량: shipmentQty, ShipmentDescr: '기존 출고 비고', 비고: '주문 메모', Cost: 100,
        }] });
        if (type === 'shipmentFarms') return reply(route, { success: true, farms: [] });
      }
      return reply(route, { success: true });
    });

    await page.goto(`${base}/shipment/distribute`, { waitUntil: 'domcontentloaded' });
    console.log('browser: loaded');
    await page.getByTestId('distribution-week-picker').locator('button').first().click();
    await page.getByRole('button', { name: '2026-41-02', exact: true }).click();
    await page.getByRole('button', { name: '🔍 조회' }).click();
    await page.getByRole('button', { name: 'Alstroemeria 선택' }).waitFor();
    console.log('browser: candidates');
    const productButtons = await page.locator('tbody button[aria-label$="선택"]').allTextContents();
    assert.deepEqual(productButtons.slice(0, 2), ['Alstroemeria', 'Zinnia'], 'ProdName A-Z ignores stock and favorites');

    await page.keyboard.press('Control+Alt+2');
    const search = page.getByRole('textbox', { name: '품목 검색' });
    await search.fill('Alstro');
    await search.press('Enter');
    assert.match(await page.evaluate(() => document.activeElement?.textContent || ''), /Alstroemeria/);
    await page.keyboard.press('Space');
    await page.locator('[data-distribute-qty="true"]').first().waitFor();
    await page.keyboard.press('Control+Alt+4');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-distribute-qty')), 'true');
    await page.locator('[data-distribute-qty="true"]').first().fill('50');
    await page.getByText('미저장 48 → 50단').waitFor();
    const quantityInputs = page.locator('[data-distribute-qty="true"]');
    assert.equal(await quantityInputs.count(), 2);
    await quantityInputs.first().press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Zulu Florist')), true,
      'Enter moves to next visible quantity');
    await quantityInputs.last().press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-keyshortcuts')), 'Control+S',
      'last quantity Enter focuses Save');
    assert.equal(savePosts, 0, 'Enter navigation never auto-saves');
    console.log('browser: draft');
    fs.mkdirSync(path.join(root, 'outputs'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'outputs', 'distribution-workspace-1920.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('distribution-product-picker').locator('button').first().click();
    await page.waitForFunction(() => {
      const popup = document.querySelector('[role="group"][aria-label="품목 선택"]');
      const bounds = popup?.getBoundingClientRect();
      return bounds && bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
    });
    const popup = await page.getByRole('group', { name: '품목 선택' }).boundingBox();
    assert.ok(popup.x >= 0 && popup.x + popup.width <= 391, `mobile picker stays in viewport: ${JSON.stringify(popup)}`);
    await page.screenshot({ path: path.join(root, 'outputs', 'distribution-workspace-390.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1920, height: 1080 });
    assert.equal(savePosts, 0, 'typing quantity never writes ERP');

    await page.getByRole('button', { name: 'Alstroemeria 즐겨찾기 추가' }).click();
    await page.getByRole('button', { name: 'Alstroemeria 즐겨찾기 해제' }).waitFor();
    await page.getByRole('button', { name: '★ 즐겨찾기만' }).click();
    assert.equal(await page.getByRole('button', { name: 'Zinnia 선택' }).count(), 0, 'favorites filter keeps A-Z subset');
    console.log('browser: favorites');
    userId = 'fixture-user-b';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByText('이 차수에 즐겨찾기 품목이 없습니다.').waitFor();
    assert.equal(favorites.get('fixture-user-b').length, 0, 'favorites are account scoped');
    await page.getByRole('button', { name: '★ 즐겨찾기만' }).click();
    await page.getByRole('button', { name: 'Alstroemeria 즐겨찾기 추가' }).waitFor();
    userId = 'fixture-user-a';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: 'Alstroemeria 즐겨찾기 해제' }).waitFor();

    await page.keyboard.press('Control+s');
    await page.getByText('fixture 검증 실패').waitFor();
    assert.equal(await page.locator('[data-distribute-qty="true"]').first().inputValue(), '50', 'failed save preserves draft');
    await page.getByText('미저장 48 → 50단').waitFor();
    holdNextSave = true;
    await page.keyboard.press('Control+s');
    await bounded(heldSaveStarted.promise, 'held save POST');
    console.log('browser: held save');
    assert.equal(await page.locator('[data-distribute-qty="true"]').first().isDisabled(), true, 'draft quantity locks during save');
    assert.equal(await page.getByRole('button', { name: '화면 비율계산' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '주문수량 채우기' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '🔄 개별 초기화' }).isDisabled(), true);
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 2, 'Ctrl+S cannot duplicate an in-flight save');
    const repeatedSavePrevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, repeat: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(repeatedSavePrevented, true, 'repeated Ctrl+S still prevents browser Save');
    releaseHeldSave.resolve();
    await page.getByText('출고 분배 저장 완료').waitFor();
    console.log('browser: saved');
    assert.equal(savePosts, 2);
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 2, 'Ctrl+S inside success dialog cannot re-save');
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await page.getByText('미저장 48 → 50단').waitFor({ state: 'detached' });
    const composingSavePrevented = await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true });
      document.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert.equal(composingSavePrevented, true, 'IME Ctrl+S prevents browser Save');
    assert.equal(savePosts, 2, 'IME composition cannot trigger save');

    holdNextQuery = true;
    await page.getByRole('button', { name: '🔍 조회' }).click();
    await bounded(heldQueryStarted.promise, 'held product query');
    assert.equal(await page.locator('[data-distribute-qty="true"]').first().isDisabled(), true, 'query locks draft quantity');
    assert.equal(await page.getByRole('button', { name: '화면 비율계산' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '주문수량 채우기' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '🔄 개별 초기화' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: /💾 저장/ }).isDisabled(), true, 'query blocks POST race');
    assert.equal(await page.getByTestId('distribution-product-picker').locator('button').first().isDisabled(), true);
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 2, 'Ctrl+S cannot save while query is pending');
    releaseHeldQuery.resolve();
    await page.locator('[data-distribute-qty="true"]:not([disabled])').first().waitFor();

    await page.getByTestId('distribution-customer-picker').locator('button').first().click();
    await page.getByRole('group', { name: '업체 선택' }).getByRole('button', { name: /Alpha Florist/ }).click();
    const customerQty = page.locator('[data-distribute-qty="true"]');
    await customerQty.waitFor();
    await customerQty.fill('51');
    await customerQty.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-keyshortcuts')), 'Control+S');
    assert.equal(savePosts, 2, 'customer last-row Enter remains focus-only');
    await page.keyboard.press('Control+s');
    await page.getByText('출고 분배 저장 완료').waitFor();
    assert.equal(savePosts, 3, 'Ctrl+S uses customer mode save');
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 3, 'customer success dialog blocks duplicate Ctrl+S');
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await page.getByRole('button', { name: '품목 기준' }).click();

    await page.getByRole('button', { name: /내역 조회/ }).click();
    await page.getByText('변경 내역 없음').waitFor();
    assert.equal(await page.getByRole('button', { name: /💾 저장/ }).isDisabled(), true);
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 3, 'history modal blocks background save');
    await page.locator('.modal-overlay').last().getByRole('button', { name: '닫기' }).first().click();

    await page.getByRole('button', { name: /확정 \/ Confirmar/ }).click();
    await page.getByText(/확정 전 이슈 발견/).waitFor();
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 3, 'validation modal blocks background save');
    await page.locator('.modal-overlay').last().getByRole('button', { name: /취소 \/ Cancelar/ }).click();

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '전산 개별출고분배' }).click();
    await bounded(spStarted.promise, 'held SP request');
    assert.equal(await page.getByRole('button', { name: /💾 저장/ }).isDisabled(), true);
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 3, 'running SP blocks background save');
    releaseSp.resolve();
    await page.getByText('fixture SP blocked').last().waitFor();
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 3, 'finished SP modal blocks background save');
    await page.locator('.modal-overlay').last().getByRole('button', { name: '확인' }).click();

    delayOldProducts = true;
    await page.getByRole('button', { name: '🔍 조회' }).click();
    await bounded(oldProductsStarted.promise, 'old-week product request');
    console.log('browser: old request');
    await page.keyboard.press('Control+Alt+1');
    await page.getByRole('button', { name: '2026-42-01', exact: true }).click();
    delayOldProducts = false;
    await page.getByRole('button', { name: '🔍 조회' }).click();
    await page.getByRole('button', { name: 'Carnation 선택' }).waitFor();
    releaseOldProducts.resolve();
    await pause(300);
    assert.equal(await page.getByRole('button', { name: 'Alstroemeria 선택' }).count(), 0,
      'late old-week response cannot replace new-week rows');

    for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const bounds = await page.getByTestId('distribution-workspace').evaluate(element => ({
        width: element.getBoundingClientRect().width,
        scrollWidth: element.scrollWidth,
      }));
      assert.ok(bounds.scrollWidth <= bounds.width + 2,
        `${viewport.width} viewport: workspace horizontal overflow ${bounds.scrollWidth} > ${bounds.width}`);
    }
    await context.close();
  } finally {
    await browser?.close().catch(() => {});
    server.kill();
  }
});

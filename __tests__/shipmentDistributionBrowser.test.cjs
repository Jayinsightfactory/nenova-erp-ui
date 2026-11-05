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
    let expectPairSave = false;
  let custItemsExtra = false; // 업체 1(478)에 Zinnia(주문 20, 출고 7) 행 추가 — 업체 2 에는 주문 없음
  let orderPosts = 0;
  const productGroupQueries = [];
  let fixedScopeNext = false; // 다음 저장의 확정 범위 조회에서 Alstroemeria 품목군을 확정 상태로
  const cycleCalls = [];
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
      if (url.pathname === '/api/orders' && request.method() === 'POST') {
        orderPosts += 1;
        cycleCalls.push('order');
        const body = JSON.parse(request.postData() || '{}');
        // 주문 없던 업체 2(436)에 Zinnia 3 을 옮긴 뒤 Ctrl+S → 분배 저장 전에 기존 주문등록 API 로 주문 생성
        assert.deepEqual([body.custKey, body.week, body.year, body.source, body.items],
          [436, '2026-41-02', '2026', 'distribute-pair', [{ prodKey: 90, qty: 3, unit: '박스' }]], 'pending order registered for the receiving customer only');
        assert.equal(savePosts, 3, 'order registration happens before the distribute save');
        return reply(route, { success: true, verified: true, orderMasterKey: 1 }, 201);
      }
      if (url.pathname === '/api/shipment/ship-days') return reply(route, { success: true, configs: [] });
      if (url.pathname === '/api/shipment/fix' && request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        // 자동 사이클: 화면 연도 명시, force=false, 바꾸는 품목의 품목군만
        assert.deepEqual([body.week, body.orderYear, body.force, body.countryFlowers, body.cycleSource], ['2026-41-02', '2026', false, ['콜롬비아 알스트로'], 'distribute-save']);
        cycleCalls.push(body.action);
        return reply(route, { success: true, message: `${body.action} ok` });
      }
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
          if (expectPairSave) {
            expectPairSave = false;
            cycleCalls.push('save');
            // 업체 1 + 업체 2 나란히 보기: → 이동 후 Ctrl+S 는 두 업체 행을 한 배치로 저장
            assert.equal(orderPosts, 1, 'pending order was registered first');
            assert.deepEqual(body.entries.map(entry => [entry.custKey, entry.prodKey, entry.outQty]),
              [[478, 2429, 0], [478, 90, 4], [436, 2429, 102], [436, 90, 3]], 'pair save: full move 2429, partial move 3 of 7 Zinnia, no entry for the row moved back to 0');
            return reply(route, { success: true, verified: true, results: [{ verified: true }, { verified: true }] });
          }
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
        if (type === 'fixedScopes') {
          const fixedNow = fixedScopeNext;
          fixedScopeNext = false;
          cycleCalls.push('scope');
          return reply(route, { success: true, scopes: url.searchParams.get('prodKeys').split(',').map(prodKey => ({
            prodKey: Number(prodKey), countryFlower: Number(prodKey) === 2429 ? '콜롬비아 알스트로' : '네덜란드 기타', fixed: fixedNow && Number(prodKey) === 2429 })) });
        }
        if (type === 'groups') return reply(route, { success: true, groups: [{ key: '콜롬비아::장미', label: '콜롬비아 장미', country: '콜롬비아', flower: '장미' }] });
        if (type === 'products') {
          const week = url.searchParams.get('week');
          if (url.searchParams.get('prodGroup')) productGroupQueries.push(url.searchParams.get('prodGroup'));
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
          ProdKey: 2429, ProdName: 'Alstroemeria', OutUnit: '단', BunchOf1Box: 10, SteamOf1Box: 100, 주문수량: 60,
          출고수량: shipmentQty, ShipmentDescr: '기존 출고 비고', 비고: '주문 메모', Cost: 100,
        }, ...(custItemsExtra && url.searchParams.get('custKey') === '478'
          ? [{ ProdKey: 90, ProdName: 'Zinnia', OutUnit: '박스', 주문수량: 20, 출고수량: 7, ShipmentDescr: '', Cost: 12 }] : [])] });
        if (type === 'shipmentFarms') return reply(route, { success: true, farms: [] });
      }
      return reply(route, { success: true });
    });

    await page.goto(`${base}/shipment/distribute`, { waitUntil: 'domcontentloaded' });
    console.log('browser: loaded');
    // 차수 입력칸에 직접 입력(오늘 날짜 기준 ±3 범위에 41차가 없는 날에도 동작) → 팝업 선택도 그대로 검증
    const weekInput = page.getByPlaceholder(/^\d{4}-\d{2}-\d{2}$|YYYY-WW-SS/).first();
    await weekInput.fill('2026-41-01');
    await weekInput.press('Tab');
    await page.getByTestId('distribution-week-picker').locator('button').first().click();
    await page.getByRole('button', { name: '2026-41-02', exact: true }).click();
    await page.getByRole('button', { name: '🔍 조회' }).click();
    await page.getByRole('button', { name: 'Alstroemeria 선택' }).waitFor();
    console.log('browser: candidates');
    // nenova.exe식 버튼형 차수(±3)·품목 선택 + 브리지 검증 표식
    assert.equal(await page.locator('[data-ai-verify="week-2026-41-02"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-ai-verify^="week-2026-"]').count(), 7, '±3 weeks → 7 week buttons');
    assert.equal(await page.locator('[data-ai-verify="subweek-02"]').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.locator('[data-testid="distribution-product-buttons"] button').allTextContents(),
      ['Alstroemeria', 'Zinnia'], 'product buttons ProdName A-Z');
    await page.locator('[data-ai-verify="product-90"]').click();
    await page.getByText('Zinnia — 거래처 분배 정보').waitFor();
    assert.equal(await page.locator('[data-ai-verify="product-90"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('button[aria-keyshortcuts="Control+S"][data-ai-verify]').count(), 0, 'save button never carries data-ai-verify');
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
    await page.getByText('⚠️ fixture 검증 실패').waitFor();
    await page.getByText(/품목 Alstroemeria — 저장 실패: fixture 검증 실패/).waitFor();
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
    custItemsExtra = true;
    await page.keyboard.press('Control+s');
    await page.getByText('출고 분배 저장 완료').waitFor();
    assert.equal(savePosts, 3, 'Ctrl+S uses customer mode save');
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 3, 'customer success dialog blocks duplicate Ctrl+S');
    await page.getByRole('button', { name: '확인', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: /출고분배 및 업체정보/ }).getAttribute('aria-current'), 'page', 'customer picker opens the 업체정보 tab');
    await page.getByText('• ').first().waitFor();
    assert.match(await page.getByTestId('distribution-save-log').textContent(), /업체 Alpha Florist — 저장 완료 1건 · 총 51/);

    // 업체 1 + 업체 2 나란히 보기: ② 칸 선택 → Zulu 버튼 → → 이동 → Ctrl+S 한 배치 저장
    await page.locator('[data-ai-verify="pair-slot-2"]').click();
    await page.locator('[data-ai-verify="customer-436"]').click();
    await page.getByTestId('distribution-pair-table').waitFor();
    assert.equal(await page.locator('[data-ai-verify="qty-478-2429"]').inputValue(), '51');
    assert.equal(await page.locator('[data-ai-verify="qty-436-2429"]').inputValue(), '51');
    // 입력 단위 박스: 51단 → 5.1박스로 보이고, 6박스 입력 = 60단 저장값. 다시 기본으로.
    await page.locator('[data-ai-verify="pair-unit-박스"]').click();
    assert.equal(await page.locator('[data-ai-verify="qty-478-2429"]').inputValue(), '5.1');
    await page.locator('[data-ai-verify="qty-478-2429"]').fill('6');
    await page.locator('[data-ai-verify="pair-unit-native"]').click();
    assert.equal(await page.locator('[data-ai-verify="qty-478-2429"]').inputValue(), '60');
    await page.locator('[data-ai-verify="qty-478-2429"]').fill('51');
    assert.equal(await page.locator('[data-ai-verify="pair-remain-2429"]').count(), 1, 'pair view shows stock remaining after change');
    assert.equal(await page.locator('[data-ai-verify="pair-group-all"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-ai-verify="move-to2-2429"]').click();
    assert.equal(await page.locator('[data-ai-verify="qty-478-2429"]').inputValue(), '');
    assert.equal(await page.locator('[data-ai-verify="qty-436-2429"]').inputValue(), '102');
    assert.equal(await page.locator('[data-ai-verify="move-to2-2429"]').isDisabled(), true, 'nothing left to move from customer 1');
    // 부분 이동 + 주문 없는 업체: Zinnia 7 중 3 만 ② 로 (② 에는 주문 없음 → 임시 행 '주문등록 예정')
    assert.equal(await page.locator('[data-ai-verify="qty-436-90"]').count(), 0, 'customer 2 has no Zinnia order yet');
    await page.locator('[data-ai-verify="move-qty-90"]').fill('3');
    await page.locator('[data-ai-verify="move-to2-90"]').click();
    assert.equal(await page.locator('[data-ai-verify="qty-478-90"]').inputValue(), '4', 'partial move leaves 4 at customer 1');
    assert.equal(await page.locator('[data-ai-verify="qty-436-90"]').inputValue(), '3');
    await page.getByText('주문등록 예정').waitFor();
    // 되돌리면(②→① 3) 주문등록 예정 행은 0 → 저장 시 주문도 분배도 만들지 않음; 다시 3 옮겨 저장
    await page.locator('[data-ai-verify="move-qty-90"]').fill('3');
    await page.locator('[data-ai-verify="move-to1-90"]').click();
    assert.equal(await page.locator('[data-ai-verify="qty-478-90"]').inputValue(), '7');
    assert.equal(await page.locator('[data-ai-verify="qty-436-90"]').inputValue(), '');
    await page.locator('[data-ai-verify="move-qty-90"]').fill('3');
    await page.locator('[data-ai-verify="move-to2-90"]').click();
    assert.equal(await page.locator('[data-ai-verify="qty-436-90"]').inputValue(), '3');
    await page.getByText(/② 기존 출고 비고 · 미저장 51 → 102단/).waitFor();
    await page.getByText(/① 기존 출고 비고 · 미저장 51 → 0단/).waitFor();
    await page.screenshot({ path: path.join(root, 'outputs', 'distribution-pair-1920.png'), fullPage: true });
    expectPairSave = true;
    fixedScopeNext = true; // Alstroemeria 품목군 확정 상태 → 확인창 수락 → 확정해제 → 주문등록 → 분배 → 재확정
    cycleCalls.length = 0;
    page.once('dialog', dialog => {
      assert.match(dialog.message(), /콜롬비아 알스트로 품목군이 확정되어 있습니다[\s\S]*확정해제 → 저장 → 재확정/);
      dialog.accept();
    });
    await page.keyboard.press('Control+s');
    await page.getByText('출고 분배 저장 완료').waitFor();
    assert.equal(savePosts, 4, 'pair Ctrl+S posts both customers once');
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await page.getByText(/업체 Alpha Florist \+ Zulu Florist — 저장 완료 3건 · 총 109 · 주문등록 1건/).waitFor();
    assert.equal(orderPosts, 1, 'exactly one order registration (customer 2 Zinnia)');
    assert.deepEqual(cycleCalls, ['scope', 'unfix', 'order', 'save', 'fix'], 'confirmed group: unfix before any write, refix after');
    assert.match(await page.getByTestId('distribution-save-log').textContent(), /재확정 중/);
    await page.getByRole('button', { name: '업체 2 해제' }).click();
    await page.getByTestId('distribution-pair-table').waitFor({ state: 'detached' });
    console.log('browser: pair');

    await page.getByRole('button', { name: /출고분배 및 농장정보/ }).click();
    await page.locator('[data-distribute-qty="true"]:not([disabled])').first().waitFor();
    await page.keyboard.press('Control+s');
    await page.getByText(/품목 Alstroemeria — 변경 없음, 저장 생략/).waitFor();
    assert.equal(savePosts, 4, 'Ctrl+S without changes does not post');

    await page.getByRole('button', { name: /내역 조회/ }).click();
    await page.getByText('변경 내역 없음').waitFor();
    assert.equal(await page.getByRole('button', { name: /💾 저장/ }).isDisabled(), true);
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 4, 'history modal blocks background save');
    await page.locator('.modal-overlay').last().getByRole('button', { name: '닫기' }).first().click();

    await page.getByRole('button', { name: /확정 \/ Confirmar/ }).click();
    await page.getByText(/확정 전 이슈 발견/).waitFor();
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 4, 'validation modal blocks background save');
    await page.locator('.modal-overlay').last().getByRole('button', { name: /취소 \/ Cancelar/ }).click();

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '전산 개별출고분배' }).click();
    await bounded(spStarted.promise, 'held SP request');
    assert.equal(await page.getByRole('button', { name: /💾 저장/ }).isDisabled(), true);
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 4, 'running SP blocks background save');
    releaseSp.resolve();
    await page.getByText('fixture SP blocked').last().waitFor();
    await page.keyboard.press('Control+s');
    assert.equal(savePosts, 4, 'finished SP modal blocks background save');
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
    // 품종 버튼(콜롬비아 장미 등) → 그 품종으로 품목 재조회
    await page.setViewportSize({ width: 1920, height: 1080 });
    const groupButtons = page.getByTestId('distribution-group-buttons');
    assert.equal(await groupButtons.getByRole('button', { name: '전체' }).getAttribute('aria-pressed'), 'true');
    await groupButtons.getByRole('button', { name: '콜롬비아 장미' }).click();
    await page.waitForFunction(() => document.querySelector('[data-ai-verify="group-콜롬비아 장미"]')?.getAttribute('aria-pressed') === 'true');
    await pause(300);
    assert.ok(productGroupQueries.some(key => key.endsWith('장미')), 'group button reloads products for that 품종');
    await context.close();
  } finally {
    await browser?.close().catch(() => {});
    server.kill();
  }
});

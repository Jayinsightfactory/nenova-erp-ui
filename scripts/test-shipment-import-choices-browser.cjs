// Isolated local browser fixture. All APIs are intercepted; external traffic aborts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const base = 'http://127.0.0.1:33189';
const key = label => `수국|${label.replace(/\s/g, '').toLowerCase()}|hydrangea`;
const products = [{ prodKey: 1717, prodName: 'Ruscus Green', displayName: '루스커스', outUnit: '박스' },
  { prodKey: 3085, prodName: 'Ruscus Green 40cm', displayName: '루스커스 40cm', outUnit: '박스' }];
const source = products.map((p, i) => ({ sheetName: '수국', productLabel: p.displayName, productFamily: 'hydrangea',
  productOverrideKey: key(p.displayName), rowNo: i + 4, colNo: 2, customerLabel: 'Fixture', uploadQty: i + 2,
  reason: '품목 매칭 실패', matchKind: 'product', suggestedProducts: products }));
const row = (p, qty) => ({ custKey: 1, custName: 'Fixture', prodKey: p.prodKey, prodName: p.prodName,
  displayName: p.displayName, outUnit: '박스', uploadQty: qty, excelQty: qty, orderQty: qty, currentOutQty: 0,
  changeQty: 0, shipmentDiffQty: qty, needsShipmentApply: true, qtyWarnings: [], earlyLedgerFingerprint: 'fixture', status: '동일' });
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nenova-choices-'));
  const XLSX = require('xlsx'); const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['수국'], [], ['', 'Fixture', '주문', '입고'], ['루스커스', 2, 2, 0], ['루스커스 40cm', 3, 3, 0]]), '수국');
  const file = path.join(dir, 'choices.xlsx'); XLSX.writeFile(book, file);
  const browser = await require('puppeteer-core').launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const context = await browser.createBrowserContext();
    await context.setCookie({ name: 'nenovaToken', value: require('jsonwebtoken').sign({ userId: 'fixture', authority: 1, accountActive: true }, 'isolated-import-choice-fixture'), url: base });
    const page = await context.newPage(); await page.setViewport({ width: 1920, height: 1080 });
    const errors = [], applied = [], choices = []; let last = {};
    page.on('pageerror', e => errors.push(e.message)); page.on('dialog', d => d.accept());
    await page.setRequestInterception(true);
    page.on('request', async request => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
      if (url.origin !== base) return request.abort();
      if (!url.pathname.startsWith('/api/')) return request.continue();
      let data = { success: true, rows: [], items: [], data: [] };
      if (url.pathname === '/api/auth/me') data.user = { userId: 'fixture', authority: 1, accountActive: true };
      if (url.pathname === '/api/shipment/distribute-import-preview') {
        const body = await request.fetchPostData();
        const raw = /name="productOverrides"\r\n\r\n([^\r]+)/.exec(body || '');
        const overrides = raw ? JSON.parse(raw[1]) : {}; choices.push(overrides);
        const unmatched = source.filter(r => !overrides[r.productOverrideKey]);
        const skipped = source.filter(r => overrides[r.productOverrideKey] === '__skip_product__');
        const rows = source.filter(r => Number(overrides[r.productOverrideKey]) > 0).map(r => row(products.find(p => p.prodKey === Number(overrides[r.productOverrideKey])), r.uploadQty));
        data = last = { success: true, orderYear: '2026', week: '43-01', rows, changedRows: [], applyRows: rows,
          unmatched, skippedProducts: skipped.map(r => ({ key: r.productOverrideKey, sheetName: r.sheetName, productLabel: r.productLabel, count: 1 })),
          replacementCategories: ['콜롬비아루스커스'], ...(skipped.length ? { replacementProductKeys: rows.map(r => r.prodKey) } : {}),
          replacementPlan: unmatched.length || !rows.length ? null : 'local-fixture-plan',
          earlyImport: { mode: 'ORIGINAL_INCLUDES_EARLY', fingerprint: 'fixture', scope: {} },
          productOptions: products, customerOptions: [], fixBlockedRows: [], qtyWarningRows: [], logs: [] };
      }
      if (url.pathname === '/api/shipment/distribute-import-apply') {
        applied.push(JSON.parse(request.postData())); data = { success: false, error: 'Local fixture captured; no ERP writes' };
      }
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    async function button(text, exact = true) {
      for (const b of await page.$$('button')) if (await b.evaluate((e, x) => x.exact ? e.textContent.trim() === x.text : e.textContent.includes(x.text), { text, exact })) return b;
      throw new Error(`Button missing: ${text}`);
    }
    const click = async text => (await button(text)).click();
    await page.goto(base + '/shipment/distribute-import?week=2026-43-01&popup=1', { waitUntil: 'networkidle0', timeout: 120000 });
    await (await page.$('input[type=file]')).uploadFile(file); await click('검증하기');
    await page.waitForSelector('[role=dialog]');
    await (await page.$('[role=dialog] input[placeholder="품목 검색·선택"]')).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('루스커스') && !b.textContent.includes('40cm')));
    await (await button('루스커스', false)).click();
    const skips = await page.$$('button');
    const skipButtons = [];
    for (const b of skips) if (await b.evaluate(e => e.textContent.trim() === '이 품목 건너뛰기')) skipButtons.push(b);
    assert.equal(skipButtons.length, 2); await skipButtons[1].focus(); await page.keyboard.press('Space');
    await click('선택 반영 후 다시 검증');
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    assert.equal(choices.at(-1)[key('루스커스')], 1717);
    assert.equal(choices.at(-1)[key('루스커스 40cm')], '__skip_product__');
    assert.equal(await (await button('승인 후 주문등록+분배')).evaluate(e => e.disabled), false);
    assert.deepEqual(last.replacementProductKeys, [1717]);
    await click('건너뛰기 취소 후 재검증'); await page.waitForSelector('[role=dialog]');
    assert.equal(choices.at(-1)[key('루스커스 40cm')], undefined);
    assert.equal(await (await button('승인 후 주문등록+분배')).evaluate(e => e.disabled), true);
    await click('이 품목 건너뛰기'); await click('선택 반영 후 다시 검증');
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    await page.setViewport({ width: 1280, height: 800 });
    await page.screenshot({ path: path.join(dir, 'choices-preview.png'), fullPage: true });
    await click('승인 후 주문등록+분배');
    await page.waitForFunction(() => document.body.innerText.includes('Local fixture captured'));
    assert.equal(applied.length, 1); assert.deepEqual(applied[0].replacementProductKeys, [1717]);
    assert(applied[0].rows.every(r => r.prodKey === 1717)); assert.deepEqual(errors, []);
    await click('닫기');
    const second = path.join(dir, 'all-skip.xlsx'); fs.copyFileSync(file, second);
    await (await page.$('input[type=file]')).uploadFile(second); await click('검증하기');
    await page.waitForSelector('[role=dialog]');
    await click('이 품목 건너뛰기'); await click('이 품목 건너뛰기'); await click('선택 반영 후 다시 검증');
    await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
    assert.equal(await (await button('승인 후 주문등록+분배')).evaluate(e => e.disabled), true);
    assert.match(await page.$eval('body', e => e.innerText), /적용할 품목이 없습니다/);
    await page.screenshot({ path: path.join(dir, 'choices.png'), fullPage: true });
    console.log('PASS local UI: manual choice, Space skip, reverify, undo, enabled apply, signed scope payload; all APIs intercepted. Screenshot: ' + path.join(dir, 'choices.png'));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });

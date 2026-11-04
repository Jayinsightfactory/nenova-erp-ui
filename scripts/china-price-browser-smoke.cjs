// Real Next UI, loopback fixture only; no production ERP requests.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    let previewBody, savedBody, applies = 0;
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.hostname !== '127.0.0.1' && !['data:', 'about:'].includes(url.protocol)) return request.abort();
      if (url.pathname.endsWith('/china-volume-preview')) {
        previewBody = JSON.parse(request.postData());
        return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, planToken: 'fixture', blockers: [], rows: previewBody.entries.map(e => ({ ...e, key: e.id, custName: e.customer, prodName: e.product, outUnit: e.unit, orderBeforeQty: 5, orderAfterQty: 5, currentOutQty: 5, uploadQty: e.quantity, currentCost: 900, targetCost: e.unitPrice, priceExplicit: e.unitPrice != null })) }) });
      }
      if (url.pathname.endsWith('/china-volume-board') && request.method() === 'POST') savedBody = JSON.parse(request.postData());
      if (url.pathname.endsWith('-apply')) { applies++; return request.abort(); }
      request.continue();
    });
    await page.goto('http://127.0.0.1:3198/stats/china-volume-board?popup=1', { waitUntil: 'networkidle0' });
    const load = async () => {
      await page.waitForFunction(() => { const b = document.querySelector('[data-china-guide="load"]'); return b && !b.disabled; });
      await page.click('[data-china-guide="load"]');
      await page.waitForSelector('.inline-price');
    };
    await load();
    const replace = async (selector, value) => {
      await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
      await page.keyboard.type(value); await page.keyboard.press('Tab');
    };
    await replace('.inline-price', '1500');
    await page.click('.inline-price');
    const firstRow = await page.evaluate(() => document.activeElement.closest('tr').rowIndex);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.closest('tr').rowIndex), firstRow + 1, 'Enter advances price column');
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
    await page.keyboard.type('0'); await page.keyboard.press('Tab');
    await page.click('[data-china-guide="save"]');
    await page.waitForFunction(() => document.querySelector('[data-china-guide="save"]')?.textContent.includes('저장됨'));
    assert.deepEqual(Object.values(savedBody.cells).map(cell => cell.unitPrice), ['1500', '0']);
    await page.reload({ waitUntil: 'networkidle0' }); await load();
    assert.equal(await page.$eval('.inline-price', e => e.value), '1500', 'save/reload retains price');
    await page.click('[data-china-guide="review"]');
    await page.waitForSelector('[data-china-guide="apply"]');
    assert.deepEqual(previewBody.entries.map(e => e.unitPrice), [1500, 0]);
    assert.ok(await page.evaluate(() => document.body.innerText.includes('단가 현재 → 적용')));
    await page.screenshot({ path: 'china-price-review.png', fullPage: false });
    assert.equal(applies, 0);
    assert.deepEqual(errors, []);
    console.log('PASS China real browser: inline price/zero, Enter column navigation, save/reload, typed payload, price preview, no ERP writes');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

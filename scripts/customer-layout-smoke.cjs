const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const rows = Array.from({ length: 24 }, (_, i) => ({ CustKey: i + 1, CustCode: `C${i + 1}`, CustName: `테스트 거래처 ${i + 1}`, CustArea: i % 2 ? '호남선' : '경부선', CEO: '대표자', Manager: '담당자', ProductType: '장미', BusinessNumber: '000-00-00000', Tel: '02-000-0000', Mobile: '010-0000-0000', BaseOutDay: 4, OrderCode: `CL${i+1}`, Descr: '수국 화요일 / 장미 목요일' }));
    let submitted;
    let allowSave = false;
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', async route => {
      const url = route.request().url();
      let data = { success: true, data: [] };
      if (url.includes('/auth/me')) data = { success: true, user: { userId: 'fixture', userName: '검증', authority: 1 } };
      if (url.includes('/master/customers')) {
        if (route.request().method() === 'POST') {
          submitted = route.request().postDataJSON();
          if (allowSave) {
            rows.push({ ...submitted.values, CustKey: 25 });
            return route.fulfill({ json: { success: true, custKey: 25, message: '신규 거래처가 등록되었습니다.' } });
          }
          return route.fulfill({ status: 409, json: { error: '다른 작업에서 담당자 항목이 변경됐습니다.' } });
        }
        data = { success: true, data: rows };
      }
      return route.fulfill({ json: data });
    });
    await page.goto(`${process.env.SMOKE_BASE_URL || 'http://localhost:3220'}/master/customers?popup=1`);
    await page.getByText('테스트 거래처 1', { exact: true }).waitFor();
    assert.equal(await page.locator('.customer-table tbody tr').count(), 24);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    allowSave = true;
    await page.getByRole('button', { name: '신규', exact: true }).click();
    await page.getByLabel('거래처명', { exact: true }).fill('한글 신규 거래처');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByText('신규 거래처가 등록되었습니다.', { exact: true }).waitFor();
    assert.equal(submitted.mode, 'create');
    assert.equal(submitted.values.CustName, '한글 신규 거래처');
    await page.locator('.customer-table tbody tr.selected').filter({ hasText: '한글 신규 거래처' }).waitFor();
    allowSave = false;
    const regularHeight = await page.locator('.customer-table tbody tr').first().evaluate(el => el.getBoundingClientRect().height);
    await page.getByRole('button', { name: '촘촘히 보기' }).click();
    const compactHeight = await page.locator('.customer-table tbody tr').first().evaluate(el => el.getBoundingClientRect().height);
    assert.ok(compactHeight < regularHeight, `${compactHeight} < ${regularHeight}`);
    await page.getByRole('button', { name: '촘촘히 보기' }).click();
    await page.getByLabel('지역 필터', { exact: true }).fill('호남');
    assert.equal(await page.locator('.customer-table tbody tr').count(), 12);
    await page.getByRole('button', { name: '필터 초기화', exact: true }).click();
    await page.getByText('테스트 거래처 1', { exact: true }).dblclick();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByLabel('거래처명', { exact: true }).evaluate(el => el === document.activeElement), true);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')));
    }
    await page.getByLabel('비고', { exact: true }).fill('');
    await page.getByLabel('기본출고요일', { exact: true }).selectOption('0');
    await page.getByLabel('품목분류', { exact: true }).fill('수국');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.equal(submitted.mode, 'update'); assert.equal(submitted.custKey, 1);
    assert.equal(submitted.values.Descr, ''); assert.equal(submitted.values.BaseOutDay, 0); assert.equal(submitted.values.ProductType, '수국');
    assert.equal(await page.getByLabel('품목분류', { exact: true }).inputValue(), '수국');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '저장' && !b.disabled));
    const dismissed = new Promise(resolve => page.once('dialog', async dialog => { await dialog.dismiss(); resolve(); }));
    await page.keyboard.press('Escape');
    await dismissed;
    assert.equal(await page.getByRole('dialog').count(), 1, 'dirty Escape cancellation preserves editor');
    const bounds = await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 1920 && bounds.y + bounds.height <= 1080);
    fs.mkdirSync('outputs/customer-layout', { recursive: true });
    await page.screenshot({ path: 'outputs/customer-layout/editor-1920.png' });
    const accepted = new Promise(resolve => page.once('dialog', async dialog => { await dialog.accept(); resolve(); }));
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await accepted;
    await page.waitForFunction(() => document.activeElement.tagName === 'TR', null, { timeout: 3000 });
    await page.screenshot({ path: 'outputs/customer-layout/list-1920.png' });
    await page.setViewportSize({ width: 800, height: 800 });
    await page.getByRole('button', { name: '신규', exact: true }).click();
    const small = await page.getByRole('dialog').boundingBox();
    assert.ok(small.x >= 0 && small.y >= 0 && small.x + small.width <= 800 && small.y + small.height <= 800);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.deepEqual(errors, []);
    console.log('1920x1080 + 800x800: filters, editor bounds, clear/zero, save payload, failure preserves inputs, no browser errors passed (fixture only).');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

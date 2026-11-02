const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', dialog => dialog.accept());
    await page.setViewport({ width: 1440, height: 1000 });
    const origin = 'http://127.0.0.1:3199';
    const state = async () => (await fetch(`${origin}/api/fixture-state`)).json();
    const load = async () => {
      const before = await state();
      await page.waitForFunction(() => { const b = document.querySelector('[data-volume-guide="load"]'); return b && !b.disabled; });
      await page.click('[data-volume-guide="load"]');
      await page.waitForFunction(() => { const b = document.querySelector('[data-volume-guide="load"]'); return b && !b.disabled && document.querySelector('.work-panel .notice')?.textContent.includes('저장된 단가'); });
      assert.equal((await state()).previews - before.previews, 2, 'restored prices must get a fresh preview');
    };
    const editTab = async () => {
      const buttons = await page.$$('button');
      for (const button of buttons) if ((await button.evaluate(el => el.textContent)).includes('단가 수정·매칭')) { await button.click(); return; }
      throw Error('edit tab not found');
    };
    const values = () => page.$$eval('input[aria-label$="개별단가"]', nodes => nodes.map(n => n.value));
    await page.goto(`${origin}/stats/dutch-volume-board?popup=1`, { waitUntil: 'networkidle0' });
    await load(); await editTab();
    assert.deepEqual(await values(), ['15000', '0']);
    await load(); await editTab();
    assert.deepEqual(await values(), ['16000', '0'], 'fresh DB cost replaces prior automatically loaded value');
    const selector = 'input[aria-label$="개별단가"]';
    await page.click(selector); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('18500'); await page.keyboard.press('Tab');
    assert.deepEqual(await values(), ['18500', '0'], 'price input accepts the edit');
    await load(); await editTab();
    assert.deepEqual(await values(), ['18500', '0'], 'typed price survives changed quantities');
    await page.reload({ waitUntil: 'networkidle0' }); await load(); await editTab();
    assert.deepEqual(await values(), ['18500', '0'], 'pending price survives page refresh and changed quantities');
    assert.equal((await state()).applyAttempts, 0);
    assert.deepEqual(errors, []);
    console.log('PASS real Next browser: stored/zero/customer prices, newer DB price, typed edit across quantity changes, full page reload, fresh previews, zero ERP writes');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

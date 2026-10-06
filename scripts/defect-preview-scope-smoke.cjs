const assert = require('node:assert/strict');
const fs = require('node:fs');
const puppeteer = require(process.env.PUPPETEER_CORE_PATH || 'puppeteer-core');

// UI-only regression fixtures reproduce the real 498/501 scope mismatch.
// All API requests are intercepted; no business GET or write reaches the DB.
const rows = [
  { deductionKey: 498, custKey: 315, customerName: '동산(꽃동산)', estimateKey: 9534, quantity: 4, remainingQuantity: 4 },
  { deductionKey: 501, custKey: 312, customerName: '꽃길', estimateKey: 9537, quantity: 15, remainingQuantity: 15 },
].map(row => ({ ...row, orderYear: 2026, orderWeek: '38', appliedOrderYear: 2026,
  appliedOrderWeek: '38', status: 'CARRYOVER', isCarryover: true, isCarryoverLedger: true,
  originalQuantity: row.quantity, sourceUnit: '단', productName: '카네이션',
  matchedProductDbName: 'CARNATION', managerName: '박성수', importConfirmed: true,
  distributionCost: 11000, existingEstimateRecords: [], registrationEligible: true }));

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const popup of [false, true]) {
      const page = await browser.newPage();
      const errors = [], writes = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (!['GET', 'HEAD'].includes(request.method())) {
          writes.push({ method: request.method(), url: request.url() });
          return request.respond({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'UI smoke blocks writes' }) });
        }
        if (!request.url().includes('/api/')) return request.continue();
        const url = new URL(request.url());
        let body = { success: true };
        if (url.pathname === '/api/auth/me') body.user = { userId: 'fixture', userName: '영업지원', deptName: '영업지원', authority: 1 };
        if (url.pathname === '/api/sales/defect-deductions') body = { success: true, rows: url.searchParams.get('view') === 'support' ? rows : [], history: [], managerOptions: [] };
        return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      const base = process.env.SMOKE_BASE_URL || 'http://localhost:3017';
      await page.goto(`${base}/sales/defect-deductions${popup ? '?popup=1' : ''}`, { waitUntil: 'networkidle0', timeout: 120000 });
      await page.waitForSelector('.defect-tabs');
      await page.evaluate(() => {
        for (const [label, value] of [['연도', '2026'], ['차수', '40']]) {
          const input = [...document.querySelectorAll('label')].find(el => el.textContent.trim().startsWith(label))?.querySelector('input');
          if (!input) throw new Error(`Missing ${label} input`);
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].find(el => el.textContent === '영업지원 전산등록').click());
      await page.waitForFunction(() => document.querySelectorAll('.support-grid tr.defect-row').length === 2);
      const shell = await page.evaluate(() => ({ shell: document.querySelectorAll('[data-ui-shell]').length,
        sidebar: document.querySelectorAll('[data-ui-sidebar]').length, topbar: document.querySelectorAll('[data-ui-topbar]').length,
        popupbar: document.querySelectorAll('[data-ui-popupbar]').length, width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
      assert.deepEqual(shell, { shell: 1, sidebar: popup ? 0 : 1, topbar: popup ? 0 : 1, popupbar: popup ? 1 : 0, width: 1920, height: 1080, dpr: 1 });
      for (let index = 0; index < 2; index++) {
        await page.$$eval('.support-estimate-preview', (buttons, i) => buttons[i].click(), index);
        await page.waitForSelector('.support-estimate-preview-card');
        const modal = await page.$eval('.support-estimate-preview-card', el => { const rect = el.getBoundingClientRect(); return { text: el.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; });
        assert.match(modal.text, /2026년 40차/);
        assert.match(modal.text, /아직 등록되지 않았습니다/);
        assert.match(modal.text, /기존 연결은 2026년 38차/);
        assert(!modal.text.includes(`#${rows[index].estimateKey}`), 'Must not fabricate previous Estimate as current');
        assert(modal.left >= 0 && modal.right <= 1920 && modal.top >= 0 && modal.bottom <= 1080);
        assert.equal(await page.$$eval('.support-estimate-preview-table tbody tr', items => items.length), 0);
        const folder = 'outputs/defect-preview-scope'; fs.mkdirSync(folder, { recursive: true });
        await page.screenshot({ path: `${folder}/${popup ? 'popup' : 'normal'}-${rows[index].deductionKey}-1920.png` });
        await page.click('[aria-label="불량차감 미리보기 닫기"]');
      }
      const bounds = await page.$eval('.support-grid-scroll', el => ({ right: el.getBoundingClientRect().right, scroll: el.scrollWidth >= el.clientWidth }));
      assert(bounds.right <= 1921 && bounds.scroll, 'Table remains in viewport with reachable overflow');
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, [], 'Read-only smoke must not attempt writes');
      console.log(`PASS ${popup ? 'popup' : 'normal'}: single shell, 498/501 real scope regression, no synthetic Estimate, 1920x1080 100%, modal bounds, table overflow, no page errors/writes`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

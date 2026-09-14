const assert = require('node:assert/strict');
const fs = require('node:fs');
const puppeteer = require(process.env.PUPPETEER_CORE_PATH || 'puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    const rows = [
      { deductionKey: 31, managerName: '박성수', customerName: '서부꽃집', countryName: '콜롬비아', productName: '수국', matchedProductDbName: 'Hydrangea Blue', quantity: 2, sourceUnit: '박스', farmName: 'Farm C' },
      { deductionKey: 11, managerName: '정재훈', customerName: '양재동', countryName: '중국', productName: '장미', matchedProductDbName: 'ROSE CHINA Freedom', quantity: 10, sourceUnit: '단', farmName: 'Farm A' },
      { deductionKey: 12, managerName: '정재훈', customerName: '양재동', countryName: '콜롬비아', productName: '수국', matchedProductDbName: 'Hydrangea Pink', quantity: 3, sourceUnit: '박스', farmName: 'Farm B' },
      { deductionKey: 21, managerName: '조현욱', customerName: '꽃길', countryName: '콜롬비아', productName: '장미', matchedProductDbName: 'ROSE Mondial', quantity: 5, sourceUnit: '단', farmName: 'Farm A' },
    ];
    page.on('request', (request) => {
      if (!request.url().includes('/api/')) return request.continue();
      let body = { success: true };
      if (request.url().includes('/api/auth/me')) body.user = { userId: 'fixture', userName: '수입 담당자', deptName: '수입부', authority: 1 };
      if (request.url().includes('/api/sales/defect-deductions')) {
        body = { success: true, rows: request.url().includes('view=incoming') ? rows : [], history: [], managerOptions: [] };
      }
      request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    const base = process.env.SMOKE_BASE_URL || 'http://localhost:3017';
    await page.goto(`${base}/sales/defect-deductions?popup=1`, { waitUntil: 'networkidle0' });
    const feedbackTab = await page.$eval('.defect-tabs a[href="/sales/farm-quality"]', (link) => ({
      label: link.textContent.trim(),
      previousLabel: link.previousElementSibling?.textContent.trim(),
      target: link.getAttribute('target'),
    }));
    assert.deepEqual(feedbackTab, { label: '농장 불량 피드백', previousLabel: '미처리·다음 차수 재시도', target: null });
    await page.evaluate(() => [...document.querySelectorAll('[role=tab]')].find((button) => button.textContent === '수입부 확인').click());
    await page.waitForFunction(() => document.querySelectorAll('.incoming-grid tbody tr.defect-row').length === 4);
    const order = () => page.$$eval('.incoming-grid tbody tr.defect-row', (items) => items.map((row) => ({
      customer: row.children[2].textContent.trim(),
      product: row.children[3].textContent.trim(),
      country: row.children[4].textContent.trim().split('·')[0].trim(),
      farmField: row.querySelector('[data-defect-field]')?.getAttribute('data-defect-field'),
    })));
    const customerOrder = await order();
    assert.deepEqual(customerOrder.map((row) => row.customer), ['꽃길', '서부꽃집', '양재동', '양재동']);
    assert.equal(await page.$eval('.incoming-group-toggle [aria-pressed=true]', (button) => button.textContent), '거래처');

    await page.evaluate(() => [...document.querySelectorAll('.incoming-group-toggle button')].find((button) => button.textContent === '품종').click());
    const productOrder = await order();
    assert.deepEqual(productOrder.map((row) => row.country), ['중국', '콜롬비아', '콜롬비아', '콜롬비아']);
    assert.deepEqual(productOrder.map((row) => row.product), ['장미', '수국', '수국', '장미']);
    assert.deepEqual(productOrder.map((row) => row.farmField), ['incoming-farm-1', 'incoming-farm-0', 'incoming-farm-2', 'incoming-farm-3']);
    assert.equal(await page.$eval('.incoming-group-toggle [aria-pressed=true]', (button) => button.textContent), '품종');
    assert.equal(await page.$$eval('.incoming-country-divider', (items) => items.map((item) => item.querySelector('strong').textContent).join(',')), '중국,콜롬비아');
    assert.equal(await page.$$eval('.incoming-group-start', (items) => items.length), 3);
    const bounds = await page.$eval('.incoming-review-card', (element) => ({ right: element.getBoundingClientRect().right, viewport: innerWidth }));
    assert(bounds.right <= bounds.viewport + 1, JSON.stringify(bounds));
    assert.equal(errors.length, 0, errors.join('\n'));
    fs.mkdirSync('outputs/defect-incoming-group', { recursive: true });
    await page.screenshot({ path: 'outputs/defect-incoming-group/1920.png', fullPage: true });
    console.log('PASS: customer default, country-product toggle, active state, country dividers, source index preservation, 1920x1080');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

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
        body = { success: true, rows, history: [], managerOptions: [] };
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
    await page.waitForFunction(() => document.querySelectorAll('.defect-grid-card tbody tr.defect-row').length === 4);
    const salesOrder = () => page.$$eval('.defect-grid-card tbody tr.defect-row', (items) => items.map((row) => row.children[3].querySelector('input')?.value));
    assert.deepEqual(await salesOrder(), ['꽃길', '서부꽃집', '양재동', '양재동']);
    await page.select('.defect-sort-field select', 'manager');
    assert.deepEqual(await salesOrder(), ['서부꽃집', '양재동', '양재동', '꽃길']);
    await page.type('.defect-grid-card tbody tr.defect-row:first-child td:nth-child(10) input', '원본 0번 확인');
    await page.focus('.defect-grid-card tbody tr.defect-row:first-child .defect-select-cell input');
    await page.keyboard.press('Space');
    await page.select('.defect-sort-field select', 'customer');
    const preservedFirstRow = await page.$eval('.defect-grid-card [data-defect-field="customer-0"]', (input) => ({
      note: input.closest('tr').querySelector('td:nth-child(10) input').value,
      selected: input.closest('tr').querySelector('.defect-select-cell input').checked,
    }));
    assert.deepEqual(preservedFirstRow, { note: '원본 0번 확인', selected: true }, '표시 순서를 바꿔도 편집값과 선택은 원본 행에 남아야 한다.');
    await page.select('.defect-sort-field select', 'manager');
    await page.evaluate(() => [...document.querySelectorAll('.sales-view-toggle button')].find((button) => button.textContent === '완료 목록').click());
    const summaryOrder = await page.$$eval('.sales-summary-table tbody tr', (items) => items.map((row) => row.children[2].textContent.trim()));
    assert.deepEqual(summaryOrder, ['서부꽃집', '양재동', '양재동', '꽃길']);
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
    assert.equal(await page.$eval('.incoming-group-toggle select', (select) => select.value), 'customer');

    await page.select('.incoming-group-toggle select', 'manager');
    assert.deepEqual((await order()).map((row) => row.customer), ['서부꽃집', '양재동', '양재동', '꽃길']);
    await page.select('.incoming-group-toggle select', 'product');
    const productOrder = await order();
    assert.deepEqual(productOrder.map((row) => row.country), ['중국', '콜롬비아', '콜롬비아', '콜롬비아']);
    assert.deepEqual(productOrder.map((row) => row.product), ['장미', '수국', '수국', '장미']);
    assert.deepEqual(productOrder.map((row) => row.farmField), ['incoming-farm-1', 'incoming-farm-0', 'incoming-farm-2', 'incoming-farm-3']);
    assert.equal(await page.$eval('.incoming-group-toggle select', (select) => select.value), 'product');
    assert.equal(await page.$$eval('.incoming-country-divider', (items) => items.map((item) => item.querySelector('strong').textContent).join(',')), '중국,콜롬비아');
    assert.equal(await page.$$eval('.incoming-group-start', (items) => items.length), 3);
    const bounds = await page.$eval('.incoming-review-card', (element) => ({ right: element.getBoundingClientRect().right, viewport: innerWidth }));
    assert(bounds.right <= bounds.viewport + 1, JSON.stringify(bounds));
    assert.equal(errors.length, 0, errors.join('\n'));
    fs.mkdirSync('outputs/defect-incoming-group', { recursive: true });
    await page.screenshot({ path: 'outputs/defect-incoming-group/1920.png', fullPage: true });
    await page.setViewport({ width: 800, height: 900, deviceScaleFactor: 1 });
    const narrowBounds = await page.$eval('.incoming-review-card', (element) => ({ right: element.getBoundingClientRect().right, viewport: innerWidth }));
    assert(narrowBounds.right <= narrowBounds.viewport + 1, JSON.stringify(narrowBounds));
    await page.screenshot({ path: 'outputs/defect-incoming-group/800.png', fullPage: true });
    console.log('PASS: sales edit/summary and incoming customer/manager/product sorting, source index preservation, 1920x1080 and 800x900');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

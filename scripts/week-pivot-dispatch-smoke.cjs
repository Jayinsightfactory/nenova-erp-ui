const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const rows = [
  ['47-01', '2026-11-18', '경부선', '연습 거래처 A', '장미 A', 3, '확정 분배', 1],
  ['47-02', '2026-11-21', '지방', '연습 거래처 B', '카네이션 B', 8, '선출고 분배', 1],
  ['48-01', '2026-11-25', '양재동', '연습 거래처 C', '장미 A', 12, '수량 10 → 12', 0],
  ['48-01', '2026-11-27', '경부선', '연습 거래처 A', '장미 A', 4, '분할 출고', 0],
].map(([OrderWeek, DateLabel, Area, CustName, ProdName, Quantity, Descr, isFix], i) => ({
  OrderWeek, DateLabel, Area, CustName, ProdName, Quantity, Descr, isFix,
  CustKey: i + 1, ProdKey: i + 1, SdetailKey: 10 + i, SdateKey: 100 + i, OutUnit: '박스',
}));

async function main() {
  const base = process.argv[2] || 'http://localhost:4137';
  const captureDir = process.argv[3];
  const executablePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => localStorage.setItem('nenovaUser', JSON.stringify({
      userId: 'fixture', userName: '테스트 사용자',
    })));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return request.continue();
      const view = url.searchParams.get('view');
      if (view) requests.push(Object.fromEntries(url.searchParams));
      return request.respond({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true, rows: view === 'dispatchList' ? rows : [], data: [], hasMore: false,
          user: { userId: 'fixture', userName: '테스트 사용자' },
        }),
      });
    });
    await page.goto(new URL('/shipment/week-pivot?popup=1&view=dispatch&weekFrom=2026-47-01&weekTo=2026-48-01', base).href, {
      waitUntil: 'domcontentloaded', timeout: 60000,
    });
    await page.waitForSelector('.dispatch-list tbody tr', { timeout: 60000 });
    const text = await page.$eval('.dispatch-list tbody', el => el.innerText);
    for (const week of ['47-01', '47-02', '48-01']) assert.ok(text.includes(week));
    assert.equal(await page.$$eval('.dispatch-list tbody tr', list => list.length), 4);
    if (captureDir) {
      fs.mkdirSync(captureDir, { recursive: true });
      await page.screenshot({ path: path.join(captureDir, 'area-first.png') });
    }
    await page.select('.dispatch-list select', 'day');
    await page.waitForFunction(() => document.querySelectorAll('.dispatch-list tbody tr').length === 4
      && document.querySelectorAll('.dispatch-list th')[1]?.textContent === '출고일');
    if (captureDir) await page.screenshot({ path: path.join(captureDir, 'day-first.png') });
    assert.deepEqual(requests.map(request => [request.view, request.groupBy, request.orderYear]), [
      ['dispatchList', 'area', '2026'], ['dispatchList', 'day', '2026'],
    ]);
    assert.deepEqual(errors, []);
    console.log('Week pivot dispatch smoke passed (47-01–48-01, both sort orders, 2 scoped requests).');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

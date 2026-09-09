// Local 1920x1080 browser fixture for the estimate overflow confirmation UI.
// Every /api request is intercepted; this script cannot write an ERP database.
// Usage: node scripts/estimate-overflow-ui-smoke.cjs [local estimate URL]
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const url = process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000/estimate?popup=1';
const screenshotPath = path.resolve(process.env.SMOKE_SCREENSHOT || 'outputs/estimate-overflow-ui-1920.png');
const candidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = candidates.find(candidate => { try { return fs.existsSync(candidate); } catch { return false; } });
if (!executablePath) {
  console.error('Chrome executable not found. Set CHROME_PATH.');
  process.exit(2);
}

let liveQuantity = 50;
let liveCost = 10000;
let applyPosts = 0;
let forbiddenNormalWrites = 0;
let separateCostWrites = 0;
let combinedPreviewSeen = false;
let combinedApplySeen = false;
let currentYear = '2026';
let currentParent = '36';

function json(request, body, status = 200) {
  return request.respond({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

function presenceResponse(payload = {}) {
  const year = String(payload.year || payload.orderYear || currentYear);
  const week = String(payload.week || payload.orderWeek || currentParent).split('-')[0];
  return {
    success: true,
    scope: { orderYear: year, orderWeek: week, custKey: 533 },
    stale: false,
    digest: applyPosts ? 'digest-after' : 'digest-before',
    fixStatusDigest: 'fix-smoke',
    lease: {
      active: true,
      ownedByMe: true,
      ownedBySameUser: true,
      ownerName: 'overflow-smoke',
      pageCode: 'estimate',
      token: 'overflow-smoke-token',
      revision: applyPosts ? 2 : 1,
    },
  };
}

function shipment() {
  return {
    ParentWeek: currentParent,
    CustKey: 533,
    CustName: 'Overflow UI Smoke',
    Manager: 'overflow-smoke',
    ShipmentKeys: '9001',
    firstShipmentKey: 9001,
    SubWeeks: `${currentParent}-01,${currentParent}-02`,
    SubWeeksFix: `${currentParent}-01:1,${currentParent}-02:1`,
    totalAmount: liveQuantity * liveCost,
  };
}

function item() {
  return {
    SdateKey: 7001,
    SdetailKey: 8001,
    ShipmentKey: 9001,
    CustKey: 533,
    ProdKey: 1239,
    ProdName: 'Deep Silver 50cm',
    CountryFlower: 'ECUADOR ROSE',
    Unit: '박스',
    Quantity: liveQuantity,
    Cost: liveCost,
    DateCost: liveCost,
    Amount: liveQuantity * liveCost,
    Vat: Math.round(liveQuantity * liveCost * 0.1),
    outDate: '2026-09-07',
    OrderWeek: `${currentParent}-01`,
  };
}

function overflowRow() {
  return {
    sdateKey: 7001,
    prodKey: 1239,
    prodName: 'Deep Silver 50cm',
    unit: '박스',
    fromWeek: `${currentParent}-01`,
    toWeek: `${currentParent}-02`,
    oldQuantity: 50,
    requestedQuantity: 60,
    currentQuantity: 55,
    currentIncrease: 5,
    nextIncrease: 5,
    shipmentDate: '2026-09-14',
    cost: 12000,
    sourceCost: 12000,
    sourceCostBefore: 10000,
    retainedTargetCost: false,
    newShipment: true,
  };
}

async function clickAndWait(page, selector) {
  await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  await page.click(selector);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--headless=new'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const problems = [];
    page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (['error', 'warn'].includes(message.type()) && !/Failed to load resource/.test(message.text())) problems.push(`${message.type()}: ${message.text()}`);
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('nenovaUser', JSON.stringify({ userId: 'overflow-smoke', userName: 'overflow-smoke', role: 'admin' }));
    });
    await page.setRequestInterception(true);
    page.on('request', async request => {
      try {
        const parsed = new URL(request.url());
        if (!parsed.pathname.startsWith('/api/')) return request.continue();
        const body = request.postData() ? JSON.parse(request.postData()) : {};
        if (parsed.pathname === '/api/auth/me') return json(request, { success: true, user: { userId: 'overflow-smoke', userName: 'overflow-smoke', role: 'admin' } });
        if (parsed.pathname === '/api/products/search') return json(request, { success: true, products: [] });
        if (parsed.pathname === '/api/erp/edit-presence') return json(request, presenceResponse(request.method() === 'GET' ? Object.fromEntries(parsed.searchParams) : body));
        if (parsed.pathname === '/api/estimate/update-cost') {
          separateCostWrites += 1;
          return json(request, { success: false, error: 'combined overflow fixture forbids a separate cost write' }, 500);
        }
        if (parsed.pathname === '/api/estimate/update-date-quantity') {
          if (body.overflowMode === 'preview') {
            combinedPreviewSeen = body.combinedCosts?.mode === 'once'
              && body.combinedCosts?.week === `${currentParent}-01`
              && body.combinedCosts?.items?.length === 1
              && Number(body.combinedCosts.items[0].cost) === 12000;
            return json(request, { success: true, overflowPreview: { required: true, planHash: 'ui-smoke-plan', combinedCostCount: 1, rows: [overflowRow()] } });
          }
          if (body.overflowMode === 'apply') {
            combinedApplySeen = body.combinedCosts?.mode === 'once'
              && body.combinedCosts?.week === `${currentParent}-01`
              && body.combinedCosts?.items?.length === 1
              && Number(body.combinedCosts.items[0].cost) === 12000;
            applyPosts += 1;
            liveQuantity = 55;
            liveCost = 12000;
            return json(request, {
              success: true,
              updatedCount: 1,
              direction: 'increase',
              stockMode: 'fixed-direct',
              stockValidation: { availability: [{ prodKey: 1239 }] },
              items: [{ sdateKey: 7001, sdetailKey: 8001, shipmentKey: 9001, newDateQuantity: 55, dateCostAfter: 12000, detailCostAfter: 12000 }],
              overflowApplied: true,
              overflowRows: [overflowRow()],
              combinedCostResult: { success: true, changedCount: 1, diffAmount: 110000, changes: [{ sdetailKey: 8001, oldCost: 10000, newCost: 12000 }] },
              editDigestAfter: 'digest-after',
              revision: 2,
            });
          }
          forbiddenNormalWrites += 1;
          return json(request, { success: false, error: 'overflow fixture forbids legacy write' }, 500);
        }
        if (parsed.pathname === '/api/estimate') {
          if (parsed.searchParams.get('view') === 'types') return json(request, { success: true, types: [] });
          if (parsed.searchParams.get('view') === 'mismatch') return json(request, { success: true });
          currentYear = parsed.searchParams.get('year') || currentYear;
          currentParent = String(parsed.searchParams.get('week') || currentParent).padStart(2, '0').slice(-2);
          if (parsed.searchParams.get('itemsOnly')) return json(request, { success: true, items: [item()] });
          return json(request, { success: true, shipments: [shipment()], items: [] });
        }
        if (parsed.pathname === '/api/shipment/fix-status') return json(request, { success: true, weeks: [] });
        if (parsed.pathname === '/api/dev/app-log') return json(request, { success: true, logs: [] });
        if (parsed.pathname === '/api/ping') return json(request, { success: true });
        return json(request, { success: true, rows: [], items: [], shipments: [], customers: [], products: [] });
      } catch (error) {
        return request.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: error.message }) });
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    const qtySelector = 'input[data-estimate-edit-column="quantity"]';
    const costSelector = 'input[data-estimate-edit-column="cost"]';
    await page.waitForSelector(qtySelector, { visible: true, timeout: 30000 });
    await page.click(qtySelector, { clickCount: 3 });
    await page.type(qtySelector, '60');
    await page.click(costSelector, { clickCount: 3 });
    await page.type(costSelector, '12000');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /^수정 저장 \(/.test(button.textContent.trim()) && !button.disabled));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => /^수정 저장 \(/.test(button.textContent.trim()))?.click());

    const dialogSelector = '[data-estimate-overflow-dialog="1"]';
    await page.waitForSelector(dialogSelector, { visible: true });
    const layout = await page.$eval(dialogSelector, element => {
      const rect = element.getBoundingClientRect();
      const scroller = [...element.querySelectorAll('div')].find(node => getComputedStyle(node).overflowX === 'auto' && node.querySelector('table'));
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        hasHorizontalTableScroll: Boolean(scroller),
        documentOverflow: document.documentElement.scrollWidth > window.innerWidth,
      };
    });
    if (layout.left < 0 || layout.right > 1920 || layout.top < 0 || layout.bottom > 1080) problems.push(`modal outside 1920x1080: ${JSON.stringify(layout)}`);
    if (layout.documentOverflow) problems.push('preview causes document-level horizontal overflow');
    if (!layout.hasHorizontalTableScroll) problems.push('preview table has no bounded horizontal scroll container');
    const pricePreview = await page.$eval('[data-estimate-overflow-price="1"]', element => element.textContent.replace(/\s+/g, ' ').trim());
    const atomicPriceCopy = await page.$eval('[data-estimate-overflow-atomic-price="1"]', element => element.textContent.trim());
    if (!pricePreview.includes('₩12,000') || !pricePreview.includes('₩10,000 → ₩12,000')) problems.push(`combined final/source price missing: ${pricePreview}`);
    if (!atomicPriceCopy.includes('한 트랜잭션')) problems.push(`atomic price copy missing: ${atomicPriceCopy}`);
    if (!combinedPreviewSeen) problems.push('preview did not receive expected combinedCosts items/mode/week');
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });

    await clickAndWait(page, '[data-estimate-overflow-cancel="1"]');
    await page.waitForSelector(dialogSelector, { hidden: true });
    if (applyPosts !== 0) problems.push(`cancel sent ${applyPosts} apply POST(s)`);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '닫기'));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === '닫기')?.click());

    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => /^수정 저장 \(/.test(button.textContent.trim()) && !button.disabled));
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => /^수정 저장 \(/.test(button.textContent.trim()))?.click());
    await page.waitForSelector(dialogSelector, { visible: true });
    await clickAndWait(page, '[data-estimate-overflow-confirm="1"]');
    await page.waitForFunction(() => document.body.innerText.includes('수량 수정 저장 완료'), { timeout: 30000 });
    await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some(row => row.textContent.includes('Deep Silver 50cm') && row.children[4]?.textContent.trim() === '55'), { timeout: 30000 });
    const progressHasNextRow = await page.evaluate(parent => document.body.innerText.includes(`${parent}-02 +5박스`), currentParent);
    if (!progressHasNextRow) problems.push('next-subweek row is missing from save progress');
    if (applyPosts !== 1) problems.push(`expected one confirmed apply POST, received ${applyPosts}`);
    if (forbiddenNormalWrites !== 0) problems.push(`legacy write path was called ${forbiddenNormalWrites} time(s)`);
    if (separateCostWrites !== 0) problems.push(`combined overflow used ${separateCostWrites} separate cost write(s)`);
    if (!combinedApplySeen) problems.push('confirmed apply did not retain combinedCosts items/mode/week');

    console.log(JSON.stringify({ viewport: '1920x1080', layout, applyPosts, forbiddenNormalWrites, separateCostWrites, combinedPreviewSeen, combinedApplySeen, liveQuantity, liveCost, screenshotPath, problems }, null, 2));
    if (problems.length) process.exitCode = 1;
  } catch (error) {
    const pages = await browser.pages();
    const failedPage = pages[pages.length - 1];
    if (failedPage) {
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      await failedPage.screenshot({ path: screenshotPath.replace(/\.png$/i, '-failure.png'), fullPage: false });
      console.error(await failedPage.evaluate(() => document.body.innerText.slice(-12000)));
    }
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });

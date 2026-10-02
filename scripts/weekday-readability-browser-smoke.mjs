import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildShippingCycles, normalizeCycleRequest, shiftDate, SHIPPING_DAYS } from '../lib/weekdayEstimateCycle.js';
import { weekdayProductLabel } from '../lib/weekdayHorizontalMatrix.js';
import { baselineDigest, canonicalRows } from '../lib/weekdayInitialBaselineStore.js';
import { buildWeekdayConfirmationSummary } from '../lib/weekdayConfirmation.js';

const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:20768';
assert.match(base, /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/i, 'only a loopback dev server is allowed');
assert.ok(process.env.PLAYWRIGHT_MODULE, 'PLAYWRIGHT_MODULE must point to the approved local Playwright module');
const playwrightModule = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const chromium = playwrightModule.chromium || playwrightModule.default?.chromium || playwrightModule['module.exports']?.chromium;
assert.ok(chromium, 'the approved Playwright module must expose chromium');
const periods = [];
for (let i = -7; i < 14; i += 1) {
  const day = SHIPPING_DAYS[((i % 7) + 7) % 7];
  periods.push({ BaseYmd: shiftDate('2026-09-17', i), WeekDay: day.code,
    OrderYearWeek: `2026${38 + Math.floor(i / 7) + (day.suffix === '02' ? 1 : 0)}` });
}
const cycles = buildShippingCycles(periods, normalizeCycleRequest({ year: 2026, majorWeek: 38 }));
const products = Array.from({ length: 50 }, (_, i) => ({ ProdKey: i + 101,
  ProdName: `${i === 0 ? 'ALSTROEMERIA' : i === 1 ? 'GYPSOPHILA' : 'CARNATION'} 품목 ${String(i + 1).padStart(2, '0')}`,
  OutUnit: i === 0 ? '단' : '박스', FlowerName: i === 0 ? '알스트로' : '카네이션',
  BunchOf1Box: i === 0 ? 16 : 15, SteamOf1Bunch: i === 0 ? 10 : 20, SteamOf1Box: i === 0 ? 160 : 300 }));
const productByKey = new Map(products.map(row => [row.ProdKey, row]));
const stockFor = (orderWeek, prodKey) => {
  if (prodKey === 101 && orderWeek === '38-01') return 48;
  if (prodKey === 102 && orderWeek === '38-01') return 0;
  if (prodKey === 103 && orderWeek === '38-01') return 0.1234567890123;
  return prodKey === 101 ? 32 : 2;
};
const comparisonRow = (orderWeek, prodKey) => {
  const major = orderWeek.slice(0, 2);
  const cycle = cycles.find(item => item.majorWeek === major);
  assert.ok(cycle, `fixture includes shipping cycle ${orderWeek}`);
  const day = cycle.days[orderWeek.endsWith('-01') ? 0 : 4];
  const quantity = stockFor(orderWeek, prodKey);
  const estimateQuantity = prodKey === 101 ? quantity * 16 : quantity * 100;
  const amount = Math.round(estimateQuantity * 1234.56 / 1.1);
  return { year: 2026, orderWeek, custKey: 533, prodKey, prodName: productByKey.get(prodKey).ProdName,
    flowerName: prodKey === 101 ? '알스트로' : prodKey < 126 ? '카네이션' : '장미',
    outUnit: prodKey === 101 ? '단' : '박스', estUnit: '송이', fixed: true,
    packaging: { bunchOf1Box: productByKey.get(prodKey).BunchOf1Box,
      steamOf1Bunch: productByKey.get(prodKey).SteamOf1Bunch, steamOf1Box: productByKey.get(prodKey).SteamOf1Box },
    state: 'FIXED_REVIEW_REQUIRED', shipmentOutQuantity: quantity, detailRows: 1,
    shipmentDates: [{ date: day.date, shipmentQuantity: quantity, estimateQuantity, detailFixed: true,
      weekDay: day.code, cost: 1234.56, amount, vat: estimateQuantity * 1234.56 - amount }] };
};
const snapshotFor = scope => {
  const rows = canonicalRows(products.map(product => {
    const row = comparisonRow(scope.orderWeek, product.ProdKey);
    return { prodKey: row.prodKey, prodName: row.prodName, flowerName: row.flowerName, unit: row.outUnit,
      quantity: row.shipmentOutQuantity, estUnit: row.estUnit,
      shipmentDates: row.shipmentDates.map(item => ({ date: item.date, orderWeek: scope.orderWeek,
        quantity: item.shipmentQuantity, estimateQuantity: item.estimateQuantity })) };
  }));
  return { ...scope, rows, digest: baselineDigest(scope, rows) };
};
const quoteItems = scope => products.flatMap(product => {
  const days = ['01', '02'].map(suffix => comparisonRow(`${scope.majorWeek}-${suffix}`, product.ProdKey))
    .flatMap(row => row.shipmentDates);
  if (!days.length) return [];
  const qty = days.reduce((sum, row) => sum + row.estimateQuantity, 0);
  return [{ _exePrint: true, _exeParity: true, ProdKey: product.ProdKey, ProdName: product.ProdName,
    Quantity: qty, UnitQuantity: `${qty}송이`, Cost: 1234.56,
    Amount: days.reduce((sum, row) => sum + row.amount, 0),
    Vat: days.reduce((sum, row) => sum + row.vat, 0), EstimateType: '정상출고' }];
});
const baselineRecords = [];
const baselineScope = { year: 2026, orderWeek: '37-01', custKey: 533 };
const baseline = snapshotFor(baselineScope);
baselineRecords.push({ version: 1, ...baseline, source: 'ERP_DISTRIBUTION', confirmedAt: '2026-09-01T00:00:00.000Z', confirmedBy: 'fixture' });
const noteRecords = [{ version: 1, year: 2026, majorWeek: '38', custKey: 533, prodKey: 101, revision: 1,
  note: 'Fixture note: quote mismatch review; decimal values 1234.567890123456789',
  earlyShipment: null, updatedAt: '2026-10-01T00:00:00.000Z', updatedBy: 'fixture' }];
const output = path.resolve('output/weekday-readability');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
const consoleErrors = [];
const environmentWarnings = [];
const calls = [];
const unexpectedApiWrites = [];
const externalRequests = [];
const assertions = [];
const previewScopes = new Set();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error') {
    if (message.text().includes('/_next/webpack-hmr')) environmentWarnings.push(message.text());
    else consoleErrors.push(message.text());
  }
});
await context.route('**/*', async route => {
  if (new URL(route.request().url()).origin !== new URL(base).origin) {
    externalRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  }
  return route.continue();
});
await page.route('**/api/**', async route => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.origin !== new URL(base).origin) return route.abort('blockedbyclient');
  calls.push({ path: url.pathname, method: req.method() });
  if (req.method() !== 'GET' && !['/api/estimate/weekday-baseline', '/api/estimate/weekday-compare', '/api/estimate/weekday-print'].includes(url.pathname))
    unexpectedApiWrites.push(`${req.method()} ${url.pathname}`);
  let data = { success: true };
  if (url.pathname === '/api/auth/me') data.user = { userId: 'fixture', userName: 'QA fixture', authority: 3 };
  else if (url.pathname === '/api/favorites') data.favorites = [];
  else if (url.pathname === '/api/customers/search') data.customers = [{ CustKey: 533, CustName: '주광농원' }];
  else if (url.pathname === '/api/estimate/weekday-calendar') data = { success: true, readOnly: true, scope: {year:2026,majorWeek:'38'}, cycles };
  else if (url.pathname === '/api/estimate/weekday-carryover') data = { success:true,readOnly:true,records:[],context:{custKey:533,cycles,inputs:[]} };
  else if (url.pathname === '/api/estimate/weekday-confirmation') {
    const majorWeek=url.searchParams.get('majorWeek');
    const categories=['콜롬비아장미','콜롬비아카네이션','콜롬비아수국','콜롬비아알스트로','중국국화','중국기타','네덜란드수국','네덜란드튤립','에콰도르장미','태국난','케냐장미','일본기타','이스라엘왁스'];
    data={success:true,readOnly:true,summary:buildWeekdayConfirmationSummary({year:2026,majorWeek},categories.map((CountryFlower,index)=>({OrderYear:2026,OrderWeek:`${majorWeek}-01`,CountryFlower,TotalCount:5,FixedCount:index===0&&majorWeek!=='39'?2:5,UnknownCount:index===0?1:0})))};
  }
  else if (url.pathname === '/api/estimate/weekday-products') data = { success: true,
    scope: { year: Number(url.searchParams.get('year')), custKey: Number(url.searchParams.get('custKey')),
      orderWeeks: url.searchParams.get('orderWeeks').split(',') }, products };
  else if (url.pathname === '/api/estimate/weekday-baseline') {
    if (req.method() === 'GET') data = { success: true, readOnly: true,
      baselines: baselineRecords.filter(row => row.year === Number(url.searchParams.get('year'))
        && row.custKey === Number(url.searchParams.get('custKey'))
        && url.searchParams.get('orderWeeks').split(',').includes(row.orderWeek)) };
    else {
      const body = req.postDataJSON();
      assert.equal(body.action, 'preview', 'fixture intercepts preview only; confirm is forbidden');
      previewScopes.add(`${body.year}|${body.orderWeek}|${body.custKey}`);
      const scope = { year: body.year, orderWeek: body.orderWeek, custKey: body.custKey };
      data = { success: true, readOnly: true, preview: snapshotFor(scope) };
    }
  } else if (url.pathname === '/api/estimate/weekday-compare') {
    const body = req.postDataJSON();
    data = { success: true, readOnly: true, scope: body, history: [], sourceLots: [], rows: body.orderWeeks.flatMap(orderWeek =>
      body.prodKeys.map(prodKey => comparisonRow(orderWeek, prodKey))) };
  } else if (url.pathname === '/api/estimate/weekday-changes') data = { success: true, readOnly: true, changes: [] };
  else if (url.pathname === '/api/estimate/weekday-note') data = { success: true, readOnly: true,
    notes: noteRecords.filter(row => row.year === Number(url.searchParams.get('year'))
      && row.majorWeek === url.searchParams.get('majorWeek') && row.custKey === Number(url.searchParams.get('custKey'))) };
  else if (url.pathname === '/api/estimate/weekday-print') {
    const scope = req.postDataJSON();
    data = { success: true, readOnly: true, scope, customer: { CustName: '주광농원' },
      draftIncluded: false, items: quoteItems(scope) };
  } else if (url.pathname === '/api/estimate') {
    assert.equal(req.method(), 'GET');
    const scope = { year: Number(url.searchParams.get('year')), majorWeek: url.searchParams.get('week') };
    const items = quoteItems(scope);
    // Deliberately diverge management from the saved print quote for Alstroemeria.
    const alstro = items.find(row => row.ProdKey === 101);
    if (alstro) alstro.Amount += 1;
    data = { success: true, items };
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
});

const check = (condition, label, details = '') => {
  assert.ok(condition, `${label}${details ? `: ${details}` : ''}`);
  assertions.push(label);
};
const boundsInside = async locator => locator.evaluate(el => {
  const r = el.getBoundingClientRect();
  return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
    && el.scrollWidth <= el.clientWidth + 2;
});
const verifyViewport = async (width, height, screenshot) => {
  await page.setViewportSize({ width, height });
  await page.waitForFunction(() => document.querySelectorAll('.wcm-scroll-width').length === 2
    && [...document.querySelectorAll('.wcm-scroll-width')].every(el => el.getBoundingClientRect().width > 0));
  const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    pageWidth: document.documentElement.scrollWidth,
    tableClient: document.querySelector('.wcm-table-scroll')?.clientWidth,
    tableScroll: document.querySelector('.wcm-table-scroll')?.scrollWidth,
    bars: ['.wcm-scroll-top', '.wcm-scroll-bottom'].map(selector => {
      const bar=document.querySelector(selector), spacer=bar.firstElementChild;
      const scrollbar=getComputedStyle(bar,'::-webkit-scrollbar');
      const thumb=getComputedStyle(bar,'::-webkit-scrollbar-thumb');
      return {selector,clientWidth:bar.clientWidth,scrollWidth:bar.scrollWidth,spacerWidth:spacer.getBoundingClientRect().width,
        display:scrollbar.display,height:scrollbar.height,thumbBackground:thumb.backgroundColor};
    }) }));
  check(metrics.pageWidth <= width + 1, `no page horizontal overflow at ${width}px`, JSON.stringify(metrics));
  check(metrics.tableScroll > metrics.tableClient, `matrix remains internally scrollable at ${width}px`);
  check(metrics.bars.every(bar => bar.display !== 'none' && bar.height === '16px'
      && bar.thumbBackground === 'rgb(84, 119, 159)' && bar.scrollWidth > bar.clientWidth
      && Math.abs(bar.spacerWidth - metrics.tableScroll) <= 1),
    `visible WebKit thumbs + synchronized spacer widths at ${width}px`, JSON.stringify(metrics.bars));
  await page.screenshot({ path: path.join(output, screenshot), fullPage: false });
  return metrics;
};
try {
  await page.goto(`${base}/estimate/weekday?popup=1`, { waitUntil: 'networkidle' });
  await page.getByRole('status').filter({ hasText: '전후 차수 전산 대조 완료' }).waitFor({ timeout: 30000 });
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(), 50, 'fixture loads 50 rows');
  assertions.push('50 product rows, saved baseline + unconfirmed preview data');
  assert.equal(await page.locator('.wcm-scroll-top').count(), 1);
  assert.equal(await page.locator('.wcm-scroll-bottom').count(), 1);
  assert.equal(await page.locator('.wcm-table-scroll').count(), 1);
  const scrolls = [page.locator('.wcm-scroll-top'), page.locator('.wcm-table-scroll'), page.locator('.wcm-scroll-bottom')];
  for (const [index, source] of scrolls.entries()) {
    await source.evaluate(el => { el.scrollLeft = Math.max(0, el.scrollWidth - el.clientWidth) * 0.55; el.dispatchEvent(new Event('scroll')); });
    await page.waitForFunction(() => {
      const els = ['.wcm-scroll-top', '.wcm-table-scroll', '.wcm-scroll-bottom'].map(sel => document.querySelector(sel));
      return els.every(el => el && Math.abs(el.scrollLeft - els[1].scrollLeft) < 2);
    });
    assertions.push(`synchronized horizontal scroll from ${['top bar', 'table', 'bottom bar'][index]}`);
  }
  await page.getByRole('button', { name: '현재 38차 보기', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.wcm-table-scroll').scrollLeft > 800);
  await page.waitForFunction(() => ['.wcm-scroll-top', '.wcm-scroll-bottom'].every(sel =>
    Math.abs(document.querySelector(sel).scrollLeft - document.querySelector('.wcm-table-scroll').scrollLeft) < 2));
  assertions.push('cycle jump moves synchronized horizontal surfaces');

  const matrix = page.locator('.weekday-cycle-matrix');
  const headerGeometry=await page.locator('thead .wcm-cycle-title').evaluateAll(headers=>headers.map(el=>({
    badges:el.querySelectorAll('.wcm-confirmations > span').length,
    overflow:el.scrollWidth>el.clientWidth+1,
    height:el.getBoundingClientRect().height,
  })));
  check(headerGeometry.length===3 && headerGeometry.every(item=>item.badges>=14 && item.badges<=16 && !item.overflow && item.height<110),
    '13 category states wrap compactly within all three cycle headers',JSON.stringify(headerGeometry));
  const fixedWarningHeader=page.locator('thead tr:first-child th').filter({hasText:'다음 2026 / 39차'});
  check(/ERP확정/.test(await fixedWarningHeader.innerText()) && /연결경고/.test(await fixedWarningHeader.innerText())
    && !/미확인/.test(await fixedWarningHeader.innerText()),'known fixed flags stay confirmed while link warnings remain visible');
  const controlMetrics = await page.locator('.wcm-toolbar, .wcm-cycle-jump').evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return { name: el.className, left: r.left, right: r.right, width: r.width, scroll: el.scrollWidth, client: el.clientWidth };
  }));
  check(controlMetrics.every(item => item.left >= -1 && item.right <= 1921 && item.scroll <= item.client + 2),
    'toolbar and jump labels/controls contained without overflow', JSON.stringify(controlMetrics));
  const fontSizes = await page.evaluate(() => ({
    primary: [...document.querySelectorAll('.wcm-major-total [data-wcm-label="remainder"]')].map(el => parseFloat(getComputedStyle(el).fontSize)),
    sum: [...document.querySelectorAll('.wcm-major-total [data-wcm-label="sum"] .wcm-sum-value')].map(el => parseFloat(getComputedStyle(el).fontSize)),
    meta: [...document.querySelectorAll('.wcm-remainder-status, .wcm-cycle-sum')].map(el => parseFloat(getComputedStyle(el).fontSize)),
    originals: [...document.querySelectorAll('.wcm-number-display, .wcm-original, .wcm-cell input')]
      .map(el => parseFloat(getComputedStyle(el).fontSize)),
  }));
  check(fontSizes.primary.length > 0 && fontSizes.primary.every(size => size >= 18), 'primary summary typography >=18px', JSON.stringify(fontSizes));
  check(fontSizes.sum.length > 0 && fontSizes.sum.every(size => size >= 18), 'full-width summary sum typography >=18px', JSON.stringify(fontSizes));
  check(fontSizes.meta.length > 0 && fontSizes.meta.every(size => size >= 12), 'secondary summary typography >=12px', JSON.stringify(fontSizes));
  check(fontSizes.originals.length > 0 && fontSizes.originals.every(size => size >= 18), 'original/display/input quantity typography >=18px', JSON.stringify(fontSizes));
  const summaryGeometry = await page.locator('.wcm-table-scroll .wcm-major-total').evaluateAll(cells => cells.map(el => {
    const heading = el.querySelector('.wcm-major-heading');
    const sum = el.querySelector('.wcm-cycle-sum');
    const primary = el.querySelector('.wcm-major-heading .wcm-remainder-value');
    const total = el.querySelector('[data-wcm-label="sum"] .wcm-sum-value');
    const actions = el.querySelector('.wcm-summary-actions');
    if (![heading, sum, primary, total, actions].every(Boolean)) return { missing: true };
    const inside = node => { const r=node.getBoundingClientRect(), c=el.getBoundingClientRect(); return r.left>=c.left-1&&r.right<=c.right+1&&r.top>=c.top-1&&r.bottom<=c.bottom+1; };
    const noOverlap = (a,b) => { const x=a.getBoundingClientRect(),y=b.getBoundingClientRect(); return x.right<=y.left+1||y.right<=x.left+1||x.bottom<=y.top+1||y.bottom<=x.top+1; };
    const width=el.getBoundingClientRect().width;
    const padding=[...getComputedStyle(el).padding.split(' ')].map(value=>parseFloat(value));
    return { missing:false, contained:[heading,sum,primary,total,actions].every(inside),
      separated:noOverlap(heading,sum)&&noOverlap(sum,actions)&&noOverlap(total,actions),
      fullWidth:sum.getBoundingClientRect().width>=width-12, compactPadding:padding.every(value=>value<=3),
      sumDisplay:getComputedStyle(sum).display,actionsDisplay:getComputedStyle(actions).display,
      cell:el.closest('tr')?.firstElementChild?.innerText, sum:total.innerText };
  }));
  check(summaryGeometry.length>0 && summaryGeometry.every(item=>!item.missing&&item.contained&&item.separated&&item.fullWidth
      &&item.compactPadding&&item.sumDisplay==='grid'&&item.actionsDisplay==='grid'),
    'three summary rows, compact padding, and action rows stay contained/non-overlapping',
    JSON.stringify(summaryGeometry.filter(item=>item.missing||!item.contained||!item.separated||!item.fullWidth||!item.compactPadding||item.sumDisplay!=='grid'||item.actionsDisplay!=='grid').slice(0,12)));

  const row = page.locator('.wcm-table-scroll tbody tr').first();
  await row.locator('th').hover();
  check(await row.locator('th,td').evaluateAll(els => els.every(el => getComputedStyle(el).boxShadow !== 'none')), 'hover highlight spans whole row');
  const alstroCell = page.getByLabel('ALSTROEMERIA 품목 01 2026/38-01 2026-09-17 미적용 초안 수량', { exact: true });
  check((await alstroCell.locator('..').locator('.wcm-number-display').innerText()) === '48(3)', 'Alstro fixture exposes 48(3) saved ERP quantity');
  await alstroCell.fill('50');
  await alstroCell.press('Enter');
  await page.getByRole('status').filter({ hasText: '요일 수량 초안을 기록했습니다' }).waitFor();
  const alstroRow = page.locator('.wcm-table-scroll tbody tr').filter({ hasText: '품목 01' }).first();
  const alstroDraftText = await alstroCell.locator('..').locator('.wcm-number-display').innerText();
  check(alstroDraftText.replace(/\s+/g, '') === '50(3박스2단)', 'Alstro local draft display avoids decimal-box notation', alstroDraftText);
  check(await alstroRow.locator('.wcm-quote.wcm-warning').count() > 0, 'quote mismatch is visibly marked');
  const decimalCell = page.getByLabel('CARNATION 품목 03 2026/38-01 2026-09-17 미적용 초안 수량', { exact: true });
  const decimalText = await decimalCell.locator('..').locator('.wcm-number-display').innerText();
  const decimalInput = await decimalCell.inputValue();
  check(decimalInput === '0.1234567890123' && decimalText.replace(/\s+/g, '') === '0.123457박스·환산확인', 'unconvertible decimal shows source-scale review label while input remains raw', `${decimalInput} → ${decimalText}`);
  const numberOverflow = await page.locator('.wcm-number-display, .wcm-original').evaluateAll(els => els
    .filter(el => el.getBoundingClientRect().width > 0)
    .map(el => ({ text: el.innerText, width: el.clientWidth, scroll: el.scrollWidth }))
    .filter(item => item.scroll > item.width + 1));
  check(numberOverflow.length === 0, 'formatted original quantities wrap without overlapping adjacent cells', JSON.stringify(numberOverflow.slice(0, 12)));
  const cellNumberGeometry = await page.locator('.wcm-table-scroll tbody td').evaluateAll(cells => cells.flatMap((cell, column) => {
    const parent=cell.getBoundingClientRect();
    return [...cell.querySelectorAll('.wcm-number-display, .wcm-original, .wcm-remainder-value, .wcm-sum-value, .wcm-quantity-part')]
      .filter(node=>node.getBoundingClientRect().width>0)
      .map(node=>{const r=node.getBoundingClientRect();return {row:cell.parentElement?.firstElementChild?.innerText,column,text:node.innerText,
        boundsInsideCell:r.left>=parent.left-1&&r.right<=parent.right+1&&r.top>=parent.top-1&&r.bottom<=parent.bottom+1,
        clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,scrolls:node.scrollWidth>node.clientWidth+1};})
      .filter(item=>!item.boundsInsideCell||item.scrolls);
  }));
  check(cellNumberGeometry.length===0, 'every rendered numeric part stays inside its own td without client-width overflow (including CARNATION decimal)',
    JSON.stringify(cellNumberGeometry.slice(0,20)));
  assert.equal(previewScopes.size, 5);

  await alstroCell.focus();
  const selected = page.locator('.wcm-selected');
  check(await boundsInside(selected), 'selected-cell detail fits viewport');
  const selectedMetrics=await selected.evaluate(el=>({width:el.getBoundingClientRect().width,font:parseFloat(getComputedStyle(el).fontSize)}));
  check(selectedMetrics.width>=760 && selectedMetrics.font>=18,'selected-cell detail is 760px wide with 18px text',JSON.stringify(selectedMetrics));
  await page.setViewportSize({width:1280,height:800});
  check(await boundsInside(selected),'selected-cell detail fits 1280x800');
  await page.setViewportSize({width:800,height:800});
  check(await boundsInside(selected),'selected-cell detail fits 800x800');
  await page.setViewportSize({width:1920,height:1080});
  await page.screenshot({ path: path.join(output, '1920x1080-selected-detail.png') });
  await page.getByRole('button', { name: '선택 칸 내역 닫기' }).click();

  await page.getByRole('button', { name: 'ALSTROEMERIA 품목 01 2026/38차 변경 비고', exact: true }).click();
  const noteDialog = page.getByRole('dialog', { name: '수량 변경 비고' });
  await noteDialog.waitFor();
  check(await boundsInside(noteDialog), 'note dialog fits viewport without inner horizontal overflow');
  await page.screenshot({ path: path.join(output, '1920x1080-note-dialog.png') });

  await noteDialog.getByRole('button', { name: '비고창 닫기' }).click();
  await verifyViewport(1920, 1080, '1920x1080.png');
  await page.getByRole('button', { name: 'ALSTROEMERIA 품목 01 2026/38차 변경 비고', exact: true }).click();
  await noteDialog.waitFor();
  await page.setViewportSize({ width: 1280, height: 800 });
  check(await boundsInside(noteDialog), 'note dialog fits 1280x800 viewport');
  await verifyViewport(1280, 800, '1280x800.png');
  await noteDialog.getByRole('button', { name: '비고창 닫기' }).click();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(100);
  const sticky = await page.locator('.wcm-scroll-bottom').evaluate(el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height, viewport: innerHeight,
      position: getComputedStyle(el).position, visible: r.bottom > 0 && r.top < innerHeight };
  });
  check(sticky.position === 'sticky' && sticky.visible && sticky.height >= 18, 'bottom horizontal control remains accessible after vertical scroll', JSON.stringify(sticky));
  await page.screenshot({ path: path.join(output, '1280x800-bottom-sticky.png') });
  await page.getByPlaceholder('품목명 / 품목키').fill('GYPSOPHILA');
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(), 1, 'filter narrows to matching row');
  await page.locator('.wcm-scroll-bottom').evaluate(el => { el.scrollLeft = 1000; el.dispatchEvent(new Event('scroll')); });
  await page.waitForFunction(() => Math.abs(document.querySelector('.wcm-scroll-bottom').scrollLeft - document.querySelector('.wcm-table-scroll').scrollLeft) < 2);
  assertions.push('filter updates matrix while bottom-bar scrolling remains synchronized');
  await page.getByPlaceholder('품목명 / 품목키').fill('');
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(), 50);
  check(unexpectedApiWrites.length === 0, 'no unexpected API write endpoints', JSON.stringify(unexpectedApiWrites));
  check(externalRequests.length === 0, 'no external network requests', JSON.stringify(externalRequests));
  check(previewScopes.size === 5,
    'all baseline POSTs are preview-only; no confirmation request');
  assert.ok(!errors.length, `browser page errors: ${errors.join(' | ')}`);
  assert.ok(!consoleErrors.length, `browser console errors: ${consoleErrors.join(' | ')}`);
  console.log(JSON.stringify({ result: 'PASS', base, viewport: '1920x1080 CSS px, deviceScaleFactor=1 (100%)',
    screenshots: ['1920x1080.png', '1280x800.png', '1920x1080-selected-detail.png', '1920x1080-note-dialog.png', '1280x800-bottom-sticky.png'].map(file => path.join(output, file)),
    assertions, apiCalls: calls.length, pageErrors: errors, consoleErrors, environmentWarnings, externalRequests }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: false }).catch(() => {});
  console.error(JSON.stringify({ result: 'FAIL', error: error.stack || String(error), output: path.join(output, 'failure.png'), assertions, calls, externalRequests, environmentWarnings }, null, 2));
  process.exitCode = 1;
} finally {
  const closeTimeout = () => new Promise(resolve => setTimeout(resolve, 5000));
  await Promise.race([context.close(), closeTimeout()]);
  await Promise.race([browser.close(), closeTimeout()]);
  process.exit(process.exitCode ?? 0);
}

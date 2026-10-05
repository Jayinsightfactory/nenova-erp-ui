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
let quoteFailureMode = false;
const quoteFailureMessage = `fixture weekday quote failure — ${'상세 오류 원문 반복 확인용. '.repeat(240)}`;
const quoteFailureRequests = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome', ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
const consoleErrors = [];
const expectedQuoteFailureConsoleErrors = [];
const environmentWarnings = [];
const calls = [];
const quoteFailureStatuses = [];
const unexpectedApiWrites = [];
const externalRequests = [];
const assertions = [];
const previewScopes = new Set();
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (quoteFailureMode && new URL(response.url()).pathname === '/api/estimate/weekday-print')
    quoteFailureStatuses.push(response.status());
});
page.on('console', message => {
  if (message.type() === 'error') {
    const text = message.text();
    const locationUrl = message.location().url;
    const expectedQuoteUrl = new URL('/api/estimate/weekday-print', base).href;
    const isInjectedQuote409 = quoteFailureMode && locationUrl === expectedQuoteUrl
      && /^Failed to load resource: the server responded with a status of 409 \(Conflict\)$/.test(text);
    if (isInjectedQuote409) expectedQuoteFailureConsoleErrors.push({ url: locationUrl, text });
    else if (text.includes('/_next/webpack-hmr')) environmentWarnings.push(text);
    else consoleErrors.push(text);
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
    if (quoteFailureMode) {
      quoteFailureRequests.push({ year: scope.year, majorWeek: String(scope.majorWeek), custKey: scope.custKey });
      return route.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify({ success: false, error: quoteFailureMessage }) });
    }
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
  await page.locator('.wcm-table-scroll').evaluate(el=>{el.scrollTop=400;});
  const stickyHeader=await page.locator('.wcm-table-scroll').evaluate(el=>{
    const head=el.querySelector('thead'),r=head.getBoundingClientRect(),v=el.getBoundingClientRect();
    return {top:r.top,viewportTop:v.top,z:Number(getComputedStyle(head).zIndex)};
  });
  check(Math.abs(stickyHeader.top-stickyHeader.viewportTop)<2 && stickyHeader.z>4,'vertical scroll keeps header above body controls',JSON.stringify(stickyHeader));
  await page.locator('.wcm-table-scroll').evaluate(el=>{el.scrollTop=0;});
  assert.equal(await page.locator('.wcm-confirmation-disclosure:not([open])').count(),3);
  for(const disclosure of await page.locator('.wcm-confirmation-disclosure').all()) {
    await disclosure.locator('summary').click();
    assert.ok(await disclosure.locator('.wcm-confirmations').isVisible());
    await disclosure.locator('summary').click();
  }
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
    const content=el.querySelector('.wcm-compact-summary'), c=el.getBoundingClientRect(),r=content.getBoundingClientRect();
    return {contained:r.left>=c.left-1&&r.right<=c.right+1, width:c.width};
  }));
  check(summaryGeometry.length===450 && summaryGeometry.every(item=>item.contained && item.width<90),
    'three actual narrow summary cells per cycle stay contained',JSON.stringify(summaryGeometry.filter(item=>!item.contained).slice(0,12)));

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
  await page.locator('.wcm-filter-disclosure > summary').click();
  await page.getByPlaceholder('품목명 / 품목키').fill('GYPSOPHILA');
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(), 1, 'filter narrows to matching row');
  await page.locator('.wcm-scroll-bottom').evaluate(el => { el.scrollLeft = 1000; el.dispatchEvent(new Event('scroll')); });
  await page.waitForFunction(() => Math.abs(document.querySelector('.wcm-scroll-bottom').scrollLeft - document.querySelector('.wcm-table-scroll').scrollLeft) < 2);
  assertions.push('filter updates matrix while bottom-bar scrolling remains synchronized');
  await page.getByPlaceholder('품목명 / 품목키').fill('');
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(), 50);

  // Final regression stage: inject the same long 409 quote failure for all three cycles.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => { window.scrollTo(0, 0); });
  const successfulRowGeometry = await page.locator('.wcm-table-scroll tbody tr').evaluateAll(rows => rows.map(row => ({
    product: row.querySelector('th[scope="row"]')?.innerText.trim() || '',
    height: row.getBoundingClientRect().height,
    hasDraft: Boolean(row.querySelector('.wcm-draft')),
    text: row.innerText,
    inputValues: [...row.querySelectorAll('input')].map(input => input.value),
  })));
  assert.equal(successfulRowGeometry.length, 50, 'capture successful-flow row-height baseline for all products');
  const knownSpecialRows = [
    successfulRowGeometry.find(row => /품목 01/.test(row.product)),
    successfulRowGeometry.find(row => /품목 03/.test(row.product)),
  ];
  assert.ok(knownSpecialRows.every(Boolean), 'successful-flow baseline includes the two known tall-content fixtures');
  const [longDraftRow, unconvertibleDecimalRow] = knownSpecialRows;
  assert.ok(longDraftRow.hasDraft && longDraftRow.text.includes('초안') && longDraftRow.text.includes('50'),
    `품목 01 remains identified as the long-label draft fixture: ${JSON.stringify(longDraftRow)}`);
  assert.ok(unconvertibleDecimalRow.text.replace(/\s/g, '').includes('환산확인')
      && unconvertibleDecimalRow.inputValues.includes('0.1234567890123'),
    `품목 03 remains identified as the unconvertible decimal fixture: ${JSON.stringify(unconvertibleDecimalRow)}`);
  const unexpectedTallSuccessfulRows = successfulRowGeometry.filter(row => row.height >= 160
    && !knownSpecialRows.includes(row));
  assert.equal(unexpectedTallSuccessfulRows.length, 0,
    `only known 품목 01/03 fixture rows may reach 160px: ${JSON.stringify(unexpectedTallSuccessfulRows)}`);
  assert.ok(knownSpecialRows.every(row => row.height < 200)
      && successfulRowGeometry.every(row => row.height < 160 || knownSpecialRows.includes(row)),
    `successful-flow default rows stay below 160px; both known special rows stay below 200px: ${JSON.stringify(successfulRowGeometry.map(({product,height}) => ({product,height})))}`);

  quoteFailureMode = true;
  await page.getByRole('button', { name: '전산 새로고침', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('thead .wcm-quote-error').length === 3
    && [...document.querySelectorAll('thead .wcm-quote-error pre')].every(pre => pre.textContent.startsWith('fixture weekday quote failure')));
  assert.equal(await page.locator('.wcm-table-scroll tbody tr').count(), 50, 'quote failures retain all 50 product rows');
  assert.deepEqual(quoteFailureRequests.map(scope => `${scope.year}/${scope.majorWeek}`).sort(),
    ['2026/37', '2026/38', '2026/39'], 'the 409 fixture covers all three cycle scopes exactly once');
  assert.equal(quoteFailureStatuses.length, 3, 'all three cycle quote requests receive fixture responses');
  assert.ok(quoteFailureStatuses.every(status => status === 409),
    `all three quote requests return HTTP 409: ${JSON.stringify(quoteFailureStatuses)}`);
  assert.equal(await page.locator('thead .wcm-quote-error').count(), 3, 'one quote-error disclosure per cycle header');
  assert.equal(await page.locator('thead .wcm-quote-error:not([open])').count(), 3, 'all cycle error disclosures start collapsed');
  const failureMarkup = await page.locator('.weekday-cycle-matrix').evaluate(el => el.innerHTML);
  assert.equal(failureMarkup.split(quoteFailureMessage).length - 1, 3,
    'the long identical error is rendered once in each of the three headers only');
  const failedCells = await page.locator('.wcm-table-scroll tbody .wcm-major-total').evaluateAll(cells => cells.map(cell => ({
    repeatsError: cell.innerText.includes('fixture weekday quote failure'),
    hasFailureButton: [...cell.querySelectorAll('.wcm-quote .wcm-inline-status')].some(status => status.textContent === '견적 조회실패'),
  })));
  assert.equal(failedCells.length, 450, 'all 50 rows retain nine compact summary cells');
  assert.ok(failedCells.every(cell => !cell.repeatsError) && failedCells.filter(cell=>cell.hasFailureButton).length===150,
    'item cells show the failure button without copying the long error');
  const errorRowGeometry = await page.locator('.wcm-table-scroll tbody tr').evaluateAll(rows => rows.map(row => ({
    product: row.querySelector('th[scope="row"]')?.innerText.trim() || '',
    height: row.getBoundingClientRect().height,
    hasDraft: Boolean(row.querySelector('.wcm-draft')),
  })));
  const successHeightByProduct = new Map(successfulRowGeometry.map(row => [row.product, row.height]));
  const rowHeightChanges = errorRowGeometry.map(row => ({ ...row, successHeight: successHeightByProduct.get(row.product),
    addedHeight: row.height - (successHeightByProduct.get(row.product) ?? 0) }));
  assert.ok(errorRowGeometry.length === 50 && errorRowGeometry.every(row => successHeightByProduct.has(row.product)),
    'failure-flow rows match the successful-flow product baseline');
  assert.ok(rowHeightChanges.every(row => row.addedHeight <= 1),
    `quote failures add no material product-row height versus the successful flow: ${JSON.stringify(rowHeightChanges.filter(row => row.addedHeight > 1))}`);
  assert.ok(knownSpecialRows.every(special => rowHeightChanges.find(row => row.product === special.product)?.height < 200)
      && rowHeightChanges.every(row => row.height < 160 || knownSpecialRows.some(special => special.product === row.product)),
    `default rows remain below 160px; known 품목 01/03 special rows stay below 200px: ${JSON.stringify(rowHeightChanges.filter(row => row.height >= 160))}`);
  check(await page.evaluate(() => innerWidth === 1920 && innerHeight === 1080 && devicePixelRatio === 1),
    'quote error regression uses 1920x1080 CSS px at 100%');
  await page.getByRole('button', { name: '현재 38차 보기', exact: true }).click();
  await page.screenshot({ path: path.join(output, '1920x1080-quote-errors-collapsed.png'), fullPage: false });

  const currentCycleHeader = page.locator('thead tr:first-child th[scope="colgroup"]').filter({ hasText: '현재 2026 / 38차' });
  const currentQuoteDetails = currentCycleHeader.locator('details.wcm-quote-error');
  assert.equal(await currentQuoteDetails.count(), 1, 'current cycle header has one error disclosure');
  await currentQuoteDetails.locator('summary').click();
  const errorDetailsMetrics = await currentQuoteDetails.locator('pre').evaluate(pre => {
    const style = getComputedStyle(pre), rect = pre.getBoundingClientRect();
    return { height: rect.height, maxBlockSize: style.maxBlockSize, overflowY: style.overflowY,
      scrollHeight: pre.scrollHeight, clientHeight: pre.clientHeight };
  });
  assert.ok(errorDetailsMetrics.height <= 146 && errorDetailsMetrics.overflowY === 'auto'
      && errorDetailsMetrics.scrollHeight > errorDetailsMetrics.clientHeight,
    `expanded error text stays bounded and internally scrollable: ${JSON.stringify(errorDetailsMetrics)}`);
  const quoteErrorCell = page.locator('.wcm-table-scroll tbody tr').first().locator('.wcm-major-total').nth(3);
  await quoteErrorCell.locator('button.wcm-quote').click();
  const selectedQuoteInfo = page.locator('.wcm-selected');
  await selectedQuoteInfo.waitFor();
  assert.match(await selectedQuoteInfo.innerText(), /조회 필요[\s\S]*fixture weekday quote failure/,
    'quote failure button opens selectedInfo with the state and complete error');
  await page.screenshot({ path: path.join(output, '1920x1080-quote-error-details-selected.png'), fullPage: false });

  check(unexpectedApiWrites.length === 0, 'no unexpected API write endpoints', JSON.stringify(unexpectedApiWrites));
  check(externalRequests.length === 0, 'no external network requests', JSON.stringify(externalRequests));
  check(previewScopes.size === 5,
    'all baseline POSTs are preview-only; no confirmation request');
  assert.ok(!errors.length, `browser page errors: ${errors.join(' | ')}`);
  assert.ok(!consoleErrors.length, `browser console errors: ${consoleErrors.join(' | ')}`);
  console.log(JSON.stringify({ result: 'PASS', base, viewport: '1920x1080 CSS px, deviceScaleFactor=1 (100%)',
    screenshots: ['1920x1080.png', '1280x800.png', '1920x1080-selected-detail.png', '1920x1080-note-dialog.png', '1280x800-bottom-sticky.png',
      '1920x1080-quote-errors-collapsed.png', '1920x1080-quote-error-details-selected.png'].map(file => path.join(output, file)),
    assertions, apiCalls: calls.length, quoteFailureRequests, pageErrors: errors, consoleErrors,
    expectedQuoteFailureConsoleErrors, environmentWarnings, externalRequests }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: false }).catch(() => {});
  console.error(JSON.stringify({ result: 'FAIL', error: error.stack || String(error), output: path.join(output, 'failure.png'),
    assertions, calls, quoteFailureRequests, quoteFailureStatuses, consoleErrors,
    expectedQuoteFailureConsoleErrors, externalRequests, environmentWarnings }, null, 2));
  process.exitCode = 1;
} finally {
  const closeTimeout = () => new Promise(resolve => setTimeout(resolve, 5000));
  await Promise.race([context.close(), closeTimeout()]);
  await Promise.race([browser.close(), closeTimeout()]);
  process.exit(process.exitCode ?? 0);
}

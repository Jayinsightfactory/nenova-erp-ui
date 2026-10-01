// Local fixture only: every API is intercepted; no external request or ERP/operating write is possible.
// SMOKE_BASE_URL=http://127.0.0.1:20768 PLAYWRIGHT_MODULE=C:/Users/USER/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js node scripts/weekday-carryover-browser-smoke.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import XLSX from 'xlsx';
import { parseWeekdayEstimateBuffer } from '../lib/weekdayEstimateWorkbook.js';
import { buildShippingCycles, normalizeCycleRequest, shiftDate, SHIPPING_DAYS } from '../lib/weekdayEstimateCycle.js';

const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:20768';
assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
assert.ok(process.env.PLAYWRIGHT_MODULE, 'NEEDS_MAIN_PREFLIGHT: set the prepared Playwright module path');
const screenshotDirectory = path.resolve('output/weekday-carryover');
fs.mkdirSync(screenshotDirectory, { recursive: true });
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const chromium = playwright.chromium || playwright.default?.chromium || playwright['module.exports']?.chromium;
assert.ok(chromium, 'prepared Playwright module does not expose chromium');

const periodRows = [];
const anchorByWeek = new Map();
for (let index = -1; index <= 3; index += 1) {
  const date = shiftDate('2026-09-17', index * 7);
  const week = String(38 + index).padStart(2, '0');
  anchorByWeek.set(week, date);
  for (const [dayIndex, day] of SHIPPING_DAYS.entries()) {
    periodRows.push({ BaseYmd: shiftDate(date, dayIndex), WeekDay: day.code, OrderYearWeek: `2026${week}` });
  }
}
function cyclesFor(year, majorWeek) {
  return buildShippingCycles(periodRows, normalizeCycleRequest({ year, majorWeek }));
}
const initialCycles = cyclesFor(2026, '38');
const savedRecords = [];
const requests = [];
const printRequests = [];
const compareScopes = [];
const pageErrors = [];
let postRecord = null;
const allocationByWeek = { '37': 12, '38': 8, '39': 3, '40': 0, '41': 0 };
const basisByWeek = { '37': 12, '38': 10, '39': 4, '40': 5, '41': 5 };

function baselineRows(year, orderWeeks, custKey) {
  return orderWeeks.map(orderWeek => {
    const major = orderWeek.slice(0, 2);
    const quantity = major === '37' ? 6 : major === '38' ? 5
      : major === '39' ? 2 : 0;
    return { year, orderWeek, custKey, confirmedAt: '2026-10-01T00:00:00.000Z', confirmedBy: 'fixture',
      rows: [{ prodKey: 866, prodName: 'CARNATION carry fixture', unit: '박스',
        quantity }] };
  });
}
function comparisonRows(year, orderWeeks, custKey) {
  return orderWeeks.map(orderWeek => {
    const major = orderWeek.slice(0, 2);
    const out = major === '37' ? 6 : major === '38' ? (orderWeek.endsWith('01') ? 7 : 1)
      : major === '39' ? (orderWeek.endsWith('01') ? 2 : 1) : 0;
    const cycle = cyclesFor(year, major);
    const dates = cycle.flatMap(item => item.days).filter(day => day.orderWeek === orderWeek);
    let shipmentDates = out && dates.length ? [{ date: dates[0].date, shipmentQuantity: out, estimateQuantity: out * 10 }] : [];
    if (major === '38' && orderWeek.endsWith('01')) {
      const sunday = cycle.flatMap(item => item.days).find(day => day.label === '일' && day.orderWeek === '38-01');
      shipmentDates = [{ date: sunday.date, shipmentQuantity: 7, estimateQuantity: 70 }];
    } else if (major === '38' && orderWeek.endsWith('02')) {
      const sunday = cycle.flatMap(item => item.days).find(day => day.label === '일' && day.orderWeek === '38-01');
      shipmentDates = [{ date: sunday.date, shipmentQuantity: 0, estimateQuantity: 0 },
        { date: dates[0].date, shipmentQuantity: 1, estimateQuantity: 10 }];
    }
    return { year, orderWeek, custKey, prodKey: 866, prodName: 'CARNATION carry fixture', flowerName: '카네이션',
      outUnit: '박스', detailRows: out ? 1 : 0, shipmentOutQuantity: out,
      state: out ? 'FIXED_REVIEW_REQUIRED' : 'NO_SHIPMENT', fixed: true,
      shipmentDates };
  });
}
function carryoverResponse(year, majorWeek, custKey) {
  const visibleCycles = cyclesFor(year, majorWeek);
  const chainStart = cyclesFor(year, '38');
  const cycleMap = new Map([...chainStart, ...visibleCycles].map(cycle => [`${cycle.year}|${cycle.majorWeek}`, cycle]));
  const cycles = [...cycleMap.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const inputs = cycles.map(cycle => {
    const week = String(cycle.majorWeek);
    return { year: cycle.year, majorWeek: week, startDate: cycle.startDate, endDate: cycle.endDate,
      custKey, prodKey: 866, prodName: 'CARNATION carry fixture', flowerName: '카네이션', outUnit: '박스', unit: '박스',
      basis: basisByWeek[week] ?? null, allocated: allocationByWeek[week] ?? null,
      valid: Object.hasOwn(basisByWeek, week), provisional: false, hasDraft: false, error: '' };
  });
  return { success: true, readOnly: true, records: structuredClone(savedRecords), context: { custKey, cycles, inputs } };
}

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ['요일별 계획'],
  ['카네이션', 'Moon Light', '', '', '', '(20일) 일요일 출고 예정', '(22일) 화요일 출고 예정'],
  ['', 'Moon Light', '', '', '', 8, 6],
]), '현장');
const workbookBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
const parsedWorkbook = parseWeekdayEstimateBuffer(workbookBuffer, { fileName: 'weekday-carryover-fixture.xlsx' });

const browser = await chromium.launch({ headless: true, channel: process.env.SMOKE_BROWSER_CHANNEL || 'chrome' });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', error => pageErrors.push(error.message));
await page.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== base) return route.abort('blockedbyclient');
  if (!url.pathname.startsWith('/api/')) return route.continue();
  requests.push({ path: url.pathname, method: request.method() });
  let body = { success: true };
  const query = Object.fromEntries(url.searchParams.entries());
  if (url.pathname === '/api/auth/me') body = { user: { userId: 'carry-fixture', userName: 'carry fixture', authority: 3 } };
  else if (url.pathname === '/api/favorites') body = { favorites: [] };
  else if (url.pathname === '/api/customers/search') body = { customers: [{ CustKey: 533, CustName: '주광농원', CustArea: 'fixture' }] };
  else if (url.pathname === '/api/estimate/weekday-calendar') {
    const center = query.defaultNext === '1' ? '38' : String(query.majorWeek || '38').padStart(2, '0');
    body = { success: true, readOnly: true, scope: { year: 2026, majorWeek: center, orderYearWeek: `2026${center}` }, cycles: cyclesFor(2026, center) };
  } else if (url.pathname === '/api/estimate/weekday-carryover' && request.method() === 'GET') {
    body = carryoverResponse(Number(query.year), String(query.majorWeek).padStart(2, '0'), Number(query.custKey));
  } else if (url.pathname === '/api/estimate/weekday-carryover' && request.method() === 'POST') {
    const input = request.postDataJSON();
    assert.deepEqual(Object.keys(input).sort(), ['custKey', 'expectedRevision', 'majorWeek', 'prodKey', 'quantity', 'reason', 'unit', 'year'].sort());
    assert.equal(input.year, 2026); assert.equal(input.majorWeek, '37'); assert.equal(input.custKey, 533);
    assert.equal(input.prodKey, 866); assert.equal(input.unit, '박스'); assert.equal(input.quantity, 5);
    const previous = savedRecords[0] || null;
    assert.equal(input.expectedRevision, previous?.revision ?? 0);
    if (!previous) assert.equal(input.reason, 'fixture 37차 마감');
    const revision = input.expectedRevision + 1;
    const timestamp = new Date(Date.UTC(2026, 9, 1, 0, 0, revision - 1)).toISOString();
    const entry = { before: previous?.quantity ?? null, after: 5, reason: input.reason,
      actor: 'carry-fixture', timestamp, revision };
    postRecord = { version: 1, ...input, majorWeek: '37', startDate: anchorByWeek.get('37'), revision,
      updatedAt: timestamp, updatedBy: 'carry-fixture', history: [...(previous?.history || []), entry] };
    savedRecords.splice(0, savedRecords.length, postRecord);
    body = { success: true, record: postRecord, erpChanged: false };
  } else if (url.pathname === '/api/estimate/weekday-products') {
    const year = Number(query.year), orderWeeks = String(query.orderWeeks || '').split(',').filter(Boolean);
    body = { success: true, scope: { year, custKey: Number(query.custKey), orderWeeks },
      products: [{ ProdKey: 866, ProdName: 'CARNATION carry fixture', OutUnit: '박스', outUnit: '박스', FlowerName: '카네이션', CounName: 'fixture' }] };
  } else if (url.pathname === '/api/estimate/weekday-baseline' && request.method() === 'GET') {
    body = { success: true, baselines: baselineRows(Number(query.year), String(query.orderWeeks || '').split(',').filter(Boolean), Number(query.custKey)) };
  } else if (url.pathname === '/api/estimate/weekday-baseline' && request.method() === 'POST') {
    const input = request.postDataJSON();
    body = { success: true, readOnly: true, preview: { year: input.year, orderWeek: input.orderWeek, custKey: input.custKey, rows: [] } };
  } else if (url.pathname === '/api/estimate/weekday-compare' && request.method() === 'POST') {
    const input = request.postDataJSON();
    compareScopes.push(input);
    body = { success: true, readOnly: true, scope: input, rows: comparisonRows(input.year, input.orderWeeks, input.custKey), sourceLots: [], history: [] };
  } else if (url.pathname === '/api/estimate/weekday-changes') body = { success: true, changes: [] };
  else if (url.pathname === '/api/estimate/weekday-note' && request.method() === 'GET') body = { success: true, notes: [] };
  else if (url.pathname === '/api/estimate/weekday-print' && request.method() === 'POST') {
    const input = request.postDataJSON(); printRequests.push(input); body = { success: true, items: [] };
  } else if (url.pathname === '/api/estimate') body = { items: [] };
  else if (url.pathname === '/api/estimate/weekday-upload-preview') body = { success: true, ...parsedWorkbook };
  else if (url.pathname === '/api/products/search') body = { products: [{ ProdKey: 866, ProdName: 'CARNATION carry fixture', CounName: 'fixture', FlowerName: '카네이션' }] };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

try {
  await page.goto(`${base}/estimate/weekday?popup=1`, { waitUntil: 'networkidle' });
  await page.getByLabel('중심 차수').waitFor();
  await page.getByRole('status').filter({ hasText: '전후 차수 전산 대조 완료' }).waitFor();
  await page.getByRole('status').filter({ hasText: '앞·현재·뒤 차수의 동일 거래처·품목 전산값을 대조 중' }).waitFor({ state: 'detached' }).catch(() => {});
  await page.getByRole('button', { name: /CARNATION carry fixture 2026\/37차 마감 잔량 수정·이력/ }).waitFor();
  const sundayOriginInput = page.getByLabel('CARNATION carry fixture 2026/38-01 2026-09-20 미적용 초안 수량');
  await sundayOriginInput.waitFor();
  const sundayCell = page.locator('.wcm-cell').filter({ has: sundayOriginInput });
  assert.match(await sundayCell.getAttribute('title'), /전산 원문 38-02: 0 박스/, JSON.stringify({ compareScopes, title: await sundayCell.getAttribute('title') }),
    'Sunday keeps its 38-01 editing origin and retains the cross-subweek 38-02 zero tombstone');
  const initialScreenshot = path.join(screenshotDirectory, '1920x1080-initial.png');
  await page.screenshot({ path: initialScreenshot });

  const initialState = await page.evaluate(() => ({
    sums: [...document.querySelectorAll('[data-wcm-label="sum"]')].map(node => node.dataset.quantity),
    quotes: [...document.querySelectorAll('.wcm-quote')].map(node => node.dataset.quantity),
    initials: [...document.querySelectorAll('.wcm-initial[data-quantity]')].map(node => node.dataset.quantity),
  }));
  const previousClose = page.getByRole('button', { name: /CARNATION carry fixture 2026\/37차 마감 잔량 수정·이력/ });
  await previousClose.click();
  const dialog = page.getByRole('dialog', { name: '웹 전용 마감 잔량 수정·이력' });
  await dialog.getByLabel('수동 마감 잔량').fill('5');
  await dialog.getByLabel('마감 잔량 변경 사유').fill('fixture 37차 마감');
  await dialog.getByRole('button', { name: '웹 마감 잔량 저장' }).click();
  await page.getByRole('status').filter({ hasText: '웹 전용 마감 잔량과 이력을 저장하고 연결 차수를 다시 계산했습니다' }).waitFor();
  assert.equal(savedRecords.length, 1);
  assert.equal(savedRecords[0].history[0].before, null);
  assert.equal(savedRecords[0].history[0].after, 5);
  assert.equal(savedRecords[0].history[0].reason, 'fixture 37차 마감');
  assert.equal(savedRecords[0].history[0].actor, 'carry-fixture');
  assert.equal(requests.filter(item => item.path === '/api/estimate/weekday-carryover' && item.method === 'GET').length >= 2, true,
    'POST is followed by a fresh GET before the UI reports completion');

  const nextClose = page.getByRole('button', { name: /CARNATION carry fixture 2026\/38차 마감 잔량 수정·이력/ });
  await nextClose.waitFor();
  assert.equal(await nextClose.getAttribute('data-quantity'), '7', '37 close is projected into 38 from its own fresh context');
  const afterSave = await page.evaluate(() => ({
    sums: [...document.querySelectorAll('[data-wcm-label="sum"]')].map(node => node.dataset.quantity),
    quotes: [...document.querySelectorAll('.wcm-quote')].map(node => node.dataset.quantity),
    initials: [...document.querySelectorAll('.wcm-initial[data-quantity]')].map(node => node.dataset.quantity),
  }));
  assert.deepEqual(afterSave, initialState, 'carry-only edits preserve totals, quote outputs, and initial baselines');

  await previousClose.click();
  const historyDialog = page.getByRole('dialog', { name: '웹 전용 마감 잔량 수정·이력' });
  await historyDialog.getByText(/→ 5 박스/).waitFor();
  await historyDialog.getByText(/carry-fixture/).waitFor();
  await historyDialog.getByText(/사유: fixture 37차 마감/).waitFor();
  await historyDialog.getByRole('button', { name: '닫기' }).click();

  for (let revision = 2; revision <= 6; revision += 1) {
    await previousClose.click();
    const editDialog = page.getByRole('dialog', { name: '웹 전용 마감 잔량 수정·이력' });
    await editDialog.getByLabel('수동 마감 잔량').fill('5');
    await editDialog.getByLabel('마감 잔량 변경 사유').fill(`fixture history revision ${revision}`);
    await editDialog.getByRole('button', { name: '웹 마감 잔량 저장' }).click();
    await editDialog.waitFor({ state: 'detached' });
  }
  assert.equal(savedRecords[0].history.length, 6, 'fixture revisions produce a realistically scrollable history without external storage');

  await page.getByLabel('중심 차수').fill('39');
  await page.getByLabel('중심 차수').press('Tab');
  await page.getByText('현재 2026 / 39차', { exact: true }).waitFor();
  await page.getByRole('button', { name: /CARNATION carry fixture 2026\/38차 마감 잔량 수정·이력/ }).waitFor();
  const afterForwardNavigation = page.getByRole('button', { name: /CARNATION carry fixture 2026\/38차 마감 잔량 수정·이력/ });
  assert.equal(await afterForwardNavigation.getAttribute('data-quantity'), '7');
  await page.getByLabel('중심 차수').fill('38');
  await page.getByLabel('중심 차수').press('Tab');
  await page.getByText('현재 2026 / 38차', { exact: true }).waitFor();
  const afterReturnNavigation = page.getByRole('button', { name: /CARNATION carry fixture 2026\/38차 마감 잔량 수정·이력/ });
  await afterReturnNavigation.waitFor();
  assert.equal(await afterReturnNavigation.getAttribute('data-quantity'), '7', 'navigating away and back retains the same historical context result');

  await page.getByLabel('요일별 출고 엑셀 파일').setInputFiles({ name: 'weekday-carryover-fixture.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: workbookBuffer });
  await page.getByRole('button', { name: '연결 선택', exact: true }).click();
  await page.getByPlaceholder('선택한 원본행에 연결할 ERP 품목 검색').fill('carry fixture');
  await page.getByRole('button', { name: '품목 검색', exact: true }).click();
  await page.getByRole('button', { name: /CARNATION carry fixture.*fixture/ }).click();
  await page.getByLabel('업로드 날짜 수량의 단위 확인').selectOption('박스');
  await page.getByRole('button', { name: '계획에 추가', exact: true }).click();
  const planTable = page.locator('.weekday-workspace section.span-12').filter({ hasText: '5. 세부차수·출고일 배분 초안' });
  const planQuantity = planTable.locator('input[type="number"]').first();
  await planQuantity.waitFor();
  const beforeDraft = Number(await nextClose.getAttribute('data-quantity'));
  const printsBeforeDraft = printRequests.length;
  await planQuantity.fill('11');
  await planQuantity.dispatchEvent('input');
  await planQuantity.dispatchEvent('change');
  await page.waitForFunction(() => {
    const cell = [...document.querySelectorAll('[data-wcm-label="remainder"]')].find(node => node.getAttribute('aria-label')?.includes('/38차'));
    return cell && Number(cell.dataset.quantity) !== 7;
  });
  const afterDraft = Number(await nextClose.getAttribute('data-quantity'));
  assert.notEqual(afterDraft, beforeDraft, 'browser draft edits flow into the expected carry projection');
  const week38Header = page.locator('th').filter({ hasText: '현재 2026 / 38차' });
  assert.equal(await week38Header.getByRole('button', { name: '전체 견적' }).isDisabled(), true,
    'unsaved draft stays separate from printed quote output');
  assert.equal(printRequests.length, printsBeforeDraft,
    'no quote request includes an uncommitted draft');

  const bounds1920 = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight }));
  assert.deepEqual([bounds1920.width, bounds1920.height], [1920, 1080]);
  assert.ok(bounds1920.documentWidth <= 1921, `1920 viewport horizontal clipping/overflow: ${bounds1920.documentWidth}`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('button', { name: /CARNATION carry fixture 2026\/37차 마감 잔량 수정·이력/ }).click();
  const smallDialog = page.getByRole('dialog', { name: '웹 전용 마감 잔량 수정·이력' });
  const smallBounds = await smallDialog.boundingBox();
  assert.ok(smallBounds && smallBounds.x >= 0 && smallBounds.y >= 0 && smallBounds.x + smallBounds.width <= 1280
    && smallBounds.y + smallBounds.height <= 800, `1280x800 dialog escaped viewport: ${JSON.stringify(smallBounds)}`);
  const dialogScreenshot = path.join(screenshotDirectory, '1280x800-carryover-dialog.png');
  await page.screenshot({ path: dialogScreenshot });
  await smallDialog.evaluate(node => { node.scrollTop = node.scrollHeight; });
  const historyRegion = smallDialog.getByLabel('마감 잔량 전체 수정 이력');
  assert.equal(await historyRegion.evaluate(node => node.scrollHeight > node.clientHeight), true, 'long history remains internally scrollable at the smaller viewport');
  assert.deepEqual(pageErrors, []);
  assert.equal(requests.every(item => item.path.startsWith('/api/')), true);
  assert.equal(requests.some(item => /apply|confirm|distribution-save/i.test(item.path)), false, 'smoke never calls ERP apply endpoints');
  console.log(JSON.stringify({ pass: true, fixtureOnly: true, writes: 'isolated intercepted carryover fixture only',
    viewport: '1920x1080 @100%', responsiveViewport: '1280x800', bounds1920, smallBounds,
    history: savedRecords[0].history, carryAt38BeforeDraft: 7, carryAt38AfterDraft: afterDraft,
    screenshots: { initial: initialScreenshot, dialog: dialogScreenshot }, initialState, afterSave, pageErrors }));
} finally {
  await context.close();
  await browser.close();
}

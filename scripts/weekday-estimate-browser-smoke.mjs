import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import XLSX from 'xlsx';
import { parseWeekdayEstimateBuffer } from '../lib/weekdayEstimateWorkbook.js';
import { buildShippingCycles, normalizeCycleRequest, shiftDate, SHIPPING_DAYS } from '../lib/weekdayEstimateCycle.js';

// Local fixture only: no production auth, DB writes, or external API requests.
const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:20767';
assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);
const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) throw new Error('PLAYWRIGHT_MODULE is required');
const { chromium } = await import(pathToFileURL(modulePath).href);
const periods = [];
for (let i = -7; i < 14; i++) {
  const day = SHIPPING_DAYS[((i % 7) + 7) % 7];
  const major = 38 + Math.floor(i / 7) + (day.suffix === '02' ? 1 : 0);
  periods.push({ BaseYmd: shiftDate('2026-09-17', i), WeekDay: day.code, OrderYearWeek: `2026${major}` });
}
const cycles = buildShippingCycles(periods, normalizeCycleRequest({ year: 2026, majorWeek: 38 }));
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
  ['요일별 계획'], ['카네이션', '색상', '', '', '', '(20일) 일요일 출고 예정', '(22일) 화요일 출고 예정'],
  ['', 'Moon Light', '', '', '', 8, 6],
]), '현장');
const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
const parsed = parseWeekdayEstimateBuffer(buffer, { fileName: 'weekday-smoke.xlsx' });
const output = path.resolve('output/weekday-smoke');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.SMOKE_BROWSER_CHANNEL || 'chrome' });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  let data = { success: true };
  if (url.pathname === '/api/auth/me') data.user = { userId: 'fixture', userName: '화면 검사', authority: 3 };
  else if (url.pathname === '/api/favorites') data.favorites = [];
  else if (url.pathname === '/api/estimate/weekday-calendar') data = { success: true, readOnly: true, cycles };
  else if (url.pathname === '/api/estimate/weekday-products') data.products = [];
  else if (url.pathname === '/api/estimate/weekday-upload-preview') data = { success: true, ...parsed };
  else if (url.pathname === '/api/customers/search') data.customers = [{ CustKey: 533, CustName: '주광농원', CustArea: '광주' }];
  else if (url.pathname === '/api/products/search') data.products = [{ ProdKey: 101, ProdName: 'CARNATION Moon Light', CounName: '콜롬비아', FlowerName: '카네이션' }];
  else if (url.pathname === '/api/estimate/weekday-compare') {
    const body = route.request().postDataJSON();
    data = { success: true, readOnly: true, history: [], sourceLots: [], rows: body.orderWeeks.map(orderWeek => ({
      year: 2026, orderWeek, custKey: 533, prodKey: 101, prodName: 'CARNATION Moon Light', outUnit: '박스',
      fixed: true, shipmentOutQuantity: orderWeek === '38-01' ? 8 : orderWeek === '38-02' ? 6 : 0,
      state: 'FIXED_REVIEW_REQUIRED', shipmentDates: orderWeek === '38-01' ? [{ date: '2026-09-20', shipmentQuantity: 8, estimateQuantity: 800 }] : orderWeek === '38-02' ? [{ date: '2026-09-22', shipmentQuantity: 6, estimateQuantity: 600 }] : [],
    })) };
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
});
try {
  await page.goto(`${base}/estimate/weekday?popup=1`, { waitUntil: 'networkidle' });
  await page.getByLabel('요일별 출고 엑셀 파일').setInputFiles({ name: 'weekday-smoke.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await page.getByLabel('업로드 날짜 수량의 단위 확인').selectOption('박스');
  await page.getByRole('button', { name: '연결 선택', exact: true }).click();
  await page.getByPlaceholder('선택한 원본행에 연결할 ERP 품목 검색').fill('Moon Light');
  await page.getByRole('button', { name: '품목 검색', exact: true }).click();
  await page.getByRole('button', { name: /CARNATION Moon Light.*콜롬비아/ }).click();
  await page.getByRole('button', { name: '계획에 추가', exact: true }).click();
  await page.getByRole('button', { name: '선택 범위 전산 대조', exact: true }).first().click();
  await page.getByRole('status').filter({ hasText: '전후 차수 전산 대조 완료' }).waitFor();
  await page.getByRole('button', { name: '초안 날짜·차수 이동', exact: true }).click();
  await page.getByLabel('이동수량', { exact: true }).fill('3');
  await page.getByLabel('이동할 전산 달력 날짜').selectOption('2026-09-24');
  await page.getByLabel('변경 사유', { exact: true }).fill('화면 검사: 다음 차수 이동');
  await page.getByRole('button', { name: '초안에만 이동 기록', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '출고일 이동 초안을 기록했습니다' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'ERP 적용 · 준비 중', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: /^\d+차 . 견적 출력$/ }).count(), 21);
  assert.equal(await page.locator('select[aria-label*="입고 원천"]').count(), 0);
  const dimensions = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight }));
  assert.equal(dimensions.width, 1920); assert.equal(dimensions.height, 1080);
  assert.ok(dimensions.documentWidth <= 1921, `page horizontal overflow: ${dimensions.documentWidth}`);
  await page.getByRole('button', { name: '접기', exact: true }).click();
  await page.locator('.weekday-workspace > header').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, '1920x1080-top.png') });
  await page.locator('.weekday-cycle-matrix').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, '1920x1080-matrix.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pass: true, viewport: '1920x1080', zoom: '100%', dimensions, errors, output, fixtureOnly: true }));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }

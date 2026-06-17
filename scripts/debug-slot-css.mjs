import { chromium } from 'playwright';
const BASE = 'https://nenovaweb.com';
const USER = process.env.SMOKE_USER || 'nenovaSS3';
const PASS = process.env.SMOKE_PASS || '0000';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const login = await page.request.post(`${BASE}/api/auth/login`, { data: { userId: USER, password: PASS } });
const { token } = await login.json();
await context.addCookies([{ name: 'token', value: token, domain: 'nenovaweb.com', path: '/' }]);
await page.goto(`${BASE}/catalog`, { waitUntil: 'networkidle' });
await page.locator('select.filter-select').nth(1).selectOption({ index: 1 });
await page.getByRole('button', { name: /도착원가 불러오기/ }).click();
await page.waitForSelector('.catalog-prod-card', { timeout: 90000 });
await page.locator('.catalog-prod-card:not(.no-image)').first().evaluate(el => el.click());
await page.waitForTimeout(500);
const pk = await page.locator('.catalog-prod-card').first().getAttribute('data-prod-key');
await page.evaluate((prodKey) => {
  const dt = new DataTransfer();
  dt.setData('application/x-nenova-catalog-prod', String(prodKey));
  dt.setData('text/plain', `prod:${prodKey}`);
  const banner = document.querySelector('.composer-drop-banner');
  for (const type of ['dragover', 'drop']) banner.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
}, pk);
await page.waitForTimeout(1000);
const info = await page.locator('.composer-slot.filled').first().evaluate((el) => {
  const img = el.querySelector('.composer-slot-img');
  const st = getComputedStyle(el);
  const ist = img ? getComputedStyle(img) : null;
  const sr = el.getBoundingClientRect();
  const ir = img?.getBoundingClientRect();
  return {
    className: el.className,
    display: st.display,
    gridTemplateRows: st.gridTemplateRows,
    slotH: sr.height,
    imgH: ir?.height,
    pct: ir && sr.height ? (ir.height / sr.height) * 100 : null,
    imgFlex: ist ? `${ist.flexGrow} ${ist.flexShrink} ${ist.flexBasis}` : null,
    imgHeight: ist?.height,
    imgMaxHeight: ist?.maxHeight,
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();

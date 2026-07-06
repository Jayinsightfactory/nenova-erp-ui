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

const chip = await page.locator('.catalog-cost-chip').first().evaluate(el => ({
  text: el.textContent?.trim(),
  whiteSpace: getComputedStyle(el).whiteSpace,
}));
const cards = await page.locator('.catalog-prod-card:not(.no-image)').all();
const keys = [];
for (let i = 0; i < Math.min(9, cards.length); i++) {
  await cards[i].click();
  keys.push(await cards[i].getAttribute('data-prod-key'));
}
await page.locator('.composer-slide-toggle').first().click().catch(() => {});
await cards[0].evaluate((el) => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
const pk = keys[0];
await page.evaluate((prodKey, prodKeys) => {
  const dt = new DataTransfer();
  dt.setData('application/x-nenova-catalog-prod-keys', JSON.stringify(prodKeys.map(Number)));
  dt.setData('application/x-nenova-catalog-prod', String(prodKey));
  dt.setData('text/plain', `prod:${prodKey}`);
  const banner = document.querySelector('.composer-drop-banner');
  for (const type of ['dragover', 'drop']) banner.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
}, pk, keys);

await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const slides = [...document.querySelectorAll('.composer-slide-card')];
  const filled = document.querySelectorAll('.composer-slot.filled').length;
  const stage = document.querySelector('.composer-slide-stage');
  const st = stage ? getComputedStyle(stage) : null;
  return {
    slideCount: slides.length,
    filledSlots: filled,
    stageMaxWidth: st?.maxWidth,
    stageMaxHeight: st?.maxHeight,
  };
});
console.log(JSON.stringify({ chip, keys: keys.length, ...info }, null, 2));
await browser.close();

// 빠른조회서비스 비밀번호 칸을 클릭했을 때 나타나는 transkey 가상키패드 DOM 구조 덤프(값 입력 없음, 조회 없음)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = path.join(__dirname, '_profile_quick'); const OUT = path.join(__dirname, '_probe');
const { chromium } = await import('playwright');
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, channel: 'chrome', viewport: { width: 1400, height: 900 }, ignoreDefaultArgs: ['--enable-automation', '--disable-extensions'], args: ['--no-first-run', '--no-default-browser-check'] });
try {
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('https://www.kebhana.com/flex/quick/quickService.do?subMenu=1', { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  const snap = async () => page.evaluate(() => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }; return [...document.querySelectorAll('*')].filter(vis).map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName, id: e.id || '', cls: String(e.className || '').slice(0, 60), src: e.getAttribute('src') ? e.getAttribute('src').replace(/^.*\//, '').slice(0, 60) : '', alt: e.getAttribute('alt') || '', title: e.getAttribute('title') || '', aria: e.getAttribute('aria-label') || '', data: JSON.stringify(Object.assign({}, e.dataset)).slice(0, 80), txt: (e.childElementCount === 0 ? (e.textContent || '').trim().slice(0, 12) : ''), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bg: (getComputedStyle(e).backgroundImage || '').replace(/^.*\//, '').slice(0, 50) }; }); });
  const before = await snap(); const key = (o) => `${o.tag}|${o.id}|${o.cls}|${o.src}|${o.x},${o.y}`; const bset = new Set(before.map(key));
  await page.locator('#acctPw').click({ timeout: 8000 });
  await page.waitForTimeout(1500);
  const after = await snap(); const appeared = after.filter((o) => !bset.has(key(o)));
  const kp = after.filter((o) => /transkey|keypad|tk_/i.test(`${o.id} ${o.cls} ${o.src} ${o.bg}`));
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'keypad.json'), JSON.stringify({ appeared, kp, frames: page.frames().map((f) => f.url().slice(0, 100)) }, null, 1));
  await page.screenshot({ path: path.join(OUT, 'keypad.png') });
  console.log(JSON.stringify({ appeared: appeared.length, kp: kp.length, frames: page.frames().length }));
} finally { await ctx.close().catch(() => {}); }

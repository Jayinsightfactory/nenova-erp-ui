const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
// CSS semantics fixture only; Next compilation and actual page navigation are separate gates.
const unScope = css => css.replace(/:global\(([^)]+)\)/g, '$1');
const manuals = read('pages/work/manuals.js');
assert.ok(manuals.includes(') : <h1 data-desktop-chrome>업무 매뉴얼</h1>}'));
assert.ok(manuals.includes('<nav className="crumb">'));
const cases = [
  { name: 'manuals', css: unScope(manuals.split('const css = `')[1].split('`;')[0]), cls: 'wm', webPadding: '28px 24px 64px' },
  { name: 'knowledge', css: unScope(read('styles/OperationsKnowledge.module.css')), cls: 'page', webPadding: '24px 28px 36px' },
];
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    for (const width of [1920, 800]) for (const item of cases) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 1080, deviceScaleFactor: 1 });
      await page.setContent(`<style>${item.css}</style><main class="${item.cls}"><nav class="crumb"><button>업무 매뉴얼</button><b>영업부</b></nav><button class="primary">새 지침</button></main>`);
      const metrics = () => page.evaluate(() => ({ padding: getComputedStyle(document.querySelector('main')).padding, button: getComputedStyle(document.querySelector('.primary')).padding, crumb: getComputedStyle(document.querySelector('.crumb')).display }));
      const web = await metrics();
      assert.equal(web.padding, item.name === 'knowledge' && width === 800 ? '16px' : item.webPadding);
      await page.emulateMediaType('print');
      const print = await metrics();
      await page.evaluate(() => document.documentElement.dataset.nenovaDesktop = 'true');
      assert.deepEqual(await metrics(), print);
      await page.emulateMediaType('screen');
      assert.deepEqual(await metrics(), { ...web, padding: '8px 12px 24px' });
      console.log(`${item.name} ${width}x1080: PC padding, preserved breadcrumb/button and web/print passed`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

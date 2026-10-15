const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('next/dist/compiled/babel/core');
const puppeteer = require('puppeteer-core');
const filename = path.join(__dirname, '../components/StockAdjustmentMatrixPanel.js');
const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename,
  presets: [require('next/dist/compiled/babel/preset-react')],
  plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')], configFile: false, babelrc: false }).code;
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setRequestInterception(true); page.on('request', request => request.abort());
    await page.setContent('<!doctype html><html lang="ko"><body style="margin:0;font:14px Arial"><main id="root" style="padding:20px;min-width:0"></main></body></html>');
    for (const [pkg, file] of [['react', 'react.development.js'], ['react-dom', 'react-dom.development.js']]) await page.addScriptTag({ content: fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'umd', file), 'utf8') });
    await page.evaluate(code => {
      const module = { exports: {} };
      new Function('require', 'module', 'exports', code)(() => window.React, module, module.exports);
      window.calls = []; window.downloads = [];
      window.fetch = (url, options) => new Promise(resolve => window.calls.push({ url, options, resolve }));
      window.HTMLAnchorElement.prototype.click = function () { window.downloads.push(this.download); };
      window.fixture = year => ({ ok: true, orderYear: String(year), eventCount: 360, invalidCount: 1,
        weeks: Array.from({ length: 54 }, (_, i) => ({ key: `${41 + Math.floor(i / 2)}-${i % 2 + 1}`, label: `${41 + Math.floor(i / 2)}-${i % 2 + 1}` })),
        rows: Array.from({ length: 24 }, (_, i) => ({ key: `${i}:stem`, prodKey: 100 + i, productName: `합성검증 긴 품명 ${i} 하이드란지아 수입 생화 상품 설명 전체 표시`, country: '콜롬비아', flower: '수국', unit: i % 2 ? '단' : '송이', net: i % 2 ? -0.125 : 0, invalidCount: i === 0 ? 1 : 0, cells: { '41-1': { quantity: 0, eventCount: 2, invalidCount: 0 }, '41-2': { quantity: i === 0 ? null : -0.125, eventCount: 1, invalidCount: i === 0 ? 1 : 0 }, '49-2': { quantity: 3.75, eventCount: 1, invalidCount: 0 } } })) });
      window.answer = (index, year = 2026, failure = '') => window.calls[index].resolve({ ok: !failure, json: async () => failure ? { ok: false, message: failure } : window.fixture(year) });
      window.fixtureRoot = window.ReactDOM.createRoot(document.getElementById('root'));
      window.renderYear = year => window.fixtureRoot.render(window.React.createElement(module.exports.default, { year }));
      window.renderYear(2026);
    }, code);
    await page.waitForFunction(() => window.calls.length === 1);
    assert.equal(await page.$eval('button[type="button"]', element => element.disabled), true);
    await page.evaluate(() => window.answer(0)); await page.waitForSelector('table');
    for (const [width, height, name] of [[1920, 1080, '1920'], [800, 700, 'small']]) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      const layout = await page.evaluate(() => {
        const region = document.querySelector('.matrix-scroll'), name = document.querySelector('.product-name');
        region.scrollLeft = region.scrollWidth;
        return { overflow: document.documentElement.scrollWidth > innerWidth, horizontal: region.scrollWidth > region.clientWidth, lastVisible: document.querySelector('thead th:last-child').getBoundingClientRect().right <= region.getBoundingClientRect().right + 1, nameHeight: name.getBoundingClientRect().height, vertical: getComputedStyle(region).maxHeight, zoom: devicePixelRatio };
      });
      assert.equal(layout.overflow, false); assert.equal(layout.horizontal, true); assert.equal(layout.lastVisible, true); assert.ok(layout.nameHeight > 30); assert.equal(layout.vertical, 'none'); assert.equal(layout.zoom, 1);
      await page.evaluate(() => document.querySelector('.matrix-scroll').scrollLeft = 0);
      await page.screenshot({ path: path.join(__dirname, `../outputs/stock-matrix-ui-${name}.png`) });
    }
    await page.focus('select'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.calls.length === 2); await page.evaluate(() => window.answer(1)); await page.waitForSelector('table');
    await page.focus('input'); await page.keyboard.type('장미');
    assert.equal(await page.$eval('button[type="button"]', element => element.disabled), true);
    await page.keyboard.press('Enter'); await page.waitForFunction(() => window.calls.length === 3);
    assert.match(await page.evaluate(() => window.calls[2].url), /search=/);
    await page.evaluate(() => window.answer(2, 2026, '합성 조회 실패')); await page.waitForSelector('[role="alert"]');
    assert.match(await page.$eval('[role="alert"]', element => element.textContent), /합성 조회 실패/);
    assert.equal(await page.$eval('button[type="button"]', element => element.disabled), true);
    await page.click('button[type="submit"]'); await page.waitForFunction(() => window.calls.length === 4);
    await page.evaluate(() => window.answer(3)); await page.waitForSelector('table');
    await page.click('button[type="button"]'); await page.waitForFunction(() => window.calls.length === 5);
    assert.equal(await page.$eval('button[type="button"]', element => element.disabled), true);
    await page.evaluate(() => { window.renderYear(2025); }); await page.waitForFunction(() => window.calls.length === 6);
    await page.evaluate(() => window.calls[4].resolve({ ok: true, headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, blob: async () => new Blob(['fixture']) }));
    assert.equal(await page.evaluate(() => window.downloads.length), 0);
    assert.equal(await page.$('table'), null);
    await page.evaluate(() => { window.renderYear(2024); }); await page.waitForFunction(() => window.calls.length === 7);
    await page.evaluate(() => window.answer(5, 2025));
    assert.equal(await page.$('table'), null);
    await page.evaluate(() => window.answer(6, 2024)); await page.waitForSelector('table');
    assert.match(await page.$eval('h3', element => element.textContent), /2024/);
    await page.focus('input'); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BUTTON');
    assert.match(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), /solid/);
    assert.deepEqual(errors, []);
    console.log('PASS synthetic matrix Chrome smoke: 1920x1080 and 800x700 at 100%, page/column scroll, long names, keyboard Enter/arrows/Tab, errors, loading/export disabled, stale year fetch and export. No network or ERP writes.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

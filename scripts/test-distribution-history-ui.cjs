const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const swc = require('next/dist/build/swc');

(async () => {
  await swc.loadBindings();
  const source = fs.readFileSync('components/orders/PasteOperationHistory.js', 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export default function', 'function');
  const compiled = await swc.transform(`const {useEffect,useRef,useState}=React;
    const normalizeOrderHistorySearch=x=>x;
    const apiGet=async()=>window.fixture;
    ${source}
    window.renderHistory=compact=>ReactDOM.render(React.createElement(PasteOperationHistory,{compact,initial:{year:'2026',week:'2026-41-02'}}),document.getElementById('app'));`,
  { filename: 'history.jsx', jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' } });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setContent('<style>*{box-sizing:border-box}body{margin:12px;font-family:Arial}</style><div id="app"></div>');
    await page.addScriptTag({ path: require.resolve('react').replace(/index\.js$/, 'umd/react.development.js') });
    await page.addScriptTag({ path: require.resolve('react-dom').replace(/index\.js$/, 'umd/react-dom.development.js') });
    await page.evaluate(() => { window.fixture = { success: true, operations: [{ key: 100, source: 'shipment-distribute', year: '2026', week: '2026-41-02', actor: '담당자', at: '2026-10-14', status: 'committed', committedCount: 1, verified: true, entries: [{ type: 'DISTRIBUTE', custName: '왕자원예', prodName: 'ALSTROMERIA Mila', unit: '단', outQtyBefore: 16, outQtyAfter: 0 }] }] }; });
    await page.addScriptTag({ content: compiled.code });
    for (const compact of [true, false]) {
      await page.evaluate(value => window.renderHistory(value), compact);
      await page.getByText(/16 → 0 단/).waitFor();
      assert.match(await page.locator('article').textContent(), /출고분배 수정/);
      assert.doesNotMatch(await page.locator('article').textContent(), /0 단 추가|0 단 취소/);
      for (const width of [1920, 1366, 390]) {
        await page.setViewportSize({ width, height: 1080 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `history overflow ${width}`);
      }
    }
    await page.evaluate(() => { window.fixture = { success: false, error: 'refresh fixture failure' }; window.dispatchEvent(new Event('focus')); });
    await page.getByRole('alert').filter({ hasText: 'refresh fixture failure' }).waitFor();
    assert.match(await page.locator('article').textContent(), /16 → 0 단/, 'failed refresh preserves already loaded history');
    assert.deepEqual(errors, []);
    console.log('Distribution history actual component: absolute 16→0, both modes, 1920/1366/390 widths passed; ERP writes 0');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

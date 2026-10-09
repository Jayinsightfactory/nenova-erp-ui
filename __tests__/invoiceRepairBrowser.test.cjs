const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('next/dist/compiled/babel/core');

test('metadata review fits 1920x1080, exposes editable issues and keyboard controls without network',
  { skip: process.env.RUN_INVOICE_REPAIR_BROWSER !== '1' }, async () => {
    const puppeteer = require('puppeteer-core');
    const { makePackingReviewRows } = await import('../lib/importPackingReview.js');
    const { normalizePackingMetadata } = await import('../lib/importPackingMetadata.js');
    const invoice = normalizePackingMetadata({ invoice: 'SYNTHETIC-274399', supplier: 'Fixture',
      raw_date: '17/04/26', date_order: 'DMY', date_kind: 'invoice', date: '2017/04/26',
      currency: null, invoice_total: 46.34, freight_total: 36.34,
      products: [{ description: 'Synthetic flower', t_price: 10 }],
    }, 'CO');
    const rows = makePackingReviewRows([invoice], 'CO');
    const filename = path.join(__dirname, '../components/import-tools/PackingEvidenceReview.js');
    const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
      filename, presets: [require('next/dist/compiled/babel/preset-react')],
      plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
      configFile: false, babelrc: false,
    }).code;
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setRequestInterception(true);
      page.on('request', request => request.abort());
      await page.setContent('<!doctype html><html lang="ko"><body style="margin:0;font:14px Arial"><main id="root"></main></body></html>');
      await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../styles/PackingEvidenceReview.module.css'), 'utf8') });
      for (const [pkg, file] of [['react', 'react.development.js'], ['react-dom', 'react-dom.development.js']]) {
        await page.addScriptTag({ content: fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'umd', file), 'utf8') });
      }
      await page.evaluate(({ code, rows }) => {
        const module = { exports: {} };
        const require = name => {
          if (name === 'react') return window.React;
          if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
          if (name.endsWith('importPackingPdfPreview.js')) return { isValidNormalizedBBox: () => false };
          throw new Error(`Unexpected dependency: ${name}`);
        };
        new Function('require', 'module', 'exports', code)(require, module, module.exports);
        window.fixtureRoot = window.ReactDOM.createRoot(document.getElementById('root'));
        window.fixtureRoot.render(window.React.createElement(module.exports.default,
          { rows, fileName: 'synthetic.pdf', onConfirm: value => { window.reviewSubmission = value; }, onClose: () => {} }));
      }, { code, rows });
      await page.waitForSelector('[role="dialog"]');
      const layout = await page.evaluate(() => {
        const r = document.querySelector('[role="dialog"]').getBoundingClientRect();
        const form = document.querySelector('[aria-label="인식값 검토"]');
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom,
          overflow: document.documentElement.scrollWidth > innerWidth,
          text: form.textContent, inputs: form.querySelectorAll('input').length };
      });
      assert.ok(layout.x >= 0 && layout.y >= 0 && layout.right <= 1920 && layout.bottom <= 1080);
      assert.equal(layout.overflow, false);
      assert.match(layout.text, /날짜/);
      assert.match(layout.text, /통화/);
      assert.ok(layout.inputs >= 7, 'metadata issues need real input controls');
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => document.activeElement !== document.body));
      await page.screenshot({ path: path.join(__dirname, '../outputs/invoice-repair-metadata-1920.png') });
      const legacyFile = path.join(__dirname, '../components/import-tools/ChinaLegacyReview.js');
      const legacyCode = babel.transformSync(fs.readFileSync(legacyFile, 'utf8'), {
        filename: legacyFile, presets: [require('next/dist/compiled/babel/preset-react')],
        plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')], configFile: false, babelrc: false,
      }).code;
      await page.evaluate(code => {
        const module = { exports: {} };
        new Function('require', 'module', 'exports', code)(() => window.React, module, module.exports);
        window.fixtureRoot.render(window.React.createElement(module.exports.default, {
          data: { invoices: [{ source_sheet: 'Invoice', arithmetic_verified: true, products: [{
            source_sheet: 'Invoice', source_row: 6, description: 'Synthetic flower', raw_qty: 20,
            source_unit_spec: '500g', unitPrice: 2, t_price: 40,
          }] }] },
          resolveLegacyChinaInvoice: (source, resolution) => { window.legacyResolution = resolution; return source; },
          onConfirm: value => { window.legacySubmission = value; },
        }));
      }, legacyCode);
      await page.waitForSelector('[aria-label="6행 박스 PCS"]');
      await page.type('[aria-label="6행 박스 PCS"]', '2');
      await page.type('[aria-label="6행 전체 송이"]', '100');
      await page.type('[aria-label="6행 확인 근거"]', 'Synthetic source check');
      await page.type('[aria-label="통화 코드"]', 'CNY');
      await page.type('[aria-label="통화 원문 근거"]', 'Synthetic currency check');
      for (const checkbox of await page.$$('input[type="checkbox"]')) await checkbox.click();
      await page.click('button');
      const resolution = await page.evaluate(() => window.legacyResolution);
      assert.equal(resolution.rows[0].raw_unit, '단');
      assert.equal(resolution.rows[0].pcs, 2);
      assert.equal(resolution.rows[0].total_stems, 100);
      assert.equal(resolution.rows[0].source_unit_spec, '500g');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(__dirname, '../outputs/invoice-repair-legacy-1920.png') });
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });

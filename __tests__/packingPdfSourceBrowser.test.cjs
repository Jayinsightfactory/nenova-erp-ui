const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('next/dist/compiled/babel/core');

test('source PDF review UI gates every row and invoice confirmation at 1920x1080 (mock preview only)',
  { skip: process.env.RUN_PACKING_PDF_SOURCE_BROWSER !== '1' }, async () => {
    const puppeteer = require('puppeteer-core');
    const componentPath = path.join(__dirname, '../components/import-tools/PackingEvidenceReview.js');
    const code = babel.transformSync(fs.readFileSync(componentPath, 'utf8'), {
      filename: componentPath, presets: [require('next/dist/compiled/babel/preset-react')],
      plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')], configFile: false, babelrc: false,
    }).code;
    const rows = [{ invoiceIndex: 0, label: 'Fixture invoice', currency: 'USD',
      original: { gw: '1', cw: '1', freight: '0' }, values: { gw: '1', cw: '1', freight: '0' }, evidence: {},
      sourceReview: { required: true, pdf: { rendered: false, page: null }, rows: [
        { lineIndex: 4, description: 'Exact Rose', values: { raw_qty: '2', u_price: '4', t_price: '8' },
          originalValues: { raw_qty: '2', u_price: '4', t_price: '8' }, evidence: { raw_qty: { page: 2, quote: '2 bunches' }, u_price: { page: 2, quote: '4' }, t_price: { page: 2, quote: '8' } }, confirmed: false },
        { lineIndex: 5, description: 'Unmatched Tulip', values: { raw_qty: '3', u_price: '5', t_price: '15' },
          originalValues: { raw_qty: '3', u_price: '5', t_price: '15' }, evidence: { raw_qty: { page: 2, quote: '3 bunches' } }, confirmed: false },
      ] } }];
    const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await page.setRequestInterception(true);
      page.on('request', request => request.abort());
      await page.setContent('<!doctype html><html lang="ko"><body style="margin:0;font:14px Arial"><main id="root"></main></body></html>');
      await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../styles/PackingEvidenceReview.module.css'), 'utf8') });
      for (const [pkg, file] of [['react', 'react.development.js'], ['react-dom', 'react-dom.development.js']]) {
        await page.addScriptTag({ content: fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'umd', file), 'utf8') });
      }
      await page.evaluate(({ code: componentCode, rows: fixtureRows }) => {
        const module = { exports: {} };
        const require = name => {
          if (name === 'react') return window.React;
          if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
          if (name.endsWith('importPackingPdfPreview.js')) return {
            isValidNormalizedBBox: () => false,
            // Deliberately mocked worker: this verifies UI gating, not production PDF rendering.
            loadPdfPreview: async () => {
              if (!window.allowPreview) throw new Error('fixture preview failure');
              return { numPages: 2,
                renderPage: async (number, canvas, zoom) => {
                  canvas.width = 595; canvas.height = 841;
                  canvas.style.width = `${595 * zoom}px`; canvas.style.height = `${841 * zoom}px`;
                  canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
                  return { width: 595, height: 841 };
                },
                locateEvidence: async page => ({ source: 'text', bbox: [0.1, 0.2, 0.2, 0.05], label: `원문 일치 근거 · ${page}페이지` }),
                destroy() {} };
            },
          };
          throw new Error(`Unexpected dependency ${name}`);
        };
        new Function('require', 'module', 'exports', componentCode)(require, module, module.exports);
        window.fixtureRoot = window.ReactDOM.createRoot(document.getElementById('root'));
        window.invalidateCalls = 0;
        window.fixtureRoot.render(window.React.createElement(module.exports.default, {
          rows: fixtureRows, pdfBase64: 'fixture', fileName: 'source.pdf',
          matchedInvoices: [{ sourceInvoiceIdentity: { sourceInvoiceIndex: 0 }, products: [
            { sourceName: 'Exact Rose', matchingDescription: 'Exact Rose', matchedName: 'ERP Rose' },
            { sourceName: 'Different Tulip', matchedName: 'Wrong guessed match' },
          ] }],
          onInvalidate: () => { window.invalidateCalls += 1; },
          onConfirm: value => { window.submission = value; }, onClose() {},
        }));
      }, { code, rows });
      await page.waitForSelector('[role="dialog"]');
      await page.waitForFunction(() => document.querySelector('[aria-label="PDF 다시 불러오기"]'));
      assert.equal(await page.$eval('[data-testid="source-row-confirm"]', el => el.disabled), true);
      assert.equal(await page.$eval('button.applyButton, .applyButton', el => el.disabled), true);
      assert.match(await page.$eval('[data-testid="source-review"]', el => el.textContent), /미매칭 · 결과에서 선택 필요/);
      assert.match(await page.$eval('[data-testid="source-review"]', el => el.textContent), /ERP Rose/);

      await page.evaluate(() => { window.allowPreview = true; });
      await page.click('[aria-label="PDF 다시 불러오기"]');
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.dataset.pdfReady === 'true');
      assert.deepEqual(await page.$eval('canvas', canvas => [canvas.width, canvas.height]), [595, 841]);
      assert.equal(await page.$$eval('[data-testid="source-row-confirm"]', nodes => nodes.length), 2);
      const dialogRect = await page.$eval('[role="dialog"]', node => { const r = node.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
      assert.ok(dialogRect[0] >= 0 && dialogRect[1] >= 0 && dialogRect[2] <= 1920 && dialogRect[3] <= 1080);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

      await page.click('button.sourceEvidenceButton');
      await page.waitForFunction(() => document.querySelector('[aria-label="PDF 페이지 번호"]').value === '2');
      await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.dataset.pdfReady === 'true');
      const checkSourceRow = async index => {
        await page.evaluate(i => {
          const checkbox = document.querySelectorAll('[data-testid="source-row-confirm"]')[i];
          if (checkbox && !checkbox.checked) checkbox.click();
        }, index);
        await page.waitForFunction(i => document.querySelectorAll('[data-testid="source-row-confirm"]')[i]?.checked === true, { timeout: 3000 }, index);
      };
      await checkSourceRow(0);
      assert.equal(await page.$eval('.applyButton', el => el.disabled), true);
      assert.match(await page.$eval('.footer', el => el.textContent), /미확인 상품행 1건/);
      await checkSourceRow(1);
      const invoiceCheck = await page.$('[data-testid="evidence-confirm"]');
      assert.equal(await page.evaluate(el => el.disabled, invoiceCheck), false);
      await invoiceCheck.click();

      const firstInput = await page.$('input[aria-label="원문 Exact Rose 원문 수량"]');
      await firstInput.click({ clickCount: 3 });
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await firstInput.type('2.5');
      assert.equal(await page.$eval('[data-testid="source-row-confirm"]', el => el.checked), false, 'editing a source value resets that row confirmation');
      assert.equal(await invoiceCheck.evaluate(el => el.checked), false, 'editing a source value resets invoice confirmation');
      await page.type('input[aria-label="원문 Exact Rose 수정 사유"]', 'Printed quantity rechecked');
      await checkSourceRow(0);
      await checkSourceRow(1);
      await page.waitForFunction(() => document.querySelector('[data-testid="evidence-confirm"]')?.disabled === false);
      await page.click('[data-testid="evidence-confirm"]');
      await page.waitForFunction(() => document.querySelector('.applyButton')?.disabled === false && document.querySelector('[role="dialog"]')?.dataset.pdfReady === 'true');
      await page.click('.applyButton');
      await page.waitForFunction(() => Boolean(window.submission));
      const result = await page.evaluate(() => ({ invoice: window.submission[0], invalidations: window.invalidateCalls }));
      assert.equal(result.invoice.sourceReview.pdf.rendered, true);
      assert.equal(result.invoice.sourceReview.pdf.page, 2);
      assert.equal(result.invoice.sourceReview.rows[0].values.raw_qty, '2.5');
      assert.equal(result.invoice.sourceReview.rows[0].reason, 'Printed quantity rechecked');
      assert.equal(result.invoice.sourceReview.rows.every(row => row.confirmed), true);
      assert.ok(result.invalidations >= 1);
      assert.deepEqual(pageErrors, []);
    } finally { await browser.close(); }
  });

// Isolated InvoiceReceiptWorkbench browser smoke.
// Compiles the real source with the repository's Babel, serves only localhost assets,
// and intercepts every /api request. No ERP/API/DB request can leave this harness.
// Usage: node scripts/invoice-receipt-ui-smoke.cjs

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const babel = require('next/dist/compiled/babel/core');
const puppeteer = require(process.env.PUPPETEER_CORE_PATH || 'puppeteer-core');

const root = path.resolve(__dirname, '..');
const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
const COMMITTED_ID = '22222222-2222-4222-8222-222222222222';
const LINE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PART_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OPERATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HASH = 'a'.repeat(64);
let smokeStage = 'bundle';

function logStage(stage) {
  smokeStage = stage;
  console.log(`[invoice-receipt-ui-smoke] ${stage}`);
}

const files = {
  workbench: 'components/import-tools/InvoiceReceiptWorkbench.js',
  costReview: 'components/import-tools/InvoiceReceiptCostReview.js',
  adapter: 'lib/importPackingReceiptAdapter.js',
  costLib: 'lib/invoiceReceiptCost.js',
  receiptCss: 'styles/InvoiceReceipt.module.css',
  costCss: 'styles/InvoiceReceiptCost.module.css',
};

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function compile(relative) {
  return babel.transformSync(read(relative), {
    filename: path.join(root, relative),
    presets: [[require('next/dist/compiled/babel/preset-react'), { runtime: 'classic' }]],
    plugins: [require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],
    configFile: false,
    babelrc: false,
    sourceMaps: false,
  }).code;
}

function namespaceCss(source, prefix) {
  return source.replace(/\.([A-Za-z_][\w-]*)/g, (_, name) => `.${prefix}-${name}`);
}

function documentFixture({ committed = false } = {}) {
  const documentId = committed ? COMMITTED_ID : DRAFT_ID;
  const revision = committed ? 4 : 2;
  const operation = {
    operationId: OPERATION_ID,
    documentId,
    documentRevision: revision,
    receiptPartId: PART_ID,
    status: 'COMMITTED',
    warehouseKey: 78001,
    createdAt: '2026-10-08T01:00:00.000Z',
    completedAt: '2026-10-08T01:00:02.000Z',
    result: { lineMappings: [{ lineId: LINE_ID, wdetailKey: 88001, outQuantity: 20, unit: '단' }] },
  };
  return {
    documentId,
    revision,
    rowVersion: committed ? 'AAAAAAAABAE=' : 'AAAAAAAAAAI=',
    sourceHash: HASH,
    originalFileName: '2026_41-01_CN.xlsx',
    orderYear: '2026',
    orderWeek: '41-01',
    farmKey: 501,
    invoiceNo: committed ? 'SMOKE-COMMITTED' : 'SMOKE-DRAFT',
    invoiceYear: '2026',
    receiptStatus: committed ? 'COMMITTED' : 'DRAFT',
    costStatus: 'PENDING',
    warehouseKey: committed ? 78001 : null,
    rawMetadata: { fixture: true },
    reviewedMetadata: {
      country: 'CN', farmName: 'SMOKE FARM', inputDate: '2026-10-08', invoiceDate: '2026-10-07',
      transportMode: 'SEA', awb: 'SMOKE-AWB', gw: 100, cw: 110, freightCurrency: 'CNY',
      costInputs: { freight: { currency: 'CNY', amount: 1000, source: 'review' } }, receiptNotes: 'fixture only',
    },
    lines: [{
      lineId: LINE_ID, lineNo: 1, originalName: 'SMOKE ROSE', lengthText: '60cm', prodKey: 77,
      boxQuantity: 2, bunchQuantity: 20, stemQuantity: 200, priceUnit: '단', unitPrice: 3.5,
      currency: 'CNY', lineAmount: 70, sourceEvidence: { row: 12 }, reviewed: { confirmed: true },
    }],
    history: [{ historyId: `${documentId}-history`, revision, action: committed ? 'COMMIT' : 'SAVE', createdAt: '2026-10-08T01:00:00.000Z' }],
    operations: committed ? [operation] : [],
  };
}

const draft = documentFixture();
const committed = documentFixture({ committed: true });
const products = [{ ProdKey: 77, ProdName: 'SMOKE ROSE ERP', country: 'CN', selectable: true }];

const dependencies = {
  workbench: {
    react: 'react',
    './InvoiceReceiptCostReview.js': 'costReview',
    '../../styles/InvoiceReceipt.module.css': 'receiptStyles',
    '../../lib/importPackingReceiptAdapter.js': 'adapter',
  },
  costReview: {
    react: 'react',
    '../../lib/invoiceReceiptCost': 'costLib',
    '../../styles/InvoiceReceiptCost.module.css': 'costStyles',
  },
};

function browserBundle() {
  return `(() => {
    const factories = {
      workbench(module, exports, require) { ${compile(files.workbench)} },
      costReview(module, exports, require) { ${compile(files.costReview)} },
      adapter(module, exports, require) { ${compile(files.adapter)} },
      costLib(module, exports, require) { ${compile(files.costLib)} },
    };
    const dependencyMap = ${JSON.stringify(dependencies)};
    const cache = Object.create(null);
    const style = prefix => new Proxy({}, { get: (_, key) => typeof key === 'string' ? prefix + '-' + key : undefined });
    function execute(id) {
      if (cache[id]) return cache[id].exports;
      if (id === 'react') return { __esModule: true, default: React, ...React };
      if (id === 'receiptStyles') return { __esModule: true, default: style('receipt') };
      if (id === 'costStyles') return { __esModule: true, default: style('cost') };
      const module = { exports: {} };
      cache[id] = module;
      if (!factories[id]) throw new Error('Unknown fixture module: ' + id);
      factories[id](module, module.exports, request => {
        const target = dependencyMap[id]?.[request] || request;
        return execute(target);
      });
      return module.exports;
    }
    const Workbench = execute('workbench').default;
    const props = { excels: [], invoices: [], country: '', file: null, products: ${JSON.stringify(products)}, reviewConfirmed: false, truncated: false };
    ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(Workbench, props));
    window.__invoiceReceiptSmokeMounted = true;
  })();`;
}

const css = `
  * { box-sizing: border-box; }
  html, body { margin: 0; min-width: 0; background: #eef2f7; font-family: Arial, sans-serif; }
  body { padding: 12px; }
  #app { width: 100%; min-width: 0; }
  ${namespaceCss(read(files.receiptCss), 'receipt')}
  ${namespaceCss(read(files.costCss), 'cost')}
`;

const reactPath = path.join(root, 'node_modules/react/umd/react.development.js');
const reactDomPath = path.join(root, 'node_modules/react-dom/umd/react-dom.development.js');
const bundle = browserBundle(); // Babel compilation is a mandatory preflight for this runner.
let serverApiHits = 0;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (pathname.startsWith('/api/')) {
    serverApiHits += 1;
    response.writeHead(500, { 'Content-Type': 'application/json' });
    return response.end(JSON.stringify({ success: false, error: 'API escaped Puppeteer interception' }));
  }
  if (pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/fixture.css"></head><body><main id="app"></main><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/bundle.js"></script></body></html>');
  }
  if (pathname === '/react.js') return sendFile(response, reactPath, 'text/javascript; charset=utf-8');
  if (pathname === '/react-dom.js') return sendFile(response, reactDomPath, 'text/javascript; charset=utf-8');
  if (pathname === '/bundle.js') return sendText(response, bundle, 'text/javascript; charset=utf-8');
  if (pathname === '/fixture.css') return sendText(response, css, 'text/css; charset=utf-8');
  if (pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
  response.writeHead(404); return response.end('not found');
});

function sendText(response, value, contentType) {
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  response.end(value);
}

function sendFile(response, filename, contentType) {
  response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  fs.createReadStream(filename).pipe(response);
}

function json(request, body, status = 200) {
  return request.respond({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
}

function listen() {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer() {
  return new Promise(resolve => server.close(resolve));
}

async function clickButton(page, text, { contains = false } = {}) {
  await page.waitForFunction(({ label, partial }) => [...document.querySelectorAll('button')].some(button => {
    const value = (button.textContent || '').replace(/\s+/g, ' ').trim();
    return !button.disabled && (partial ? value.includes(label) : value === label);
  }), { timeout: 15000 }, { label: text, partial: contains });
  await page.evaluate(({ label, partial }) => {
    const button = [...document.querySelectorAll('button')].find(item => {
      const value = (item.textContent || '').replace(/\s+/g, ' ').trim();
      return !item.disabled && (partial ? value.includes(label) : value === label);
    });
    button.click();
  }, { label: text, partial: contains });
}

async function clickButtonWithin(page, selector, text, { contains = false } = {}) {
  await page.waitForFunction(({ rootSelector, label, partial }) => {
    const root = document.querySelector(rootSelector);
    return [...(root?.querySelectorAll('button') || [])].some(button => {
      const value = (button.textContent || '').replace(/\s+/g, ' ').trim();
      return !button.disabled && (partial ? value.includes(label) : value === label);
    });
  }, { timeout: 15000 }, { rootSelector: selector, label: text, partial: contains });
  await page.evaluate(({ rootSelector, label, partial }) => {
    const root = document.querySelector(rootSelector);
    const button = [...root.querySelectorAll('button')].find(item => {
      const value = (item.textContent || '').replace(/\s+/g, ' ').trim();
      return !item.disabled && (partial ? value.includes(label) : value === label);
    });
    button.click();
  }, { rootSelector: selector, label: text, partial: contains });
}

async function waitForText(page, text) {
  await page.waitForFunction(value => document.body.innerText.includes(value), { timeout: 15000 }, text);
}

async function replaceInput(page, selector, value) {
  await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  await page.focus(selector);
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.press('A');
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.press('Backspace');
  await page.type(selector, value);
  await page.waitForFunction(({ target, expected }) => document.querySelector(target)?.value === expected,
    { timeout: 5000 }, { target: selector, expected: value });
}

async function viewportCheck(page, width, height) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await new Promise(resolve => setTimeout(resolve, 80));
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="invoice-receipt-workbench"]');
    const sheet = document.querySelector('[aria-label="입고 검토 행 표"]');
    const issues = document.querySelector('[aria-label="미리보기 이슈"]');
    const rootRect = root?.getBoundingClientRect();
    const sheetRect = sheet?.getBoundingClientRect();
    const issueRect = issues?.getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight],
      documentOverflow: document.documentElement.scrollWidth > innerWidth,
      rootInside: Boolean(rootRect && rootRect.left >= 0 && rootRect.right <= innerWidth + 1),
      tableScroller: Boolean(sheet && getComputedStyle(sheet).overflowX === 'auto'),
      tableOverflow: Boolean(sheet && sheet.scrollWidth > sheet.clientWidth),
      sideBySide: Boolean(sheetRect && issueRect && issueRect.left >= sheetRect.right - 2),
      stacked: Boolean(sheetRect && issueRect && issueRect.top >= sheetRect.bottom - 2),
    };
  });
  assert.equal(metrics.documentOverflow, false, `${width} viewport must not create document-level horizontal overflow`);
  assert.equal(metrics.rootInside, true, `${width} workbench must remain inside the viewport`);
  assert.equal(metrics.tableScroller, true, `${width} table must retain its bounded horizontal scroller`);
  if (width === 1920) assert.equal(metrics.sideBySide, true, '1920 layout must keep the issue rail beside the table');
  if (width === 1280) {
    assert.equal(metrics.stacked, true, '1280 layout must stack the issue rail below the table');
    assert.equal(metrics.tableOverflow, true, '1280 layout must scroll the wide table inside its region');
  }
  const outputDirectory = path.join(root, 'outputs');
  fs.mkdirSync(outputDirectory, { recursive: true });
  await page.screenshot({ path: path.join(outputDirectory, `invoice-receipt-ui-${width}x${height}.png`), fullPage: true });
  return metrics;
}

async function run() {
  logStage('fixture-server-start');
  const port = await listen();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const chromeCandidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  ].filter(Boolean);
  const executablePath = chromeCandidates.find(candidate => fs.existsSync(candidate));
  if (!executablePath) throw new Error('Chrome executable not found. Set CHROME_PATH.');

  const observed = { api: [], writes: [], blockedExternal: [], unexpectedApi: [], previews: 0 };
  logStage('browser-launch');
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let page;
  try {
    page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async value => { window.__invoiceReceiptCopied = value; },
      } });
    });
    await page.setRequestInterception(true);
    page.on('request', async request => {
      if (request.isInterceptResolutionHandled()) return;
      const url = new URL(request.url());
      // Browser-native date inputs use embedded icons; these never reach a network.
      if (url.protocol === 'data:') return request.continue();
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
        observed.blockedExternal.push(request.url());
        return request.abort('blockedbyclient');
      }
      if (!url.pathname.startsWith('/api/')) return request.continue();
      const method = request.method().toUpperCase();
      observed.api.push(`${method} ${url.pathname}${url.search}`);
      if (!['GET', 'HEAD'].includes(method)) observed.writes.push({ method, path: url.pathname, body: request.postData() || '' });
      if (url.pathname === '/api/arrival-cost' && method === 'GET') return json(request, { success: true, farms: [{ FarmKey: 501, FarmName: 'SMOKE FARM' }] });
      if (url.pathname === '/api/import/receipts/drafts' && method === 'GET') return json(request, { success: true, documents: [
        { documentId: DRAFT_ID, revision: 2, invoiceNo: 'SMOKE-DRAFT', farmName: 'SMOKE FARM', receiptStatus: 'DRAFT' },
        { documentId: COMMITTED_ID, revision: 4, invoiceNo: 'SMOKE-COMMITTED', farmName: 'SMOKE FARM', receiptStatus: 'COMMITTED' },
      ] });
      if (url.pathname === `/api/import/receipts/${DRAFT_ID}` && method === 'GET') return json(request, { success: true, document: draft });
      if (url.pathname === `/api/import/receipts/${COMMITTED_ID}` && method === 'GET') return json(request, { success: true, document: committed });
      if (url.pathname === `/api/import/receipts/${DRAFT_ID}` && method === 'PATCH') return json(request, { success: false, code: 'SMOKE_SAVE_FAILED', error: 'SMOKE_SAVE_FAILED' }, 500);
      if (url.pathname === `/api/import/receipts/${DRAFT_ID}/preview` && method === 'POST') {
        observed.previews += 1;
        const issue = { code: 'SMOKE_SELECTED_ISSUE', message: '선택 행 수량을 다시 확인하세요.', lineId: LINE_ID };
        return json(request, { success: true, preview: {
          canCommit: observed.previews > 1,
          baselineDigest: 'd'.repeat(64),
          eligibility: { allowed: observed.previews > 1 },
          issues: observed.previews === 1 ? [issue] : [],
          reconciliation: { rows: [{ lineId: LINE_ID, status: observed.previews > 1 ? 'MATCHED' : 'REVIEW' }] },
          lines: draft.lines.map(line => ({ ...line, prodName: 'SMOKE ROSE ERP', outQuantity: 20, outUnit: '단' })),
          cost: { status: 'PENDING' },
          documentRevision: 2,
        } });
      }
      observed.unexpectedApi.push(`${method} ${url.pathname}`);
      return json(request, { success: false, error: 'SMOKE_UNEXPECTED_API' }, 500);
    });

    logStage('page-load');
    await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction(() => window.__invoiceReceiptSmokeMounted === true);
    await page.waitForSelector('form[aria-label="저장 인보이스 검색"]', { visible: true });

    logStage('saved-scope-search');
    const filters = await page.$$('form[aria-label="저장 인보이스 검색"] input');
    await filters[0].type('2026');
    await filters[1].type('41-01');
    await page.$eval('form[aria-label="저장 인보이스 검색"]', form => form.requestSubmit());
    await waitForText(page, 'SMOKE-DRAFT');
    logStage('draft-load');
    await clickButtonWithin(page, '[aria-label="같은 연도 차수 저장 문서"]', 'SMOKE-DRAFT', { contains: true });
    await waitForText(page, '저장됨 · revision 2');
    assert.equal(await page.$eval('input[aria-label="1행 단"]', input => input.value), '20');
    assert.equal(await page.$eval('input[aria-label="1행 전산 품목 검색"]', input => input.value), 'SMOKE ROSE ERP (#77)');

    logStage('failed-save-retains-draft');
    await replaceInput(page, 'input[aria-label="1행 단"]', '21');
    assert.equal(await page.$eval('input[aria-label="1행 단"]', input => input.value), '21', 'draft value must be replaced before save');
    await clickButton(page, '변경 초안 저장');
    await waitForText(page, 'SMOKE_SAVE_FAILED');
    assert.equal(await page.$eval('input[aria-label="1행 단"]', input => input.value), '21', 'failed save must retain the edited draft');

    logStage('draft-reload-after-failed-save');
    await clickButtonWithin(page, '[aria-label="같은 연도 차수 저장 문서"]', 'SMOKE-DRAFT', { contains: true });
    await waitForText(page, '저장됨 · revision 2');
    logStage('issue-preview');
    await clickButton(page, '서버 미리보기');
    await waitForText(page, '선택 행 수량을 다시 확인하세요.');
    await clickButton(page, '선택 행 수량을 다시 확인하세요.', { contains: true });
    logStage('selected-issue-copy');
    await clickButton(page, '특이사항 복사');
    await page.waitForSelector('[role="dialog"][aria-label="특이사항 복사"] textarea', { visible: true });
    const brief = await page.$eval('[role="dialog"][aria-label="특이사항 복사"] textarea', node => node.value);
    assert(brief.includes('SMOKE ROSE') && brief.includes('선택 행 수량을 다시 확인하세요.'), 'copy brief must contain the selected row issue');
    await clickButton(page, '클립보드 복사');
    await page.waitForFunction(() => window.__invoiceReceiptCopied?.includes('선택 행 수량을 다시 확인하세요.'));
    await clickButton(page, '닫기');

    logStage('clean-preview');
    await clickButton(page, 'SMOKE-DRAFT', { contains: true });
    await clickButton(page, '서버 미리보기');
    await waitForText(page, '이슈 0건 · canCommit true');
    logStage('reason-modal');
    await clickButton(page, 'ERP 입고 등록 확인');
    await page.waitForSelector('[role="dialog"][aria-label="ERP 입고 등록 최종 확인"]', { visible: true });
    const commitDialog = await page.$eval('[role="dialog"][aria-label="ERP 입고 등록 최종 확인"]', node => node.innerText);
    assert(commitDialog.includes('2026 / 41-01') && commitDialog.includes('SMOKE-DRAFT') && commitDialog.includes('등록 사유 (필수)'));
    assert(commitDialog.includes('ERP 저장수량') && commitDialog.includes('20 단'), 'commit dialog must show the server-resolved ERP stock quantity');
    assert.equal(await page.$eval('[role="dialog"] footer button:last-child', button => button.disabled), true);
    await page.type('[role="dialog"] textarea', 'fixture confirmation only');
    assert.equal(await page.$eval('[role="dialog"] footer button:last-child', button => button.disabled), false);
    await clickButton(page, '취소');

    logStage('committed-cost-review');
    await clickButtonWithin(page, '[aria-label="같은 연도 차수 저장 문서"]', 'SMOKE-COMMITTED', { contains: true });
    await page.waitForSelector('[aria-label="인보이스 도착원가 검토"]', { visible: true });
    assert((await page.$eval('[aria-label="인보이스 도착원가 검토"]', node => node.innerText)).includes('실제 입고량 도착원가'));
    logStage('responsive-layout');
    const viewports = [await viewportCheck(page, 1920, 1080), await viewportCheck(page, 1280, 800)];

    logStage('dirty-cost-stale');
    await replaceInput(page, 'input[aria-label="1행 단"]', '19');
    await waitForText(page, '도착원가 STALE');
    assert.equal(await page.$('[aria-label="인보이스 도착원가 검토"]'), null, 'dirty committed revision must hide cost review');

    assert.equal(serverApiHits, 0, 'no API request may reach the local fixture server');
    assert.deepEqual(observed.unexpectedApi, []);
    assert.deepEqual(observed.blockedExternal, []);
    const mutations = observed.writes.filter(item => !item.path.endsWith('/preview'));
    assert.equal(observed.writes.filter(item => item.path.endsWith('/preview') && item.method === 'POST').length, 2, 'exactly two read-only previews are expected');
    assert.equal(mutations.length, 1, 'only the deliberately failed mocked draft PATCH is expected');
    assert.equal(mutations[0].method, 'PATCH');
    assert.equal(pageErrors.length, 0, `browser errors: ${pageErrors.join(' | ')}`);
    logStage('complete');
    console.log(JSON.stringify({
      pass: true,
      sourceCompiledWith: 'next bundled Babel',
      fixtureServer: baseUrl,
      apiReachedServer: serverApiHits,
      mockedWrites: observed.writes.map(item => `${item.method} ${item.path}`),
      scenarios: ['no-upload saved lookup', 'draft table load', 'failed save retains draft', 'selected issue copy', 'reason modal', 'committed cost review', 'dirty cost stale'],
      viewports,
    }, null, 2));
  } catch (error) {
    const outputDirectory = path.join(root, 'outputs');
    const screenshot = path.join(outputDirectory, 'invoice-receipt-ui-smoke-failure.png');
    fs.mkdirSync(outputDirectory, { recursive: true });
    let body = '';
    try {
      body = await page?.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().slice(-4000));
      if (page && !page.isClosed()) await page.screenshot({ path: screenshot, fullPage: true });
    } catch (diagnosticError) {
      body = `diagnostic capture failed: ${diagnosticError.message}`;
    }
    error.smokeDiagnostic = { stage: smokeStage, body, screenshot };
    throw error;
  } finally {
    await browser.close();
    await closeServer();
  }
}

if (process.argv.includes('--compile-only')) {
  console.log(JSON.stringify({ pass: true, compileOnly: true, compiler: 'next bundled Babel', bundleBytes: Buffer.byteLength(bundle), cssBytes: Buffer.byteLength(css) }));
} else {
  run().catch(async error => {
    console.error(error.stack || error.message);
    if (error.smokeDiagnostic) console.error(JSON.stringify(error.smokeDiagnostic, null, 2));
    if (server.listening) await closeServer();
    process.exit(1);
  });
}

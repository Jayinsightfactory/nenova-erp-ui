// Local-only Puppeteer regression for manually confirmed Gangnam multi-sheet PNL saves.
// All API traffic is intercepted; no real PNL/ERP writes, external requests, installs,
// or network access are permitted. Runtime XLSX/screenshots are written under outputs/.
// Usage:
//   $env:NODE_PATH='C:/Users/USER/Documents/Codex/2026-07-11/new-chat/work/qa-runtime/node_modules'
//   node scripts/raum-pnl-manual-save-smoke.cjs http://127.0.0.1:3020/raum/pnl

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const XLSX = require('xlsx');

const fixtureOnly = process.argv.includes('--fixture-only');
const targetArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const target = targetArg || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3020/raum/pnl';
const targetUrl = new URL(target);
if (!['127.0.0.1', 'localhost'].includes(targetUrl.hostname) || !['http:', 'https:'].includes(targetUrl.protocol)) {
  throw new Error(`SMOKE_BASE_URL must be localhost, received ${target}`);
}

const TESTID = {
  upload: 'raum-pnl-upload',
  confirm: 'raum-pnl-merge-confirm',
  singleSave: 'raum-pnl-save',
  bulkSave: 'raum-pnl-bulk-save',
  reason: 'raum-pnl-save-reason',
};
const GANGNAM_MARKER = 'RAUM_GANGNAM_MULTISHEET';
const outDir = path.resolve('outputs');
const fixturePath = path.join(outDir, 'raum-pnl-gangnam-merge-smoke.xlsx');
const screenshotPath = path.join(outDir, 'raum-pnl-manual-save-1920x1080.png');
const screenshot1366Path = path.join(outDir, 'raum-pnl-manual-save-1366x768.png');
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
].filter(Boolean);
const executablePath = chromeCandidates.find(candidate => { try { return fs.existsSync(candidate); } catch { return false; } });
if (!executablePath) throw new Error('Chrome executable not found. Set CHROME_PATH.');

function assert(condition, message) { if (!condition) throw new Error(message); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(check, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function testSelector(id) { return `[data-testid="${id}"]`; }
async function bodyText(page) {
  return page.$eval('body', node => String(node.innerText || '').replace(/\s+/g, ' ').trim());
}
async function clickTestid(page, id) {
  const selector = testSelector(id);
  await page.waitForSelector(selector, { visible: true, timeout: 30000 });
  await page.click(selector);
}
async function controlBounds(page, id) {
  return page.$eval(testSelector(id), node => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight, disabled: Boolean(node.disabled), tag: node.tagName };
  });
}
function makeFixture() {
  fs.mkdirSync(outDir, { recursive: true });
  const workbook = XLSX.utils.book_new();
  const sheet = ({ name, qty, price }) => XLSX.utils.aoa_to_sheet([
    ['품목명', '단위', '수량', '단가', '공급가액', '부가세', '원산지', '비고'],
    [name, '단', qty, price, qty * price, qty * price * 0.1, '수입', 'smoke fixture'],
    ['공급가액', qty * price, 'VAT', qty * price * 0.1, '합계', qty * price * 1.1],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet({ name: '스모크 장미', qty: 10, price: 1000 }), '34차강남');
  XLSX.utils.book_append_sheet(workbook, sheet({ name: '스모크 장미', qty: 3, price: 1000 }), '34차강남콘서트');
  XLSX.utils.book_append_sheet(workbook, sheet({ name: '스모크 튤립', qty: 2, price: 1500 }), '35차건대');
  XLSX.writeFile(workbook, fixturePath, { compression: true });
  return fixturePath;
}

async function parseFixtureBatches() {
  const [{ parseRaumQuoteWorkbookGroups }, { evaluateRaumPnlImportReview, RAUM_GANGNAM_MULTISHEET }] = await Promise.all([
    import(pathToFileURL(path.resolve('lib/raumPnlParse.js')).href),
    import(pathToFileURL(path.resolve('lib/raumPnlImportReview.js')).href),
  ]);
  evaluateImportReview = evaluateRaumPnlImportReview;
  assert(RAUM_GANGNAM_MULTISHEET === GANGNAM_MARKER, 'smoke marker must match the shared import-review policy');
  const workbook = XLSX.readFile(fixturePath, { cellDates: true, cellNF: false, cellStyles: false });
  const parsed = parseRaumQuoteWorkbookGroups(XLSX, workbook, { partnerCode: 'raum' });
  const batches = parsed.batches.map(batch => ({
    ...batch,
    orderYear: '2026',
    partnerCode: 'raum',
    quoteDate: batch.quoteDate ? batch.quoteDate.toISOString().slice(0, 10) : '2026-09-14',
    sheets: batch.sheets.map(sheet => ({
      ...sheet,
      itemCount: sheet.items.length,
      items: undefined,
    })),
  }));
  const mergeBatch = batches.find(batch => String(batch.major) === '34');
  assert(mergeBatch?.sheets.length === 2, 'XLSX parser must produce both Gangnam source sheets in 34차');
  assert(mergeBatch.items.reduce((sum, item) => sum + item.qty, 0) === 13, 'XLSX parser must sum Gangnam quantities 10+3');
  const review = evaluateRaumPnlImportReview([mergeBatch]);
  assert(review.requiresConfirmation && !review.allowAuto && !review.allowManual, 'shared policy must classify the parsed Gangnam batch as manual-confirmation review');
  return batches;
}
function previewFor(scenario, parsedBatches) {
  if (scenario === 'shilla') {
    const batch = (major, ok) => ({
      major, orderYear: '2026', partnerCode: 'shilla', quoteDate: '2026-09-14', nenovaPct: 80,
      sheets: [{ sheetName: `${major}차 신라 원본`, itemCount: 1 }],
      items: [{ seq: 1, name: `신라 스모크 품목 ${major}`, unit: '개', qty: 1, price: 1000, supply: 1000,
        costPrice: 500, costSource: 'source', isCustom: false }],
      verification: [{ group: '신라', label: '원본 합계 검증', sheetVal: 1000, parsedVal: ok ? 1000 : 900, diff: ok ? 0 : -100,
        ok, message: ok ? '' : '합계 불일치', sourceRow: ok ? null : 12 }],
      warnings: ok ? [] : ['35차 원본 합계 불일치'],
    });
    return { success: true, mode: 'preview', fileName: path.basename(fixturePath), previewToken: 'smoke-shilla-preview-token',
      batches: [batch('34', true), batch('35', false)], warnings: ['35차 검증 실패'] };
  }
  const batches = parsedBatches.map(batch => ({
    ...batch,
    items: batch.items.map(item => ({ ...item, byBranch: { ...(item.byBranch || {}) } })),
    sheets: batch.sheets.map(sheet => ({ ...sheet })),
    verification: batch.verification.map(check => ({ ...check,
      sheetNames: Array.isArray(check.sheetNames) ? [...check.sheetNames] : undefined })),
    warnings: [...(batch.warnings || [])],
  }));
  if (scenario === 'mismatch') {
    const gangnam = batches.find(batch => String(batch.major) === '34');
    const check = gangnam.verification.find(item => item.label === '합계(VAT포함)');
    Object.assign(check, { sheetVal: check.sheetVal + 100, diff: -100, ok: false,
      info: '합계(VAT포함) 요약과 파싱 금액이 일치하지 않습니다.' });
    gangnam.warnings = [...(gangnam.warnings || []), '검증 실패 — 강남 합계(VAT포함) 금액 불일치'];
  }
  return {
    success: true, mode: 'preview', fileName: path.basename(fixturePath), previewToken: `smoke-${scenario}-preview-token`,
    batches: scenario === 'bulk' ? batches : batches.filter(batch => String(batch.major) === '34'),
    warnings: batches.flatMap(batch => batch.warnings || []),
  };
}
function multipartValue(raw, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = raw.match(new RegExp(`name="${escaped}"\\r?\\n\\r?\\n([^\\r\\n]*)`));
  return match?.[1] ?? null;
}
function savePayload(request) {
  const raw = request.postData() || '';
  if (/application\/json/i.test(request.headers()['content-type'] || '')) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  return {
    confirmGangnamMerge: multipartValue(raw, 'confirmGangnamMerge'),
    previewToken: multipartValue(raw, 'previewToken'),
    selectedMajors: multipartValue(raw, 'selectedMajors'),
    raw,
  };
}
function writePreview(request, scenario, parsedBatches) {
  return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(previewFor(scenario, parsedBatches)) });
}

const observed = { requests: [], saves: [], externalRequests: [], blockedRequests: [], scenarios: [] };
let activeScenario = 'bulk';
let currentSaveResult = 'success';
let parsedBatches = [];
let evaluateImportReview = null;
const importPostCounts = new Map();
const user = { userId: 'raum-pnl-manual-save-smoke', userName: 'raum-pnl-manual-save-smoke', role: 'admin' };
async function recordedFetchPayload(page, pathname) {
  return page.evaluate(path => {
    const record = (window.__raumSmokeFetches || []).filter(item => item.url.includes(path) && item.method === 'POST').at(-1);
    return record?.fields || {};
  }, pathname);
}
async function installMocks(page) {
  await page.evaluateOnNewDocument(() => {
    window.__raumSmokeFetches = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = String(init.method || (typeof input === 'object' ? input.method : 'GET')).toUpperCase();
      const body = init.body;
      const fields = {};
      if (body instanceof FormData) {
        for (const [key, value] of body.entries()) fields[key] = typeof value === 'string' ? value : { name: value.name, type: value.type, size: value.size };
      } else if (typeof body === 'string') {
        try { Object.assign(fields, JSON.parse(body)); } catch { fields.raw = body; }
      }
      window.__raumSmokeFetches.push({ url, method, fields });
      return originalFetch(input, init);
    };
  });
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const method = request.method().toUpperCase();
    let url;
    try { url = new URL(request.url()); } catch {
      observed.blockedRequests.push(request.url());
      return request.abort('blockedbyclient');
    }
    if (['data:', 'blob:'].includes(url.protocol)) return request.continue();
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      observed.externalRequests.push(request.url());
      return request.abort('blockedbyclient');
    }
    observed.requests.push({ method, path: url.pathname, query: url.search });
    if (url.pathname === '/api/auth/me' && method === 'GET') {
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, user }) });
    }
    if (url.pathname === '/api/favorites' && method === 'GET') {
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, favorites: [] }) });
    }
    if (/^\/api\/raum\/pnl(?:\/|$)/.test(url.pathname) && method === 'GET') {
      const data = url.searchParams.get('view') === 'cost-history' ? { success: true, rows: [] } : { success: true, list: [] };
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    }
    if (url.pathname === '/api/raum/pnl-import' && method === 'POST') {
      const postCount = (importPostCounts.get(activeScenario) || 0) + 1;
      importPostCounts.set(activeScenario, postCount);
      if (postCount === 1) return writePreview(request, activeScenario, parsedBatches);
      const payload = { ...savePayload(request), ...await recordedFetchPayload(page, url.pathname) };
      observed.saves.push({ scenario: activeScenario, path: url.pathname, payload });
      if (currentSaveResult === 'http500') {
        return request.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'SMOKE_SAVE_HTTP_500' }) });
      }
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, batchCount: activeScenario === 'bulk' ? 2 : 1, saved: [] }) });
    }
    if (url.pathname === '/api/raum/pnl' && method === 'POST') {
      const payload = { ...savePayload(request), ...await recordedFetchPayload(page, url.pathname) };
      observed.saves.push({ scenario: activeScenario, path: url.pathname, payload });
      if (currentSaveResult === 'http500') {
        return request.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'SMOKE_SAVE_HTTP_500' }) });
      }
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, pnlKey: 70001 }) });
    }
    if (url.pathname.startsWith('/api/')) {
      observed.blockedRequests.push(`${method} ${url.pathname}`);
      return request.respond({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'SMOKE_UNEXPECTED_API' }) });
    }
    return request.continue();
  });
}
async function uploadFixture(page) {
  const testid = testSelector(TESTID.upload);
  await page.waitForSelector(testid, { timeout: 30000 });
  const handles = await page.$$(testid);
  assert(handles.length > 0, `missing upload testid ${TESTID.upload}`);
  let uploaded = false;
  for (const handle of handles) {
    const info = await handle.evaluate(node => ({ tag: node.tagName, type: node.type || '', visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length) }));
    if (info.tag === 'INPUT' && info.type === 'file') {
      await handle.uploadFile(fixturePath);
      uploaded = true;
      break;
    }
  }
  if (!uploaded) {
    const chooserPromise = page.waitForFileChooser({ timeout: 5000 });
    let uploadControl = handles[0];
    for (const handle of handles) {
      if (await handle.evaluate(node => node.tagName !== 'INPUT')) { uploadControl = handle; break; }
    }
    await uploadControl.click();
    const chooser = await chooserPromise;
    await chooser.accept([fixturePath]);
  }
  await waitFor(() => observed.requests.some(item => item.method === 'POST' && item.path === '/api/raum/pnl-import'), 'mocked upload preview request');
  await waitFor(async () => (await bodyText(page)).includes('스모크 장미') || (await bodyText(page)).includes('34차'), 'uploaded preview UI');
}
async function newScenarioPage(browser, scenario, saveResult = 'success', partner = 'raum') {
  activeScenario = scenario;
  currentSaveResult = saveResult;
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(selectedPartner => localStorage.setItem('nenova.raumPnl.partner', selectedPartner), partner);
  await installMocks(page);
  await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await uploadFixture(page);
  return page;
}
async function checkboxAndSaveControl(page, { bulk = false, shouldEnableAfterCheck = true } = {}) {
  const confirmSelector = testSelector(TESTID.confirm);
  await page.waitForSelector(confirmSelector, { visible: true, timeout: 30000 });
  assert(!(await page.$eval(confirmSelector, node => node.checked)), 'Gangnam merge confirmation must default to unchecked');
  const saveId = bulk ? TESTID.bulkSave : TESTID.singleSave;
  let save = await controlBounds(page, saveId);
  assert(save.disabled, `${saveId} must start disabled before confirmation`);
  const reason = await page.$eval(testSelector(TESTID.reason), node => ({ text: (node.innerText || node.textContent || '').trim(), y: node.getBoundingClientRect().y }));
  assert(reason.text, 'save disabled reason must be visible and non-empty');
  assert(Math.abs(reason.y - save.y) < 240, 'save disabled reason must be adjacent to the save control');
  await clickTestid(page, TESTID.confirm);
  save = await controlBounds(page, saveId);
  assert(save.disabled === !shouldEnableAfterCheck, `${saveId} disabled state after confirmation did not match expectation`);
  return { saveId, save };
}
async function assertViewportAndScreenshot(page) {
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    const result = await page.evaluate(() => {
      const save = document.querySelector(`[data-testid="${document.body.innerText.includes('35차') ? 'raum-pnl-bulk-save' : 'raum-pnl-save'}"]`)
        || document.querySelector('[data-testid="raum-pnl-save"], [data-testid="raum-pnl-bulk-save"]');
      const rect = save?.getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth,
        saveVisible: !!save && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= innerHeight };
    });
    assert(!result.overflow, `horizontal overflow at ${viewport.width}x${viewport.height}`);
    assert(result.saveVisible, `save button is offscreen at ${viewport.width}x${viewport.height}`);
    if (viewport.width === 1920) await page.screenshot({ path: screenshotPath, fullPage: false });
    else await page.screenshot({ path: screenshot1366Path, fullPage: false });
  }
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
}
async function run() {
  const localFixture = makeFixture();
  parsedBatches = await parseFixtureBatches();
  const gangnam = parsedBatches.find(batch => String(batch.major) === '34');
  assert(gangnam.verification.some(check => check.code === GANGNAM_MARKER && check.ok === true && check.requiresConfirmation === true
    && check.group === '강남' && gangnam.partnerCode === 'raum'), 'parser must emit the exact shared Gangnam review verification shape');
  if (fixtureOnly) {
    console.log(JSON.stringify({
      fixture: localFixture,
      fixtureBytes: fs.statSync(localFixture).size,
      parsedBatches: parsedBatches.map(batch => ({
        partnerCode: batch.partnerCode, major: batch.major,
        sheetNames: batch.sheets.map(sheet => sheet.sheetName),
        quantity: batch.items.reduce((sum, item) => sum + Number(item.qty || 0), 0),
        review: batch.verification.filter(check => check.code === GANGNAM_MARKER),
      })),
    }, null, 2));
    return;
  }

  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    // 34차+35차 bulk: confirmation is explicit, and the multipart API sees boolean true.
    let page = await newScenarioPage(browser, 'bulk');
    assert((await bodyText(page)).includes('강남'), 'bulk preview must show the Gangnam review context');
    await assertViewportAndScreenshot(page);
    await checkboxAndSaveControl(page, { bulk: true });
    await clickTestid(page, TESTID.bulkSave);
    await waitFor(() => observed.saves.some(item => item.scenario === 'bulk'), 'bulk save request');
    const bulkSave = observed.saves.find(item => item.scenario === 'bulk');
    assert(bulkSave.payload.confirmGangnamMerge === 'true', 'bulk multipart save must send confirmGangnamMerge=true');
    await page.close();
    observed.scenarios.push('bulk-34-and-35-confirmed-save');

    // A single Gangnam confirmation upload must use the snapshot-checked multipart save path.
    page = await newScenarioPage(browser, 'single');
    const singleControls = await checkboxAndSaveControl(page, { bulk: true });
    assert((await bodyText(page)).includes('강남'), 'single preview must show the Gangnam review context');
    assert(singleControls.saveId === TESTID.bulkSave, 'single Gangnam preview must use the snapshot-checked bulk save control');
    await clickTestid(page, TESTID.bulkSave);
    await waitFor(() => observed.saves.some(item => item.scenario === 'single'), 'single manual save request');
    const singleSave = observed.saves.find(item => item.scenario === 'single');
    assert(singleSave.path === '/api/raum/pnl-import', 'single Gangnam save must avoid the legacy detail save route');
    assert(singleSave.payload.confirmGangnamMerge === 'true', 'single multipart save must send confirmGangnamMerge=true');
    await page.close();
    observed.scenarios.push('single-34-confirmed-save');

    // A hard summary-total mismatch hides confirmation and remains blocked even if policy receives true.
    page = await newScenarioPage(browser, 'mismatch');
    const mismatchDecision = evaluateImportReview(previewFor('mismatch', parsedBatches).batches, true);
    assert(mismatchDecision.blocking.length > 0 && !mismatchDecision.allowManual,
      'hard mismatch must remain blocking when confirmGangnamMerge=true');
    assert((await page.$$(testSelector(TESTID.confirm))).length === 0,
      'confirmation checkbox should be hidden while a hard verification failure exists');
    const mismatchSaveId = await page.$(testSelector(TESTID.bulkSave)) ? TESTID.bulkSave : TESTID.singleSave;
    assert((await controlBounds(page, mismatchSaveId)).disabled, 'hard total mismatch must leave save disabled');
    const mismatchReason = await page.$eval(testSelector(TESTID.reason), node => (node.innerText || node.textContent || '').trim());
    assert(mismatchReason.includes('검증') && mismatchReason.includes('실패'), 'hard mismatch reason must be shown next to save');
    assert(!observed.saves.some(item => item.scenario === 'mismatch'), 'hard mismatch must not issue any save request');
    await page.close();
    observed.scenarios.push('hard-total-mismatch-blocked-even-with-confirmation-true');

    // Server failure on the one-batch multipart path is shown without discarding its draft.
    page = await newScenarioPage(browser, 'http500', 'http500');
    await checkboxAndSaveControl(page, { bulk: true });
    await clickTestid(page, TESTID.bulkSave);
    await waitFor(async () => (await bodyText(page)).includes('SMOKE_SAVE_HTTP_500'), 'visible HTTP 500 save error');
    assert(await page.$eval(testSelector(TESTID.confirm), node => node.checked), 'failed save must retain the checked confirmation state');
    assert((await bodyText(page)).includes('스모크 장미') || (await bodyText(page)).includes('34차'), 'failed save must retain the preview draft');
    assert(observed.saves.find(item => item.scenario === 'http500')?.path === '/api/raum/pnl-import', 'HTTP 500 must exercise the bulk snapshot save route');
    await page.close();
    observed.scenarios.push('http500-visible-error-draft-retained');

    // Shilla selection must scope validation to selected majors: an unselected failed batch cannot block a valid selected save.
    page = await newScenarioPage(browser, 'shilla', 'success', 'shilla');
    await page.waitForSelector('input[aria-label="34차 저장"]', { visible: true, timeout: 30000 });
    assert(await page.$eval('input[aria-label="34차 저장"]', node => node.checked), 'valid Shilla batch should be selected by default');
    assert(await page.$eval('input[aria-label="35차 저장"]', node => !node.checked && node.disabled), 'failed, unselected Shilla batch must remain unchecked and unselectable');
    const shillaSaveControl = await controlBounds(page, TESTID.bulkSave);
    assert(!shillaSaveControl.disabled, 'unselected failed Shilla batch must not disable saving a selected valid batch');
    await clickTestid(page, TESTID.bulkSave);
    await waitFor(() => observed.saves.some(item => item.scenario === 'shilla'), 'selected Shilla batch save request');
    const shillaSave = observed.saves.find(item => item.scenario === 'shilla');
    assert(shillaSave.payload.selectedMajors === '["34"]', `Shilla save must include only the selected valid batch, received ${shillaSave.payload.selectedMajors}`);
    await page.close();
    observed.scenarios.push('shilla-unselected-failed-batch-does-not-block-selected-save');

    assert(observed.externalRequests.length === 0, `external requests were blocked: ${observed.externalRequests.join(', ')}`);
    assert(observed.blockedRequests.length === 0, `unexpected API requests: ${observed.blockedRequests.join(', ')}`);
    assert(observed.saves.filter(item => item.scenario !== 'shilla')
      .every(item => item.payload.confirmGangnamMerge === true || item.payload.confirmGangnamMerge === 'true'), 'every Raum mocked save must carry explicit Gangnam confirmation');
    assert(observed.saves.filter(item => ['bulk', 'single', 'http500'].includes(item.scenario))
      .every(item => item.path === '/api/raum/pnl-import'), 'all Gangnam confirmation uploads must use the snapshot-checked import save route');
    console.log(JSON.stringify({
      target: targetUrl.href,
      fixture: localFixture,
      fixtureBytes: fs.statSync(localFixture).size,
      viewportChecks: ['1920x1080', '1366x768'],
      screenshots: [screenshotPath, screenshot1366Path],
      scenarios: observed.scenarios,
      saves: observed.saves.map(item => ({ scenario: item.scenario, path: item.path,
        confirmGangnamMerge: item.payload.confirmGangnamMerge, selectedMajors: item.payload.selectedMajors })),
      externalRequests: observed.externalRequests,
      blockedRequests: observed.blockedRequests,
      apiRequests: observed.requests,
    }, null, 2));
  } catch (error) {
    const failedPage = (await browser.pages()).at(-1);
    const failurePath = path.join(outDir, 'raum-pnl-manual-save-failure.png');
    if (failedPage) await failedPage.screenshot({ path: failurePath, fullPage: false }).catch(() => {});
    console.error(JSON.stringify({ failure: error.stack || error.message, screenshot: failurePath, observed }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}

run().catch(error => { console.error(error.message); process.exit(1); });

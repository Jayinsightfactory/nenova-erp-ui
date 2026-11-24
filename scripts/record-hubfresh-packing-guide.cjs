const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer-core');
const XLSX = require('xlsx');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');
const dry = process.argv.includes('--dry-run');
const crossYear = dry && process.argv.includes('--cross-year');
const registryPath = 'config/workflow-guides.json';
const workflowId = 'hubfresh-packing';

async function main() {
  const registry = JSON.parse(fs.readFileSync(registryPath));
  const workflow = registry.workflows.find(item => item.id === workflowId);
  fs.mkdirSync('.verify', { recursive: true });
  const filename = '.verify/CI-2026-TRAINING（48-1）.xlsx';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['HUBFRESH · TRAINING', 'INVOICE NO. XJ-2026-TRAINING'],
    ['English name', 'Chinese name', 'Customer Code', 'Ctn No', 'Code', 'Length', 'Specification', 'Box specifications',
      'Order Quantities', 'Total of bunches', 'Stems', 'UNIT PRICE', 'AMOUNT'],
    ['Training Rose', '', 'YCL1', '1-2', 'TRAINING-ROSE', '60CM', '10Stem/Bunch', '100*40*20', 2, 10, 100, 3, 30],
    ['Training Rose', '', 'INT', '3', 'TRAINING-ROSE', '60CM', '10Stem/Bunch', '100*40*20', 1, 5, 50, 3, 15],
  ]), 'INVOICE');
  XLSX.writeFile(workbook, filename);

  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const secret = crypto.randomUUID();
  const log = fs.openSync('.verify/hubfresh-guide-server.log', 'w');
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), ...(process.argv.includes('--dev') ? ['dev', '--webpack'] : ['start']), '-p', String(port)], {
    env: { ...process.env, DB_SERVER: '', JWT_SECRET: secret }, stdio: ['ignore', log, log], windowsHide: true,
  });
  fs.closeSync(log);
  let browser;
  try {
    for (let i = 0; i < 240; i++) {
      if (await fetch(base + '/login').then(response => response.ok).catch(() => false)) break;
      if (i === 239) throw new Error('Guide server unavailable');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    browser = await puppeteer.launch({
      headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    page.on('pageerror', error => console.error(error.message));
    page.on('dialog', async dialog => { console.error(dialog.message()); await dialog.dismiss(); });
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const user = { userId: 'hubfresh-guide', userName: '연습 담당자', authority: 4, deptName: '수입부', accountActive: true };
    await page.setCookie({ name: 'nenovaToken', value: jwt.sign(user, secret, { expiresIn: '1h' }), url: base });
    let preview = null;
    let unexpectedWrite = false;
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = new URL(req.url());
      if (!/^https?:$/.test(url.protocol)) return req.continue();
      if (url.origin !== base) return req.abort();
      if (!url.pathname.startsWith('/api/')) return req.continue();
      const body = { success: true, user, products: [], value: null, revision: 0, items: [], rows: [], history: [], data: [], masters: [], requests: [], permissions: {} };
      if (url.pathname === '/api/import/tools/product-matches') {
        body.products = [{ ProdKey: 1, ProdName: 'Training Rose 60CM', ProdCode: 'TRAINING-ROSE', country: 'CN', selectable: true, legacyExportSafe: true }];
      }
      if (url.pathname === '/api/warehouse' && req.method() === 'POST') {
        const submitted = JSON.parse(req.postData());
        if (!submitted.previewOnly) {
          unexpectedWrite = true;
          return req.abort();
        }
        preview = submitted;
      }
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(base + '/import/tools', { waitUntil: 'networkidle0', timeout: 120000 });
    const clickText = async (selector, label) => {
      await page.waitForFunction((sel, text) => [...document.querySelectorAll(sel)]
        .some(node => node.innerText.trim() === text && node.getClientRects().length), {}, selector, label);
      const handle = await page.evaluateHandle((sel, text) => [...document.querySelectorAll(sel)]
        .find(node => node.innerText.trim() === text && node.getClientRects().length), selector, label);
      const element = handle.asElement();
      await element.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      return element;
    };
    const rec = dry ? null : await createWorkflowGuideRecorder(page, {
      workflowId, guideId: 'import', title: workflow.title, sourceFiles: workflow.sourceFiles,
      fixtureOnly: true, encodingPreset: 'veryfast',
    });
    async function step(number, scenario, title, selector, action) {
      rec?.chapter(scenario, `${number}. ${title}`);
      await rec?.caption(`${number}. ${title}`);
      await rec?.pause(3800);
      await page.$eval(selector, node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await rec?.focus(selector, number);
      await rec?.pause(2100);
      await action();
      await rec?.pause(4200);
      await rec?.unfocus();
    }
    const tile = await clickText('button', '중국hubfresh');
    await tile.evaluate(node => node.dataset.hubfreshGuideTile = 'true');
    await step(1, 'select', '패킹리스트에서 중국hubfresh 선택', '[data-hubfresh-guide-tile]', () => tile.click());
    const inputSelector = 'input[aria-label="HUBFRESH 상세 인보이스"]';
    await page.waitForSelector(inputSelector);
    await step(2, 'split', '상세 인보이스를 올리고 업체별 카톤 수량 확인', inputSelector, async () => {
      await (await page.$(inputSelector)).uploadFile(filename);
      await page.waitForFunction(() => document.body.innerText.includes('네노바 2박스 · 다른 업체 1박스'));
    });
    const week = 'input[placeholder="48-01"]';
    await step(3, 'match', '자동으로 연결된 전산 품목과 입고 차수 확인', week, async () => {
      await page.waitForFunction(() => document.body.innerText.includes('ERP 품목 확인 필요 0건'));
      assert.equal(await page.$eval(week, node => node.value), '48-01');
      if (crossYear) {
        const year = '[aria-label="중국hubfresh"] input[placeholder="2026"]';
        await page.focus(year);
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await page.type(year, '2025');
      }
      const next = await clickText('button', 'HUBFRESH 입고 업로드 열기');
      await next.evaluate(node => node.dataset.hubfreshGuideNext = 'true');
      await next.click();
      await page.waitForFunction(() => document.body.innerText.includes('상품 수량을 확인하고 입고 저장'));
    });
    const validate = await clickText('button', '수량 검증');
    await validate.evaluate(node => node.dataset.hubfreshGuideValidate = 'true');
    await step(4, 'receipt', '입고 화면에서 네노바 수량 검증', '[data-hubfresh-guide-validate]', async () => {
      await validate.click();
      await page.waitForFunction(() => document.body.innerText.includes('수량 검증 완료'));
    });
    assert.equal(unexpectedWrite, false);
    assert.equal(preview.orderYear, crossYear ? '2025' : '2026');
    assert.equal(preview.orderWeek, '48-01');
    assert.deepEqual(preview.items.map(item => [item.orderCode, item.boxQty, item.totalPrice]), [['YCL1', 2, 30]]);
    if (rec) {
      const result = await rec.stop();
      const latest = JSON.parse(fs.readFileSync(registryPath));
      const guide = latest.workflows.find(item => item.id === workflowId).guides[0];
      guide.status = 'ready';
      guide.chapters = result.chapters;
      fs.writeFileSync(registryPath, JSON.stringify(latest, null, 2) + '\n');
    }
    console.log('HUBFRESH browser test passed. ERP writes: 0.');
  } finally {
    await browser?.close();
    server.kill();
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

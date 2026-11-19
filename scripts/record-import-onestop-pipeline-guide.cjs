// Actual built Next.js /import/pipeline UI with loopback synthetic fixtures. Zero MSSQL or production writes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer-core');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');

const dry = process.argv.includes('--dry-run');
const devMode = process.argv.includes('--dev');
const playerSmoke = process.argv.includes('--player-smoke');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const appPort = await freePort();
  const proxyPort = await freePort();
  const secret = crypto.randomBytes(32).toString('hex');
  const user = {
    userId: 'fixture-import',
    userName: '연습 담당자',
    authority: 2,
    deptName: '수입부',
    accountActive: true,
  };
  const token = jwt.sign(user, secret, { expiresIn: '2h' });
  const counts = { gets: 0, blockedWrites: 0 };

  const drafts = [
    {
      documentId: '11111111-1111-4111-8111-111111111111',
      orderYear: '2026',
      orderWeek: '46-01',
      revision: 1,
      farmKey: 10,
      invoiceNo: 'DEMO-CO-4601',
      invoiceYear: '2026',
      originalFileName: '46-01_Demo_Colombia.pdf',
      receiptStatus: 'COMMITTED',
      costStatus: 'APPROVED',
      updatedBy: 'fixture-import',
      updatedAt: '2026-11-18T08:40:00.000Z',
      lineCount: 2,
    },
  ];
  const warehouses = [
    {
      WarehouseKey: 99001,
      OrderYear: '2026',
      OrderWeek: '46-01',
      FarmName: 'Demo Farm CO',
      InvoiceNo: 'DEMO-CO-4601',
      GrossWeight: 180,
      ChargeableWeight: 210,
      InputDate: '2026-11-11',
    },
  ];
  const board = {
    cards: [
      { country: '콜롬비아', ordered: 120, received: 120, shipped: 100, missing: 0, fill: 100, shipRate: 83 },
      { country: '네덜란드', ordered: 60, received: 60, shipped: 60, missing: 0, fill: 100, shipRate: 100 },
    ],
    items: [
      { prodKey: 9001, name: '데모 수국 화이트', country: '콜롬비아', ordered: 120, received: 120, shipped: 100, tag: '일치' },
      { prodKey: 9002, name: '데모 튤립 믹스', country: '네덜란드', ordered: 60, received: 60, shipped: 60, tag: '일치' },
    ],
    totals: { ordered: 180, received: 180, shipped: 160, missing: 0, short: 0, over: 0, unordered: 0 },
  };
  const invoiceCosts = [
    {
      warehouseKey: 99001,
      documentId: '11111111-1111-4111-8111-111111111111',
      orderYear: '2026',
      orderWeek: '46-01',
      invoiceNo: 'DEMO-CO-4601',
      status: 'APPROVED',
      currentActual: {
        costRevisionId: '33333333-3333-4333-8333-333333333333',
        formulaId: 'CO_AIR_WEIGHT_V1',
        currency: 'USD',
        totalCostKRW: 3250000,
        approvedBy: '연습 담당자',
        approvedAt: '2026-11-18T09:05:00.000Z',
        status: 'APPROVED',
        revisionNo: 1,
        lines: [
          {
            wdetailKey: 99011,
            prodKey: 9001,
            productName: '데모 수국 화이트',
            unit: '송이',
            quantity: 120,
            costPerUnitKRW: 8500,
            totalCostKRW: 1020000,
          },
        ],
      },
      latestStale: null,
    },
  ];
  const arrivalRows = [
    {
      arrivalLineKey: 99101,
      orderYear: '2026',
      orderWeek: '46-01',
      countryName: '콜롬비아',
      displayName: '데모 수국 화이트',
      farmName: 'Demo Farm CO',
      unit: '송이',
      quantity: 120,
      selectedArrivalCostKRW: 8500,
      sourceArrivalCostKRW: 8500,
      uploadStatus: 'UPLOADED',
      matchStatus: 'MATCHED',
    },
    {
      arrivalLineKey: 99102,
      orderYear: '2026',
      orderWeek: '46-01',
      countryName: '네덜란드',
      displayName: '데모 튤립 믹스',
      farmName: 'Demo Farm NL',
      unit: '단',
      quantity: 60,
      selectedArrivalCostKRW: 11200,
      sourceArrivalCostKRW: 11200,
      uploadStatus: 'UPLOADED',
      matchStatus: 'MATCHED',
    },
  ];
  const driveFiles = [
    {
      id: 'demo-drive-1',
      cycle: '46-1',
      year: 2026,
      stage: '원가·운임',
      filename: '46-1 콜롬비아 데모 도착원가.xlsx',
      uploaderName: '연습 담당자',
      uploadedAt: '2026-11-18T09:15:00.000Z',
      size: 24576,
      canDownload: false,
    },
    {
      id: 'demo-drive-2',
      cycle: '46-1',
      year: 2026,
      stage: '입고',
      filename: '46-1 콜롬비아 데모 패킹리스트.pdf',
      uploaderName: '연습 담당자',
      uploadedAt: '2026-11-18T08:50:00.000Z',
      size: 40960,
      canDownload: false,
    },
  ];

  const nextArgs = [require.resolve('next/dist/bin/next'), ...(devMode ? ['dev', '--webpack'] : ['start']), '-H', '127.0.0.1', '-p', String(appPort)];
  const appProc = spawn(process.execPath, nextArgs, {
    env: { ...process.env, DB_SERVER: '', DB_USER: '', DB_PASSWORD: '', JWT_SECRET: secret },
    stdio: 'ignore',
    windowsHide: true,
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${proxyPort}`);
    const send = (payload, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    };

    if (url.pathname === '/fixture-status') return send(counts);
    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') {
        counts.blockedWrites++;
        return send({ success: false, error: 'Fixture blocks writes' }, 409);
      }
      counts.gets++;
      if (url.pathname === '/api/auth/me') return send({ success: true, user });
      if (url.pathname === '/api/favorites') return send({ success: true, favorites: [] });
      if (url.pathname === '/api/incoming/insight') {
        const view = url.searchParams.get('view');
        if (view === 'weeks') {
          return send({
            success: true,
            weeks: [
              { year: '2026', week: '46-01', n: 3 },
              { year: '2026', week: '45-02', n: 5 },
            ],
          });
        }
        return send({ success: true, year: 2026, week: '46-01', ...board });
      }
      if (url.pathname === '/api/import/receipts/drafts') {
        return send({ success: true, documents: drafts });
      }
      if (url.pathname === '/api/import/receipts/warehouse-list') {
        return send({ success: true, scope: { orderYear: '2026', orderWeek: '46-01' }, rows: warehouses, hasMore: false });
      }
      if (url.pathname === '/api/arrival-cost/invoice-costs') {
        return send({ success: true, available: true, rows: invoiceCosts, hasMore: false, nextCursor: null });
      }
      if (url.pathname === '/api/arrival-cost') {
        return send({ success: true, rows: arrivalRows, imports: [], total: arrivalRows.length, page: 1, pageSize: 200, hasMore: false });
      }
      if (url.pathname === '/api/import/tools/upload-history') {
        return send({
          success: true,
          rows: [{ id: '22222222-2222-4222-8222-222222222222', country: 'CO', fileName: '46-01_Demo_Colombia.pdf', actor: '연습 담당자', at: '2026-11-18T08:30:00.000Z' }],
        });
      }
      if (url.pathname === '/api/import/tools/state') {
        return send({ success: true, value: null, revision: 0, history: [] });
      }
      if (url.pathname === '/api/import/tools/product-matches') {
        return send({ success: true, products: [], value: { version: 1, entries: [] }, revision: 1 });
      }
      if (url.pathname === '/api/work/drive') {
        return send({ success: true, me: user.userName, dept: user.deptName, isAdmin: false, stages: ['발주', '입고', '원가·운임'], files: driveFiles });
      }
      if (url.pathname === '/api/moyi/drive-admin') {
        return send({ success: false, error: '관리자 전용' }, 403);
      }
      return send({ success: true, items: [], rows: [], documents: [], history: [] });
    }

    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: appPort,
        path: req.url,
        method: req.method,
        agent: false, // 로더가 남긴 keep-alive 소켓을 5초 뒤 재사용하다 ECONNRESET 나는 것을 막는다(브라우저 기동이 느린 PC 대비)
        headers: {
          ...req.headers,
          host: `127.0.0.1:${appPort}`,
          cookie: `nenovaToken=${token}`,
          authorization: `Bearer ${token}`,
        },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(503);
      res.end('Starting isolated app');
    });
    req.pipe(upstream);
  });

  let browser;
  let rec;
  try {
    await new Promise((resolve) => server.listen(proxyPort, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${proxyPort}`;

    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`${base}/import/pipeline?year=2026&week=46-01&popup=1`);
        if (res.status === 200) break;
      } catch (_) {}
      if (i === 59) throw new Error('Timed out waiting for isolated Next server');
      await new Promise((r) => setTimeout(r, 1000));
    }

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      args: ['--no-sandbox'],
    });
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(base, ['clipboard-read', 'clipboard-write']);

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && url.hostname !== '127.0.0.1') return request.abort();
      return request.continue();
    });

    const guideAssets = [];
    page.on('response', (response) => {
      try {
        const u = new URL(response.url());
        if (u.pathname.startsWith('/guides/import-onestop-pipeline/')) {
          guideAssets.push({ path: u.pathname, status: response.status() });
        }
      } catch (_) {}
    });

    await page.goto(`${base}/import/pipeline?year=2026&week=46-01&popup=1`, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForSelector('[data-testid="import-onestop-pipeline"]', { timeout: 60000 });
    await page.waitForFunction(() => document.body.innerText.includes('DEMO-CO-4601'), { timeout: 30000 });

    if (playerSmoke) {
      await page.evaluate(() => {
        const details = [...document.querySelectorAll('details')]
          .find((node) => node.querySelector('h3')?.textContent.includes('수입 원스톱 파이프라인'));
        if (!details) throw new Error('WorkflowGuide for import-onestop-pipeline not found');
        details.id = 'pipeline-guide-target';
      });
      const summary = await page.$('#pipeline-guide-target > summary');
      assert.ok(summary, 'WorkflowGuide summary missing');
      await summary.focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('#pipeline-guide-target video');
      assert.equal(await page.$eval('#pipeline-guide-target video', (v) => v.paused), true);

      const roleBtn = await page.evaluateHandle(
        () => [...document.querySelectorAll('#pipeline-guide-target button')].find((b) => b.textContent === '수입부용'),
      );
      assert.ok(roleBtn.asElement(), '수입부용 button missing');
      await roleBtn.asElement().focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => document.querySelector('#pipeline-guide-target video')?.getAttribute('aria-label')?.startsWith('수입부'));

      await page.$eval('#pipeline-guide-target video', (v) => { v.muted = true; return v.play(); });
      await page.waitForFunction(() => document.querySelector('#pipeline-guide-target video')?.currentTime > 0.3, { timeout: 15000 });
      await page.$eval('#pipeline-guide-target video', (v) => {
        v.pause();
        if (v.textTracks?.[0]) v.textTracks[0].mode = 'showing';
      });

      const chapters = await page.$$('#pipeline-guide-target nav[aria-label="수입부 영상 목차"] button');
      assert.equal(chapters.length, 4);
      for (let i = 0; i < chapters.length; i++) {
        const text = await chapters[i].evaluate((n) => n.textContent);
        assert.ok(text.includes(`${i + 1}. `), `Chapter ${i + 1} must carry business step number`);
      }

      await chapters[1].focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => {
        const v = document.querySelector('#pipeline-guide-target video');
        return Boolean(v && !v.seeking && v.readyState >= 2 && v.currentTime > 5);
      }, { timeout: 15000 });
      assert.equal(await page.$eval('#pipeline-guide-target video', (v) => v.paused && document.activeElement === v), true);
      await page.waitForFunction(() => document.querySelector('#pipeline-guide-target video track')?.readyState === 2, { timeout: 15000 });
      assert.equal(await page.$eval('#pipeline-guide-target video', (v) => v.textTracks.length === 1 && v.textTracks[0].language === 'ko' && v.textTracks[0].cues.length > 0), true);
      await page.$eval('#pipeline-guide-target video', (v) => { if (v.textTracks?.[0]) v.textTracks[0].mode = 'disabled'; });

      assert.ok(await page.$('#pipeline-guide-target a[download][href="/guides/import-onestop-pipeline/import.mp4"]'));
      assert.ok(await page.$('#pipeline-guide-target a[download][href="/guides/import-onestop-pipeline/import.ko.vtt"]'));
      assert.equal(await page.$eval('#pipeline-guide-target video', (v) => { const r = v.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), true);

      await page.$eval('#pipeline-guide-target video', (v) => v.play());
      await summary.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#pipeline-guide-target video')?.paused === true);

      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      await summary.focus();
      await page.keyboard.press('Enter');
      await page.$eval('#pipeline-guide-target video', (v) => v.scrollIntoView({ block: 'center' }));
      assert.equal(await page.$eval('#pipeline-guide-target video', (v) => { const r = v.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), true);

      assert.equal(counts.blockedWrites, 0);
      assert.deepEqual(errors, []);
      assert.ok(guideAssets.some((a) => a.path.endsWith('.mp4')));
      assert.ok(guideAssets.some((a) => a.path.endsWith('.ko.vtt')));
      assert.ok(guideAssets.every((a) => [200, 206, 304].includes(a.status)));
      console.log(JSON.stringify({ passed: true, playerSmoke: true, guideAssets, ...counts }));
      return;
    }

    if (!dry) {
      await page.addStyleTag({ content: 'body { padding-bottom: 240px !important; }' });
      const registry = JSON.parse(fs.readFileSync('config/workflow-guides.json', 'utf8'));
      const wf = registry.workflows.find((w) => w.id === 'import-onestop-pipeline');
      assert.ok(wf, 'import-onestop-pipeline workflow entry must exist in config/workflow-guides.json');
      rec = await createWorkflowGuideRecorder(page, {
        workflowId: wf.id,
        guideId: 'import',
        title: wf.title,
        sourceFiles: wf.sourceFiles,
        fixtureOnly: true,
      });
    }

    const stepFocus = async (scenario, text, selector, num) => {
      await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      if (rec) {
        rec.chapter(scenario, `${num}. ${text}`);
        await rec.caption(`${num}. ${text}`);
        await rec.pause(1500);
        await rec.focus(selector, num);
        await rec.pause(1200);
      }
    };

    const showResult = async (text) => {
      if (rec) {
        await rec.unfocus();
        await rec.caption(text);
        await rec.pause(2000);
      }
    };

    if (dry) {
      fs.mkdirSync('.verify', { recursive: true });
      await page.screenshot({ path: '.verify/import-onestop-pipeline-step1-1920.png', fullPage: false });
    }

    // Step 1: Select Country CO (콜롬비아) in shared context bar
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[aria-label="공통 차수 및 국가 선택"] button')]
        .find((b) => b.textContent.trim() === '콜롬비아');
      if (btn) btn.setAttribute('data-guide-country-co', 'true');
    });
    await stepFocus('context', '상단 공통 바에서 연도·세부차수와 국가(콜롬비아)를 선택해 조회 기준을 맞춥니다.', '[data-guide-country-co="true"]', 1);
    await page.click('[data-guide-country-co="true"]');
    await page.waitForFunction(() => window.location.search.includes('country=CO'));
    if (rec) await rec.pause(1000);
    await showResult('1. 콜롬비아 필터가 적용되어 전 단계 요약과 저장 인보이스 초안이 2026년 46-01차 기준으로 조회됩니다.');

    // Step 2: Switch to Step 2 (입고 업로드·검수)
    await stepFocus('incoming', '2단계 입고 업로드·검수 탭으로 이동해 발주·입고·분배 대조와 전산 입고 목록을 확인합니다.', '#pipeline-tab-2', 2);
    await page.click('#pipeline-tab-2');
    await page.waitForFunction(() => !document.getElementById('pipeline-panel-2')?.hidden);
    if (rec) await rec.pause(1200);
    await showResult('2. 2단계 화면에서 전산 입고 #99001(Demo Farm CO)과 발주 120·입고 120·분배 100 대조 결과를 확인했습니다.');
    if (dry) {
      await page.screenshot({ path: '.verify/import-onestop-pipeline-step2-1920.png', fullPage: false });
    }

    // Step 3: Switch to Step 3 (도착원가 산출·확정)
    await stepFocus('cost', '3단계 도착원가 산출·확정 탭에서 승인된 실제 원가와 품목별 도착원가 반영 상태를 점검합니다.', '#pipeline-tab-3', 3);
    await page.click('#pipeline-tab-3');
    await page.waitForFunction(() => !document.getElementById('pipeline-panel-3')?.hidden);
    if (rec) await rec.pause(1200);
    await showResult('3. 3단계에서 승인 원가 3,250,000원과 콜롬비아 데모 수국 8,500원 도착원가 반영을 확인했습니다.');
    if (dry) {
      await page.screenshot({ path: '.verify/import-onestop-pipeline-step3-1920.png', fullPage: false });
    }

    // Step 4: Switch to Step 4, enter memo note, and copy Kakao summary (no auto-send)
    await stepFocus('share', '4단계 카톡 복사·드라이브 탭을 열어 보고 요약문 생성과 드라이브 연결로 이동합니다.', '#pipeline-tab-4', 4);
    await page.click('#pipeline-tab-4');
    await page.waitForFunction(() => !document.getElementById('pipeline-panel-4')?.hidden);
    if (rec) {
      await rec.unfocus();
      await rec.caption('4. 특이사항 메모를 입력하면 아래 카톡 보고 요약문에 즉시 반영됩니다.');
      await rec.pause(1400);
      await page.$eval('input[aria-label="특이사항 메모"]', (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await rec.focus('input[aria-label="특이사항 메모"]', 4);
    }
    await page.focus('input[aria-label="특이사항 메모"]');
    await page.keyboard.type('검수·도착원가 확인 완료', { delay: dry ? 0 : 75 });
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="카톡 공유용 수입 요약문"]')?.value.includes('검수·도착원가 확인 완료'));
    if (rec) {
      await rec.pause(1000);
      await rec.unfocus();
      await rec.caption('4. [요약문 복사] 버튼을 누르면 클립보드로 복사되며 자동 발송은 실행되지 않습니다.');
      await rec.pause(1400);
      await page.$eval('[data-testid="pipeline-copy-summary"]', (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await rec.focus('[data-testid="pipeline-copy-summary"]', 4);
    }
    await page.click('[data-testid="pipeline-copy-summary"]');
    await page.waitForFunction(() => document.body.innerText.includes('복사됨'));
    if (rec) await rec.pause(1000);
    await showResult('4. 요약문이 클립보드에 복사되었습니다. 담당자가 직접 카톡에 붙여넣고 업무 드라이브로 이어집니다.');

    // Keyboard Arrow navigation check on stepper
    await page.focus('#pipeline-tab-4');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'pipeline-tab-1');

    if (rec) {
      const result = await rec.stop();
      const registryPath = 'config/workflow-guides.json';
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      const entry = registry.workflows.find((w) => w.id === 'import-onestop-pipeline');
      Object.assign(entry.guides[0], { status: 'ready', chapters: result.chapters });
      fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    }

    if (dry) {
      fs.mkdirSync('.verify', { recursive: true });
      await page.screenshot({ path: '.verify/import-onestop-pipeline-1920.png', fullPage: false });
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      assert.equal(overflow, false, 'Mobile viewport should not horizontally overflow');
      await page.screenshot({ path: '.verify/import-onestop-pipeline-390.png', fullPage: true });
    }

    assert.equal(counts.blockedWrites, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, dry, ...counts }));
  } finally {
    await browser?.close();
    appProc.kill();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

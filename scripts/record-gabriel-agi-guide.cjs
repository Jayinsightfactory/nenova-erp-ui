// Actual built Next.js /import/gabriel-agi UI with loopback synthetic fixtures. Zero MSSQL or production writes.
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
    userId: 'fixture-gabriel',
    userName: '연습 담당자',
    authority: 2,
    deptName: '수입부',
    accountActive: true,
  };
  const token = jwt.sign(user, secret, { expiresIn: '2h' });
  const counts = { gets: 0, blockedWrites: 0 };

  const fixtureArrivalRows = [
    {
      arrivalLineKey: 91001,
      prodKey: 4101,
      displayName: '콜롬비아 카네이션 스탠다드 레드 65cm',
      countryName: '콜롬비아',
      farmName: 'Flores Gambur SAS',
      unit: '송이',
      quantity: 7560,
      fobUSD: 0.215,
      freightPerUnitUSD: 0.175,
      customsPerUnitKRW: 58,
      otherPerUnitKRW: 34,
      selectedArrivalCostKRW: 632,
      exchangeRate: 1385,
      grossWeight: 308,
    },
    {
      arrivalLineKey: 91002,
      prodKey: 4102,
      displayName: '콜롬비아 수국 화이트 점보',
      countryName: '콜롬비아',
      farmName: 'Turflor',
      unit: '송이',
      quantity: 1296,
      fobUSD: 1.48,
      freightPerUnitUSD: 0.72,
      customsPerUnitKRW: 290,
      otherPerUnitKRW: 165,
      selectedArrivalCostKRW: 3502,
      exchangeRate: 1385,
      grossWeight: 198,
    },
    {
      arrivalLineKey: 91003,
      prodKey: 4201,
      displayName: '네덜란드 튤립 망고 참 40cm',
      countryName: '네덜란드',
      farmName: 'Holex Flower BV',
      unit: '단',
      quantity: 840,
      fobUSD: 3.45,
      freightPerUnitUSD: 1.52,
      customsPerUnitKRW: 840,
      otherPerUnitKRW: 380,
      selectedArrivalCostKRW: 8518,
      exchangeRate: 1505,
      grossWeight: 315,
    },
  ];

  const fixtureAwbs = [
    { awb: '176-84920112', box: 44, gw: 442, cw: 468, rate: 4.65, farms: [{ farm: 'Flores Gambur SAS', box: 24 }, { farm: 'Turflor', box: 20 }] },
    { awb: '074-51209834', box: 30, gw: 282, cw: 285, rate: 4.15, farms: [{ farm: 'Holex Flower BV', box: 30 }] },
  ];

  const fixtureLista = [
    { key: 501, farm: 'Flores Gambur SAS', variedad: 'carnation red', cantidad: 620, unidad: 'tallos', observacion: '연습 클레임 미회수', confirmed: true, credited: false },
    { key: 502, farm: 'Holex Flower BV', variedad: 'tulip mango', cantidad: 45, unidad: 'ramos', observacion: '연습 온도 편차', confirmed: false, credited: false },
  ];

  const nextArgs = [require.resolve('next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(appPort)];
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

    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') {
        counts.blockedWrites++;
        return send({ success: false, error: 'Fixture blocks writes' }, 409);
      }
      counts.gets++;
      if (url.pathname === '/api/auth/me') return send({ success: true, user });
      if (url.pathname === '/api/favorites') return send({ success: true, favorites: [] });
      if (url.pathname === '/api/finance/exchange') {
        return send({
          success: true,
          currencies: [
            { currencyCode: 'USD', currencyName: '미국 달러', exchangeRate: 1385, isActive: true },
            { currencyCode: 'EUR', currencyName: '유로', exchangeRate: 1505, isActive: true },
            { currencyCode: 'CNY', currencyName: '중국 위안', exchangeRate: 194, isActive: true },
          ],
        });
      }
      if (url.pathname === '/api/incoming/insight') {
        const view = url.searchParams.get('view');
        if (view === 'weeks') {
          return send({ success: true, weeks: [{ year: '2026', week: '46-01', n: 5 }, { year: '2026', week: '45-02', n: 4 }] });
        }
        if (view === 'awbcalc') return send({ success: true, awbs: fixtureAwbs });
        if (view === 'lista') return send({ success: true, rows: fixtureLista });
        return send({
          success: true,
          cards: [],
          items: [
            { prodKey: 4101, name: '콜롬비아 카네이션 스탠다드 레드 65cm', ordered: 7560, received: 7560, shipped: 7560, farms: [{ farm: 'Flores Gambur SAS', box: 28, qty: 7560 }] },
            { prodKey: 4102, name: '콜롬비아 수국 화이트 점보', ordered: 1296, received: 1296, shipped: 1296, farms: [{ farm: 'Turflor', box: 36, qty: 1296 }] },
          ],
          totals: { ordered: 8856, received: 8856, shipped: 8856, missing: 0, short: 0, over: 0, unordered: 0 },
        });
      }
      if (url.pathname === '/api/arrival-cost') {
        return send({ success: true, rows: fixtureArrivalRows, total: fixtureArrivalRows.length, page: 1, pageSize: 200 });
      }
      return send({ success: true, items: [], rows: [], documents: [], history: [] });
    }

    const upstream = http.request(
      {
        hostname: '127.0.0.1',
        port: appPort,
        path: req.url,
        method: req.method,
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
        const res = await fetch(`${base}/import/gabriel-agi?year=2026&week=46-01&popup=1`);
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
    await page.bringToFront();
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
        if (u.pathname.startsWith('/guides/gabriel-import-profit-agi/')) {
          guideAssets.push({ path: u.pathname, status: response.status() });
        }
      } catch (_) {}
    });

    await page.goto(`${base}/import/gabriel-agi?year=2026&week=46-01&popup=1`, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForSelector('[data-testid="gabriel-profit-agi-workbench"]', { timeout: 60000 });
    await page.waitForSelector('[data-testid="gabriel-lever-story-diagram"]', { timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes('콜롬비아 카네이션 스탠다드 레드'), { timeout: 30000 });

    if (playerSmoke) {
      await page.evaluate(() => {
        const details = [...document.querySelectorAll('details')]
          .find((node) => node.querySelector('h3')?.textContent.includes('가브리엘 수입·원가·이익 최적화'));
        if (!details) throw new Error('WorkflowGuide for gabriel-import-profit-agi not found');
        details.id = 'gabriel-guide-target';
      });
      const summary = await page.$('#gabriel-guide-target > summary');
      assert.ok(summary, 'WorkflowGuide summary missing');
      await summary.focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('#gabriel-guide-target video');
      assert.equal(await page.$eval('#gabriel-guide-target video', (v) => v.paused), true);

      await page.$eval('#gabriel-guide-target video', (v) => { v.muted = true; return v.play(); });
      await page.waitForFunction(() => document.querySelector('#gabriel-guide-target video')?.currentTime > 0.3, { timeout: 15000 });
      await page.$eval('#gabriel-guide-target video', (v) => {
        v.pause();
        if (v.textTracks?.[0]) v.textTracks[0].mode = 'showing';
      });

      const chapters = await page.$$('#gabriel-guide-target nav[aria-label="수입부 영상 목차"] button');
      assert.equal(chapters.length, 4);
      await chapters[1].focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => {
        const v = document.querySelector('#gabriel-guide-target video');
        return Boolean(v && !v.seeking && v.readyState >= 2 && v.currentTime > 5);
      }, { timeout: 15000 });
      await page.waitForFunction(() => document.querySelector('#gabriel-guide-target video track')?.readyState === 2, { timeout: 15000 });
      assert.equal(await page.$eval('#gabriel-guide-target video', (v) => v.textTracks.length === 1 && v.textTracks[0].language === 'ko' && v.textTracks[0].cues.length > 0), true);
      assert.ok(await page.$('#gabriel-guide-target a[download][href="/guides/gabriel-import-profit-agi/import.mp4"]'));
      assert.ok(await page.$('#gabriel-guide-target a[download][href="/guides/gabriel-import-profit-agi/import.ko.vtt"]'));
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
      const wf = registry.workflows.find((w) => w.id === 'gabriel-import-profit-agi');
      assert.ok(wf, 'gabriel-import-profit-agi entry missing in config/workflow-guides.json');
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
        await rec.pause(1300);
        await rec.focus(selector, num);
        await rec.pause(1000);
      }
    };

    const showResult = async (text) => {
      if (rec) {
        await rec.unfocus();
        await rec.caption(text);
        await rec.pause(1600);
      }
    };

    // Step 1: Country CO filter & KPI + 10-lever lineage check
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[aria-label="수입 국가 필터"] button')].find((b) => b.textContent.trim() === '콜롬비아');
      if (btn) btn.setAttribute('data-guide-co', 'true');
    });
    await stepFocus('scope', '상단 공통 바에서 연도·세부차수와 국가(콜롬비아)를 선택해 10대 레버 분석 범위를 맞춥니다.', '[data-guide-co="true"]', 1);
    await page.click('[data-guide-co="true"]');
    await page.waitForFunction(() => window.location.search.includes('country=CO'));
    if (rec) await rec.pause(700);
    await showResult('1. 콜롬비아 기준 전사 10대 이익 레버(L1~L10)와 부서별 업무·데이터 출처 표가 즉시 산출됩니다.');

    // Reset back to ALL and test Department filter + Story Lever L6 selection
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[aria-label="수입 국가 필터"] button')].find((b) => b.textContent.trim() === '전체 국가');
      btn?.click();
    });
    await page.waitForFunction(() => !window.location.search.includes('country=CO'));

    await page.click('[data-testid="story-lever-chip-L6"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="gabriel-lever-situation"]')?.textContent.includes('L6'));
    if (dry) {
      await page.click('[data-testid="dept-filter-경영지원·정산부"]');
      await page.waitForFunction(() => Boolean(document.querySelector('[data-testid="story-lever-chip-L4"]')) && !document.querySelector('[data-testid="story-lever-chip-L1"]'));
      await page.click('[data-testid="dept-filter-ALL"]');
      await page.waitForSelector('[data-testid="story-lever-chip-L1"]');
      await page.$eval('[data-testid="gabriel-lever-story-diagram"]', (el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      fs.mkdirSync('.verify', { recursive: true });
      await page.screenshot({ path: '.verify/gabriel-agi-story-1920.png', fullPage: false });
    }

    // Step 2: Counterfactual stress preset & simulation toggle
    await stepFocus('simulate', '반사실 시뮬레이션 컨트롤에서 환율 +60원 스트레스 프리셋을 적용해 방어 효과를 계산합니다.', '[data-testid="gabriel-preset-fx-stress"]', 2);
    await page.click('[data-testid="gabriel-preset-fx-stress"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="readout-fx"]')?.textContent.includes('+60원'));
    if (rec) await rec.pause(800);
    await showResult('2. 환율 +60원 상승 시나리오에서도 리밸런싱·채움률·판가방어·송금분할로 총이익률이 방어됩니다.');

    // Step 3: Switch View B, View C, and View ALL (A·B·C simultaneous + Continuous Build Queue)
    await stepFocus('views', '시안 B(2×2)·시안 C(카본 콘솔)·뷰 ALL(A·B·C 동시모드 & 연속구현 큐)로 전환해 검수합니다.', '[data-testid="gabriel-view-ALL"]', 3);
    await page.click('[data-testid="gabriel-view-B"]');
    await page.waitForFunction(() => document.body.innerText.includes('원가 리스크 × 차수 물량 비중'));
    if (rec) await rec.pause(800);
    if (dry) await page.screenshot({ path: '.verify/gabriel-agi-view-B-1920.png', fullPage: false });
    if (rec) await rec.unfocus();

    await page.click('[data-testid="gabriel-view-C"]');
    await page.waitForSelector('[data-testid="gabriel-carbon-console"]');
    if (rec) await rec.pause(800);
    if (dry) await page.screenshot({ path: '.verify/gabriel-agi-view-C-1920.png', fullPage: false });

    await page.click('[data-testid="gabriel-view-ALL"]');
    await page.waitForSelector('[data-testid="gabriel-all-mode"]');
    await page.waitForSelector('[data-testid="gabriel-continuous-build-queue"]');
    assert.ok(await page.$('[data-testid="gabriel-all-panel-A"]'));
    assert.ok(await page.$('[data-testid="gabriel-all-panel-B"]'));
    assert.ok(await page.$('[data-testid="gabriel-all-panel-C"]'));
    if (dry) {
      fs.mkdirSync('.verify', { recursive: true });
      await page.$eval('[data-testid="gabriel-all-mode"]', (el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.screenshot({ path: '.verify/gabriel-agi-view-ALL-1920.png', fullPage: false });
      await page.$eval('[data-testid="gabriel-continuous-build-queue"]', (el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.click('[data-testid="copy-build-brief-mod-l1-awb-coload-solver"]');
      await page.waitForSelector('[data-testid="gabriel-build-copy-notice"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="gabriel-build-copy-notice"]')?.textContent.includes('구현 작업지시서'));
      await page.screenshot({ path: '.verify/gabriel-agi-build-queue-1920.png', fullPage: false });
    }

    if (rec) {
      await rec.caption('3. 뷰 ALL 동시모드에서 A·B·C 3종과 연속구현 파이프라인(L1~L10)이 실시간 동시 작동합니다.');
      await rec.pause(1800);
    }

    // Switch back to View A
    await page.click('[data-testid="gabriel-view-A"]');
    await page.waitForFunction(() => document.body.innerText.includes('10대 이익 레버 분해'));

    // Step 4: Copy executive briefing
    await stepFocus('briefing', '사장님 보고용 원가·이익 브리핑 복사 버튼을 눌러 10대 레버 요약 보고서를 복사합니다.', '[data-testid="gabriel-copy-briefing"]', 4);
    await page.click('[data-testid="gabriel-copy-briefing"]');
    await page.waitForSelector('[data-testid="gabriel-copy-notice"]');
    if (rec) await rec.pause(800);
    await showResult('4. 브리핑이 클립보드에 복사되었습니다. 실제 원장은 변경되지 않으며 각 부서 실행 화면으로 이어집니다.');

    // Keyboard navigation verification on View tabs
    await page.focus('#gabriel-view-tab-ALL');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'gabriel-view-tab-A');

    if (rec) {
      const result = await rec.stop();
      const registryPath = 'config/workflow-guides.json';
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      const entry = registry.workflows.find((w) => w.id === 'gabriel-import-profit-agi');
      Object.assign(entry.guides[0], { status: 'ready', chapters: result.chapters });
      fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    }

    if (dry) {
      fs.mkdirSync('.verify', { recursive: true });
      await page.screenshot({ path: '.verify/gabriel-agi-1920.png', fullPage: false });
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
      assert.equal(overflow, false, 'Mobile 390px viewport must not horizontally overflow');
      await page.screenshot({ path: '.verify/gabriel-agi-390.png', fullPage: true });
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

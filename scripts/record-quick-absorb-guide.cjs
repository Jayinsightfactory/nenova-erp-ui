// Real Chromium UI E2E + workflow guide recorder for /shipment/quick-absorb.
// Uses isolated Next dev server (DB_SERVER='') + synthetic fixture APIs only (0 DB writes).
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer-core');
const { createWorkflowGuideRecorder, cameraFilters } = require('./lib/workflow-guide-recorder.cjs');

const dry = process.argv.includes('--dry-run');

async function getFreePort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

async function main() {
  const root = process.cwd();
  const registryPath = path.join(root, 'config/workflow-guides.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const workflow = registry.workflows.find((w) => w.id === 'shipment-quick-absorb');
  assert(workflow, 'shipment-quick-absorb workflow entry required');

  fs.mkdirSync(path.join(root, '.verify'), { recursive: true });
  const port = await getFreePort();
  const base = `http://localhost:${port}`;
  const secret = crypto.randomUUID();
  const logFd = fs.openSync(path.join(root, '.verify/quick-absorb-guide-server.log'), 'w');

  const server = spawn(
    process.execPath,
    [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '-p', String(port)],
    {
      cwd: root,
      env: { ...process.env, DB_SERVER: '', JWT_SECRET: secret, PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED: '1' },
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    },
  );
  fs.closeSync(logFd);

  let browser;
  let page;
  let rec;
  let stopped = false;
  const pageErrors = [];
  const apiPosts = [];
  const queryScopes = [];

  // Synthetic ledger state keyed cleanly by OrderYear|OrderWeek|CustKey|ProdKey
  const prod3513 = {
    ProdKey: 3513,
    ProdName: '연습 카네이션 Honey',
    DisplayName: '연습 카네이션 Honey',
    CounName: '콜롬비아',
    FlowerName: '카네이션',
    CountryFlower: '콜롬비아카네이션',
    OutUnit: '박스',
    EstUnit: '단',
    BunchOf1Box: 10,
    SteamOf1Box: 200,
    SteamOf1Bunch: 20,
    inQty: 8,
    outQty: 2,
    orderQty: 3,
    prevStock: 1,
    Cost: 11500,
  };
  const prod4201 = {
    ProdKey: 4201,
    ProdName: '연습 장미 레드',
    DisplayName: '연습 장미 레드',
    CounName: '네덜란드',
    FlowerName: '장미',
    CountryFlower: '네덜란드장미',
    OutUnit: '단',
    EstUnit: '단',
    BunchOf1Box: 10,
    SteamOf1Box: 200,
    SteamOf1Bunch: 20,
    inQty: 20,
    outQty: 0,
    orderQty: 0,
    prevStock: 0,
    Cost: 8000,
  };
  const customersMaster = [
    { CustKey: 777, CustName: '기존주문 화원', OrderCode: 'C777', CustArea: '서울', Manager: '영업1' },
    { CustKey: 778, CustName: '미등록 테스트화원', OrderCode: 'T778', CustArea: '경기', Manager: '영업1' },
    { CustKey: 779, CustName: '신규 거래화원', OrderCode: 'N779', CustArea: '부산', Manager: '영업2' },
  ];

  // Key: `${year}|${week}|${custKey}|${prodKey}`
  const ledgerOrders = new Map([
    ['2026|45-01|777|3513', { 주문수량: 3 }],
    ['2025|45-01|778|3513', { 주문수량: 5 }], // 타 연도(2025) 동일 차수 — 2026 미등록 판별 시 배제 검증용
  ]);
  const ledgerShipments = new Map([
    ['2026|45-01|777|3513', { sdetailKey: 501, outQty: 2, cost: 11500 }],
    ['2025|45-01|778|3513', { sdetailKey: 401, outQty: 5, cost: 11000 }],
  ]);

  try {
    for (let n = 0; n < 120; n += 1) {
      try {
        if ((await fetch(`${base}/login`)).status === 200) break;
      } catch {}
      if (n === 119) throw new Error('Quick-absorb guide Next dev server startup failed');
      await new Promise((r) => setTimeout(r, 1000));
    }

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      args: ['--no-sandbox'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    page.setDefaultTimeout(45000);
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const user = { userId: 'guide-support', userName: '영업지원 연습', authority: 2, deptName: '영업지원', accountActive: true };
    await page.setCookie({ name: 'nenovaToken', value: jwt.sign(user, secret, { expiresIn: '1h' }), url: base });

    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      try {
        const url = new URL(request.url());
        if (url.origin !== base) return request.abort();
        if (!url.pathname.startsWith('/api/')) return request.continue();

        let data = { success: true, user, data: [], items: [], rows: [], groups: [], products: [], customers: [] };
        let status = 200;

        if (url.pathname === '/api/auth/me') {
          data = { success: true, user };
        } else if (url.pathname === '/api/master/customers') {
          data = { success: true, data: customersMaster };
        } else if (url.pathname === '/api/shipment/distribute') {
          if (request.method() === 'GET') {
            const type = url.searchParams.get('type');
            const yr = url.searchParams.get('year') || '';
            const wk = url.searchParams.get('week') || '';
            const pk = Number(url.searchParams.get('prodKey') || 0);
            if (type === 'groups') {
              data.groups = [
                { key: '콜롬비아::카네이션', country: '콜롬비아', flower: '카네이션', label: '콜롬비아카네이션' },
                { key: '네덜란드::장미', country: '네덜란드', flower: '장미', label: '네덜란드장미' },
              ];
            } else if (type === 'productCatalog') {
              data.products = [prod3513, prod4201];
            } else if (type === 'products') {
              queryScopes.push({ type, yr, wk });
              const outSum3513 = [...ledgerShipments.entries()]
                .filter(([k]) => k.startsWith(`${yr}|${wk}|`) && k.endsWith('|3513'))
                .reduce((s, [, v]) => s + v.outQty, 0);
              const orderSum3513 = [...ledgerOrders.entries()]
                .filter(([k]) => k.startsWith(`${yr}|${wk}|`) && k.endsWith('|3513'))
                .reduce((s, [, v]) => s + v.주문수량, 0);
              data.products = [{ ...prod3513, outQty: outSum3513, orderQty: orderSum3513 }];
            } else if (type === 'custDist') {
              queryScopes.push({ type, yr, wk, pk });
              const rows = [];
              for (const c of customersMaster) {
                const k = `${yr}|${wk}|${c.CustKey}|${pk}`;
                const ord = ledgerOrders.get(k);
                if (!ord) continue;
                const ship = ledgerShipments.get(k);
                rows.push({
                  CustKey: c.CustKey,
                  CustName: c.CustName,
                  주문코드: c.OrderCode,
                  ProdKey: pk,
                  단위: pk === 4201 ? '단' : '박스',
                  OutUnit: pk === 4201 ? '단' : '박스',
                  주문수량: ord.주문수량,
                  출고수량: ship ? ship.outQty : 0,
                  SdetailKey: ship ? ship.sdetailKey : null,
                  Cost: ship ? ship.cost : (pk === 4201 ? 8000 : 11500),
                  단가: ship ? ship.cost : (pk === 4201 ? 8000 : 11500),
                });
              }
              data.customers = rows;
            } else if (type === 'fixedScopes') {
              const pks = String(url.searchParams.get('prodKeys') || '').split(',').map(Number).filter(Boolean);
              data.scopes = pks.map((id) => ({
                prodKey: id,
                fixed: false,
                countryFlower: id === 4201 ? '네덜란드장미' : '콜롬비아카네이션',
              }));
            }
          } else if (request.method() === 'POST') {
            const body = JSON.parse(request.postData() || '{}');
            apiPosts.push({ path: '/api/shipment/distribute', body });
            const yr = String(body.year || '');
            const wk = String(body.week || '');
            for (const entry of body.entries || []) {
              const k = `${yr}|${wk}|${entry.custKey}|${entry.prodKey}`;
              assert(ledgerOrders.has(k), `POST /api/shipment/distribute requires prior active order for ${k}`);
              const prevShip = ledgerShipments.get(k) || { sdetailKey: 901, outQty: 0, cost: entry.cost };
              assert(Math.abs(prevShip.outQty - Number(entry.expected?.outQty || 0)) < 1e-8, 'expected.outQty parity');
              ledgerShipments.set(k, {
                sdetailKey: prevShip.sdetailKey,
                outQty: Number(entry.outQty || 0),
                cost: Number(entry.cost ?? prevShip.cost),
              });
            }
            data = {
              success: true,
              verified: true,
              savedCount: (body.entries || []).length,
              results: (body.entries || []).map((e) => ({
                custKey: e.custKey,
                prodKey: e.prodKey,
                outQty: e.outQty,
                action: 'update',
                verification: { verified: true },
              })),
            };
          }
        } else if (url.pathname === '/api/shipment/adjust') {
          const yr = url.searchParams.get('year') || '';
          const wk = url.searchParams.get('week') || '';
          const ck = Number(url.searchParams.get('custKey') || 0);
          const pk = Number(url.searchParams.get('prodKey') || 0);
          const ship = ledgerShipments.get(`${yr}|${wk}|${ck}|${pk}`);
          data = {
            success: true,
            items: ship
              ? [{ prodKey: pk, sdetailKey: ship.sdetailKey, curOut: ship.outQty, curCost: ship.cost }]
              : [],
          };
        } else if (url.pathname === '/api/orders' && request.method() === 'POST') {
          const body = JSON.parse(request.postData() || '{}');
          apiPosts.push({ path: '/api/orders', body });
          assert.equal(body.source, 'manual-order');
          const yr = String(body.year || '');
          const wk = String(body.week || '');
          const ck = Number(body.custKey);
          for (const item of body.items || []) {
            const k = `${yr}|${wk}|${ck}|${item.prodKey}`;
            const prev = ledgerOrders.get(k)?.주문수량 || 0;
            ledgerOrders.set(k, { 주문수량: prev + Number(item.qty || 0) });
          }
          data = {
            success: true,
            verified: true,
            verifiedCount: (body.items || []).length,
            orderMasterKey: 8801,
            shipmentMasterKey: 7701,
            results: (body.items || []).map((i) => ({ prodKey: i.prodKey, status: 'OK', finalQty: i.qty })),
          };
        }

        await request.respond({ status, contentType: 'application/json', body: JSON.stringify(data) });
      } catch (err) {
        pageErrors.push(err.message);
        if (!request.isInterceptResolutionHandled()) await request.abort().catch(() => {});
      }
    });

    await page.goto(`${base}/shipment/quick-absorb?week=2026-45-01&popup=1`, { waitUntil: 'networkidle0', timeout: 120000 });
    await page.waitForSelector('[data-testid="quick-absorb-workspace"]');
    await page.waitForSelector('[data-testid="absorb-product-3513"]');
    assert.deepEqual(pageErrors, [], `Initial hydration errors: ${JSON.stringify(pageErrors)}`);

    rec = dry
      ? {
          chapter() {},
          focus: async (selector, number) => {
            const box = await page.$eval(selector, (n) => {
              const r = n.getBoundingClientRect();
              return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
            });
            if (box.x < 0 || box.x > 1920 || box.y < 70 || box.y > 900) {
              throw new Error(`CAMERA BOUNDS FAIL step ${number} ${selector} ${JSON.stringify(box)}`);
            }
          },
          unfocus: async () => {},
          caption: async () => {},
          pause: async () => {},
          stop: async () => ({ chapters: [] }),
        }
      : await createWorkflowGuideRecorder(page, {
          root,
          workflowId: workflow.id,
          guideId: 'support',
          title: workflow.title,
          sourceFiles: workflow.sourceFiles,
          fixtureOnly: true,
          ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
          ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
        });

    const hold = async (text, ms = 4200) => {
      await rec.caption(text);
      if (!dry) await rec.pause(ms);
    };
    const focusAndCenter = async (selector, number) => {
      await page.$eval(selector, (n) => n.scrollIntoView({ block: 'center', inline: 'center' }));
      if (!dry) await rec.pause(800);
      await rec.focus(selector, number);
    };

    // 1. 차수·품목 선택
    rec.chapter('scope', '1. 차수·품목 선택');
    await hold('1. 상단에서 대상 연도·차수를 확인하고 분배할 품목을 검색해 선택합니다.\n타 연도 동일 차수 데이터와 혼동하지 않도록 연도를 명확히 표시합니다.', 4200);
    await focusAndCenter('[data-testid="absorb-week-controls"]', 1);
    await rec.unfocus();
    await focusAndCenter('[data-testid="absorb-product-search"]', 1);
    await page.click('[data-testid="absorb-product-search"]');
    await page.type('[data-testid="absorb-product-search"]', 'Honey');
    await page.waitForSelector('[data-testid="absorb-product-3513"]');
    await page.click('[data-testid="absorb-product-3513"]');
    await rec.unfocus();
    await hold('1. 연습 카네이션 Honey 품목을 선택했습니다.\n오른쪽 업체 목록에서 이 품목의 주문·분배 현황을 즉시 확인합니다.', 3200);

    // 2. 미등록 업체 감지
    rec.chapter('detect', '2. 미등록 업체 감지');
    await hold('2. 주문등록 화면으로 이동할 필요 없이, 이 화면에서 미등록 업체를 바로 찾습니다.', 3500);
    await focusAndCenter('[data-testid="absorb-customer-filter-unregistered"]', 2);
    await page.click('[data-testid="absorb-customer-filter-unregistered"]');
    await rec.unfocus();
    await focusAndCenter('[data-testid="absorb-customer-778"]', 2);
    await page.click('[data-testid="absorb-customer-778"]');
    await page.waitForSelector('[data-testid="absorb-detection-banner"]');
    await rec.unfocus();
    const bannerText = await page.$eval('[data-testid="absorb-detection-banner"]', (el) => el.textContent);
    assert(bannerText.includes('주문 미등록 업체 감지'), `Expected unregistered detection banner, got: ${bannerText}`);
    assert(bannerText.includes('2026 / 45-01'), 'Banner must show exact business key 2026 / 45-01');
    await hold('2. 2025년 동일 차수 주문이 있어도 2026년 45-01 기준 미등록 업체로 정확히 감지합니다.', 3800);

    // 3. 환산 확인 및 선행 주문 승인
    rec.chapter('absorb', '3. 환산 확인 및 선행 주문 승인');
    await hold('3. 분배 수량과 단위를 입력하면 OutUnit 단일 기준과 3단위 환산 결과를 실시간으로 검토합니다.', 3500);
    await focusAndCenter('[data-testid="absorb-unit-select"]', 3);
    await page.select('[data-testid="absorb-unit-select"]', '단');
    await rec.unfocus();
    await focusAndCenter('[data-testid="absorb-qty-input"]', 3);
    await page.click('[data-testid="absorb-qty-input"]');
    await page.type('[data-testid="absorb-qty-input"]', '15');
    await page.waitForSelector('[data-testid="absorb-plan-preview"]');
    await rec.unfocus();
    const previewText = await page.$eval('[data-testid="absorb-plan-preview"]', (el) => el.textContent);
    assert(previewText.includes('1.5 박스'), `Expected 1.5 박스 OutQuantity preview, got: ${previewText}`);
    assert(previewText.includes('1.5박스 / 15단 / 300송이'), 'Preview must display 3-unit conversion');

    assert.equal(await page.$eval('[data-testid="absorb-submit-btn"]', (el) => el.disabled), true, 'Submit must stay disabled before confirm checkbox');
    await focusAndCenter('[data-testid="absorb-confirm-checkbox"]', 3);
    await page.click('[data-testid="absorb-confirm-checkbox"]');
    assert.equal(await page.$eval('[data-testid="absorb-submit-btn"]', (el) => el.disabled), false);
    await rec.unfocus();

    await focusAndCenter('[data-testid="absorb-submit-btn"]', 3);
    await page.click('[data-testid="absorb-submit-btn"]');
    await page.waitForSelector('[data-testid="absorb-result-banner"]');
    await rec.unfocus();

    // 4. 분배 반영 결과 확인
    rec.chapter('result', '4. 분배 반영 결과 확인');
    const resultText = await page.$eval('[data-testid="absorb-result-banner"]', (el) => el.textContent);
    assert(resultText.includes('반영 및 검증 완료'), `Expected verified banner, got: ${resultText}`);
    assert(resultText.includes('OrderMasterKey #8801'), 'Expected OrderMasterKey readback');
    const updatedBanner = await page.$eval('[data-testid="absorb-detection-banner"]', (el) => el.textContent);
    assert(updatedBanner.includes('기존 활성 주문 있음'), 'State must refresh to active order after commit');
    assert.equal(await page.$eval('[data-testid="absorb-qty-input"]', (el) => el.value), '15', 'Post-save keeps entered qty in user unit');
    assert.equal(await page.$eval('[data-testid="absorb-unit-select"]', (el) => el.value), '단', 'Post-save preserves selected input unit');
    assert.deepEqual(
      apiPosts.map((p) => p.path),
      ['/api/orders', '/api/shipment/distribute'],
      'Sequential order -> distribute execution required',
    );
    await hold('4. 1단계 선행 주문등록과 2단계 출고분배가 순서대로 검증 완료되었습니다.\n같은 업체에 추가 수정 시에는 기존 주문을 보존하고 출고분배만 반영합니다.', 4200);

    // Clear search and test existing active order preservation silently before finalizing dry test
    if (dry) {
      await page.click('[data-testid="absorb-customer-filter-registered"]');
      await page.waitForSelector('[data-testid="absorb-customer-777"]');
      await page.click('[data-testid="absorb-customer-777"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="absorb-detection-banner"]')?.textContent.includes('기존 활성 주문 있음'));
      assert.equal(await page.$eval('[data-testid="absorb-unit-select"]', (el) => el.value), '박스', 'Switching customer resets unit to product OutUnit');
      assert.equal(await page.$$eval('[data-testid="absorb-confirm-checkbox"]', (els) => els.length), 0, 'Existing order requires no precede order confirm gate');
      await page.click('[data-testid="absorb-qty-input"]');
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.type('[data-testid="absorb-qty-input"]', '3');
      await page.click('[data-testid="absorb-submit-btn"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="absorb-result-banner"]')?.textContent.includes('3박스 [기존 주문 보존 + 출고분배]'));
      assert.equal(apiPosts.filter((p) => p.path === '/api/orders').length, 1, 'Existing active order must NOT call /api/orders');
      assert.equal(apiPosts.filter((p) => p.path === '/api/shipment/distribute').length, 2);
    }

    assert.deepEqual(pageErrors, [], `Runtime page errors: ${JSON.stringify(pageErrors)}`);
    await page.screenshot({ path: path.join(root, '.verify/quick-absorb-guide-final.png') });
    const result = await rec.stop();
    stopped = true;

    if (!dry) {
      const proof = JSON.parse(fs.readFileSync(result.proofFile, 'utf8'));
      cameraFilters(proof.presentation?.focusShots || []);
      workflow.guides[0].status = 'ready';
      workflow.guides[0].chapters = result.chapters;
      fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    }

    console.log(JSON.stringify({
      result: 'PASS',
      dry,
      productionWrites: 0,
      apiPosts: apiPosts.map((p) => p.path),
      duration: result.duration,
      chapters: result.chapters,
    }));
  } finally {
    if (rec && !stopped) {
      await page?.screenshot({ path: path.join(root, '.verify/quick-absorb-guide-failure.png') }).catch(() => {});
      await rec.stop().catch(() => {});
    }
    await browser?.close().catch(() => {});
    server.kill();
  }
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exitCode = 1;
});

// scripts/verify-classic-ui-tabs.mjs
// 전 탭 실브라우저 종합 검증: 3대 뷰포트(1920x1080, 1366x768, 960x1000) × 15개 핵심 탭
// + MDI 탭 열기/전환/닫기, 리본 접기/펼치기(--nv-avail-h 실측), 컬럼폭 드래그+복원, 스플리터 드래그/접기/펼치기, 즐겨찾기 편집 모달
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const puppeteer = require('puppeteer-core');

const CORE_ROUTES = [
  '/incoming',
  '/master/customers',
  '/master/products',
  '/orders',
  '/orders/new',
  '/shipment/distribute',
  '/shipment/week-pivot',
  '/stats/pivot',
  '/estimate',
  '/arrival-cost',
  '/orders/paste',
  '/sales/status',
  '/stock',
  '/purchase/status',
  '/pm',
];

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '960x1000', width: 960, height: 1000 },
];

async function findFreePort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

function buildSyntheticApiResponse(url, method, bodyJson, favStore) {
  const p = url.pathname;
  if (p === '/api/auth/me') {
    return {
      status: 200,
      body: { success: true, user: { userId: 'nenovaSS3', userName: '검증관리자', authority: 1, accountActive: true } },
    };
  }
  if (p === '/api/favorites') {
    const pageParam = url.searchParams.get('page') || bodyJson?.page || '';
    if (method === 'GET') {
      const list = pageParam === 'dashboard-menu' ? favStore.items : [];
      return { status: 200, body: { success: true, favorites: list } };
    }
    if (method === 'POST') {
      const nextKey = favStore.seq++;
      const row = {
        FavoriteKey: nextKey,
        FavName: bodyJson.name || '즐겨찾기',
        FilterData: bodyJson.filterData || '{}',
        SortOrder: favStore.items.length + 1,
      };
      favStore.items.push(row);
      return { status: 200, body: { success: true, favoriteKey: nextKey, number: row.SortOrder } };
    }
    if (method === 'PUT') {
      const target = favStore.items.find((r) => r.FavoriteKey === Number(bodyJson.favoriteKey));
      if (target) {
        target.FavName = bodyJson.name || target.FavName;
        target.FilterData = bodyJson.filterData || target.FilterData;
      }
      return { status: 200, body: { success: true, favoriteKey: Number(bodyJson.favoriteKey) } };
    }
    if (method === 'DELETE') {
      favStore.items = favStore.items.filter((r) => r.FavoriteKey !== Number(bodyJson.favoriteKey));
      return { status: 200, body: { success: true } };
    }
  }
  if (p === '/api/orders') {
    return {
      status: 200,
      body: {
        success: true,
        rows: [
          {
            OrderMasterKey: 1, OrderYear: '2026', OrderWeek: '48-01', OrderDate: '2026-11-27',
            CustKey: 101, CustName: '테스트거래처A', CustArea: '서울', Manager: '박담당', OrderCode: 'C101',
            ProdKey: 201, ProdName: 'ROSE / 테스트장미 50cm', CounName: '콜롬비아', FlowerName: '장미',
            Unit: '단', BoxQuantity: 2, BunchQuantity: 20, SteamQuantity: 200,
          },
          {
            OrderMasterKey: 2, OrderYear: '2026', OrderWeek: '48-01', OrderDate: '2026-11-27',
            CustKey: 102, CustName: '테스트거래처B', CustArea: '경기', Manager: '김담당', OrderCode: 'C102',
            ProdKey: 202, ProdName: 'CARNATION / 테스트카네이션', CounName: '중국', FlowerName: '카네이션',
            Unit: '단', BoxQuantity: 1, BunchQuantity: 10, SteamQuantity: 100,
          },
        ],
      },
    };
  }
  if (p === '/api/master/customers') {
    return {
      status: 200,
      body: {
        success: true,
        data: [
          { CustKey: 101, CustName: '테스트거래처A', CustArea: '서울', Manager: '박담당', OrderCode: 'C101', Group1: '도매', ProductType: '장미', BaseOutDay: 1, Descr: '메모' },
          { CustKey: 102, CustName: '테스트거래처B', CustArea: '경기', Manager: '김담당', OrderCode: 'C102', Group1: '소매', ProductType: '카네이션', BaseOutDay: 2, Descr: '' },
        ],
      },
    };
  }
  if (p === '/api/master') {
    const entity = url.searchParams.get('entity');
    if (entity === 'codes') return { status: 200, body: { success: true, countries: [{ CounName: '콜롬비아' }], flowers: [{ FlowerName: '장미' }] } };
    return {
      status: 200,
      body: {
        success: true,
        data: [
          { ProdKey: 201, ProdCode: 'P201', ProdName: 'ROSE / 테스트장미 50cm', DisplayName: '장미 테스트', FlowerName: '장미', CounName: '콜롬비아', Cost: 5000, OutUnit: '단', EstUnit: '단', BunchOf1Box: 10, SteamOf1Bunch: 10, Stock: 25 },
        ],
      },
    };
  }
  if (p === '/api/estimate') {
    return {
      status: 200,
      body: {
        success: true,
        shipments: [
          { ShipmentKey: 501, CustKey: 101, CustName: '테스트거래처A', OrderYear: '2026', OrderWeek: '48-01', Manager: '박담당', TotalAmount: 100000, DetailCount: 1, DetailFix: 0 },
        ],
        items: [
          { EstimateKey: 901, SdetailKey: 801, ProdKey: 201, ProdName: 'ROSE / 테스트장미', Unit: '단', ShipmentDtm: '2026-11-27', Quantity: 10, Cost: 5000, Amount: 50000, Vat: 5000, Descr: '' },
        ],
      },
    };
  }
  if (p === '/api/stock') {
    return {
      status: 200,
      body: {
        success: true,
        stock: [
          { ProdKey: 201, CounName: '콜롬비아', FlowerName: '장미', ProdName: 'ROSE / 테스트장미', OutUnit: '단', PrevStock: 10, InQty: 20, OutQty: 5, AdjQty: 0, Stock: 25 },
        ],
      },
    };
  }
  if (p === '/api/pm/office') {
    return {
      status: 200,
      body: {
        success: true,
        updatedAt: new Date().toISOString(),
        staff: [],
        agents: [],
        tasks: [],
        logs: [],
        playbooks: [],
      },
    };
  }
  return {
    status: 200,
    body: {
      success: true,
      ok: true,
      rows: [],
      data: [],
      orders: [],
      items: [],
      weeks: [{ OrderYear: '2026', OrderWeek: '48-01', OrderYearWeek: '20264801' }],
      availableWeeks: ['48-01'],
      varieties: [],
      masters: [],
      customers: [],
      products: [],
      shipments: [],
      stock: [],
    },
  };
}

async function run() {
  const port = await findFreePort();
  const secret = crypto.randomUUID();
  const base = `http://127.0.0.1:${port}`;
  const nextBin = require.resolve('next/dist/bin/next');
  fs.mkdirSync('.verify', { recursive: true });
  const serverLogFd = fs.openSync('.verify/classic-ui-verify-server.log', 'w');

  const server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_SERVER: '',
      JWT_SECRET: secret,
      PROFIT_REPORT_WEEKLY_SCHEDULER_DISABLED: '1',
    },
    stdio: ['ignore', serverLogFd, serverLogFd],
    windowsHide: true,
  });
  fs.closeSync(serverLogFd);

  let browser;
  try {
    for (let i = 0; i < 60; i += 1) {
      try {
        const res = await fetch(`${base}/login`);
        if (res.status === 200) break;
      } catch {}
      if (i === 59) throw new Error('Next.js production server failed to start');
      await new Promise((r) => setTimeout(r, 1000));
    }

    const executablePath = [
      process.env.CHROME_PATH,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ].find((p) => p && fs.existsSync(p));
    assert.ok(executablePath, 'Chrome/Edge executable must exist');

    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const favStore = { seq: 1, items: [] };
    await page.setCookie({
      name: 'nenovaToken',
      value: jwt.sign({ userId: 'nenovaSS3', userName: '검증관리자', authority: 1, accountActive: true }, secret, { expiresIn: '20m' }),
      url: base,
    });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = new URL(req.url());
      if (url.origin !== base) return req.abort();
      if (!url.pathname.startsWith('/api/')) return req.continue();
      let bodyJson = {};
      try {
        if (req.postData()) bodyJson = JSON.parse(req.postData());
      } catch {}
      const res = buildSyntheticApiResponse(url, req.method(), bodyJson, favStore);
      return req.respond({
        status: res.status,
        contentType: 'application/json',
        body: JSON.stringify(res.body),
      });
    });

    // 1) 15개 핵심 탭 × 3개 뷰포트 전수 스캔
    const matrixResults = [];
    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
      for (const route of CORE_ROUTES) {
        const beforeErrCount = pageErrors.length;
        await page.goto(`${base}${route}`, { waitUntil: 'networkidle0', timeout: 60000 });
        await page.waitForSelector('[data-ui-page-content]', { timeout: 20000 });
        await new Promise((r) => setTimeout(r, 120));

        const metrics = await page.evaluate(() => {
          const docW = document.documentElement.scrollWidth;
          const winW = window.innerWidth;
          const winH = window.innerHeight;
          const shell = document.querySelector('[data-ui-shell="standard"]');
          const pageArea = document.querySelector('.page-area');
          const contentRect = (pageArea || document.body).getBoundingClientRect();
          const availVar = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nv-avail-h') || '0', 10);
          return {
            docW,
            winW,
            winH,
            hasStandardShell: Boolean(shell),
            contentHeight: Math.round(contentRect.height),
            availVar,
            bodyScrollOverflow: shell ? (document.documentElement.scrollHeight - winH) : 0,
            topbarCount: document.querySelectorAll('[data-ui-topbar]').length,
            sidebarCount: document.querySelectorAll('[data-ui-sidebar]').length,
            titleCount: document.querySelectorAll('[data-ui-page-title]').length,
          };
        });

        assert.equal(pageErrors.length, beforeErrCount, `${route} (${vp.name}) threw JS error: ${pageErrors.slice(beforeErrCount).join('; ')}`);
        assert.ok(metrics.docW <= metrics.winW + 2, `${route} (${vp.name}) horizontal overflow: docW=${metrics.docW} > winW=${metrics.winW}`);
        assert.ok(metrics.contentHeight >= 200, `${route} (${vp.name}) collapsed height: ${metrics.contentHeight}`);
        assert.ok(metrics.availVar >= 200, `${route} (${vp.name}) --nv-avail-h missing/too small: ${metrics.availVar}`);
        if (metrics.hasStandardShell) {
          assert.equal(metrics.topbarCount, 1, `${route} topbarCount`);
          assert.equal(metrics.sidebarCount, 1, `${route} sidebarCount`);
          assert.equal(metrics.titleCount, 1, `${route} titleCount`);
          assert.ok(metrics.bodyScrollOverflow <= 4, `${route} (${vp.name}) outer double scroll overflow=${metrics.bodyScrollOverflow}`);
        }
        matrixResults.push({ viewport: vp.name, route, docW: metrics.docW, winW: metrics.winW, availVar: metrics.availVar, contentHeight: metrics.contentHeight });
      }
    }

    // 2) MDI 탭 열기 / 전환 / × 닫기 검증
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-ui-ribbon]');

    // 리본에서 주문관리, 거래처관리 열기
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[data-ui-ribbon] button')];
      btns.find((b) => b.textContent.includes('주문관리'))?.click();
    });
    await page.waitForFunction(() => window.location.pathname === '/orders');
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[data-ui-ribbon] button')];
      btns.find((b) => b.textContent.includes('거래처관리'))?.click();
    });
    await page.waitForFunction(() => window.location.pathname === '/master/customers');

    const tabsBeforeClose = await page.$$eval('[data-mdi-tab-href]', (els) => els.map((e) => e.getAttribute('data-mdi-tab-href')));
    assert.ok(tabsBeforeClose.includes('/orders') && tabsBeforeClose.includes('/master/customers'), `MDI tabs missing: ${JSON.stringify(tabsBeforeClose)}`);

    // /orders 탭으로 전환
    await page.click('[data-mdi-tab-href="/orders"] .nv-mdi-tab-btn');
    await page.waitForFunction(() => window.location.pathname === '/orders');

    // /master/customers 탭 × 닫기
    await page.click('[data-mdi-tab-href="/master/customers"] .nv-mdi-tab-close');
    await page.waitForFunction(() => !document.querySelector('[data-mdi-tab-href="/master/customers"]'));

    // 3) 리본 ▲/▼ 접기/펼치기 시 --nv-avail-h 실제 증가 검증
    const availExpanded = await page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nv-avail-h'), 10));
    await page.click('[data-testid="ribbon-collapse-toggle"]');
    await page.waitForFunction(() => !document.querySelector('[data-ui-ribbon]'));
    await new Promise((r) => setTimeout(r, 120));
    const availCollapsed = await page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nv-avail-h'), 10));
    assert.ok(availCollapsed > availExpanded + 10, `Expected --nv-avail-h to increase when ribbon collapsed: expanded=${availExpanded}, collapsed=${availCollapsed}`);
    await page.click('[data-testid="ribbon-collapse-toggle"]');
    await page.waitForSelector('[data-ui-ribbon]');

    // 4) 테이블 컬럼 드래그 리사이즈 & 새로고침 후 복원 검증 (/orders)
    await page.waitForSelector('table.tbl thead th .nv-col-resizer');
    const colBefore = await page.evaluate(() => {
      const th = document.querySelector('table.tbl thead th');
      const resizer = th.querySelector('.nv-col-resizer');
      const r = resizer.getBoundingClientRect();
      return { width: Math.round(th.getBoundingClientRect().width), x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(colBefore.x, colBefore.y);
    await page.mouse.down();
    await page.mouse.move(colBefore.x + 80, colBefore.y, { steps: 8 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 120));
    const colAfterDragInfo = await page.evaluate(() => ({
      width: Math.round(document.querySelector('table.tbl thead th').getBoundingClientRect().width),
      keys: Object.keys(localStorage),
      ordersVal: localStorage.getItem('nv_col_widths_v1:/orders'),
    }));
    const colAfterDrag = colAfterDragInfo.width;
    assert.ok(colAfterDrag >= colBefore.width + 50, `Column drag resize failed: before=${colBefore.width}, after=${colAfterDrag}`);

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('table.tbl thead th .nv-col-resizer');
    await new Promise((r) => setTimeout(r, 150));
    const colReloadDebug = await page.evaluate(() => {
      const th = document.querySelector('table.tbl thead th');
      const tbl = document.querySelector('table.tbl');
      return {
        width: Math.round(th.getBoundingClientRect().width),
        thStyleW: th.style.width,
        tblStyleW: tbl.style.width,
        tblLayout: tbl.style.tableLayout,
        hasResizedAttr: tbl.dataset.nvHasResizedCols,
        storage: localStorage.getItem('nv_col_widths_v1:/orders'),
        keysAfter: Object.keys(localStorage),
      };
    });
    const colAfterReload = colReloadDebug.width;
    assert.ok(Math.abs(colAfterReload - colAfterDrag) <= 4, `Column width did not persist across reload: drag=${colAfterDrag}, reload=${colAfterReload}, beforeReload=${JSON.stringify(colAfterDragInfo)}, debug=${JSON.stringify(colReloadDebug)}`);

    // 열폭 초기화 동작 확인
    await page.click('[data-testid="nv-reset-col-widths"]');
    await new Promise((r) => setTimeout(r, 100));

    // 5) 스플리터 드래그 + 접기/펼치기 검증 (/estimate)
    await page.goto(`${base}/estimate`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.split-panel.estimate-split-panel');
    await page.waitForSelector('.nv-split-gutter');
    const splitBefore = await page.evaluate(() => {
      const left = document.querySelector('.split-panel.estimate-split-panel').children[0].getBoundingClientRect();
      const gutter = document.querySelector('.nv-split-gutter').getBoundingClientRect();
      return { leftW: Math.round(left.width), gx: gutter.left + gutter.width / 2, gy: gutter.top + 30 };
    });
    await page.mouse.move(splitBefore.gx, splitBefore.gy);
    await page.mouse.down();
    await page.mouse.move(splitBefore.gx + 90, splitBefore.gy, { steps: 8 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 120));
    const splitAfterDrag = await page.evaluate(() => Math.round(document.querySelector('.split-panel.estimate-split-panel').children[0].getBoundingClientRect().width));
    assert.ok(splitAfterDrag >= splitBefore.leftW + 40, `Split drag failed: before=${splitBefore.leftW}, after=${splitAfterDrag}`);

    // 스플리터 왼쪽 패널 접기/펼치기
    await page.click('[data-testid="split-collapse-left-0"]');
    await new Promise((r) => setTimeout(r, 100));
    const leftCollapsedW = await page.evaluate(() => Math.round(document.querySelector('.split-panel.estimate-split-panel').children[0].getBoundingClientRect().width));
    assert.equal(leftCollapsedW, 0, `Left split collapse failed: width=${leftCollapsedW}`);
    await page.click('[data-testid="split-collapse-left-0"]');
    await new Promise((r) => setTimeout(r, 100));
    const leftExpandedW = await page.evaluate(() => Math.round(document.querySelector('.split-panel.estimate-split-panel').children[0].getBoundingClientRect().width));
    assert.ok(leftExpandedW > 100, `Left split expand failed: width=${leftExpandedW}`);

    // 6) 개인 즐겨찾기 편집 모달: 추가 / 순서 변경 / 삭제 검증
    await page.click('[data-testid="ribbon-tab-favorites"]');
    await page.waitForSelector('[data-testid="ribbon-favorites-panel"]');
    await page.click('[data-testid="open-favorites-editor"]');
    await page.waitForSelector('[data-testid="favorites-editor-modal"]');
    const favCheckboxes = await page.$$('[data-testid="favorites-editor-modal"] input[type="checkbox"]');
    assert.ok(favCheckboxes.length >= 2);
    await favCheckboxes[0].click();
    await new Promise((r) => setTimeout(r, 120));
    await favCheckboxes[1].click();
    await new Promise((r) => setTimeout(r, 120));
    const orderRowsBefore = await page.$$eval('[data-testid="fav-order-row"]', (els) => els.map((e) => e.textContent));
    assert.equal(orderRowsBefore.length, 2, `Expected 2 favorites added, got ${orderRowsBefore.length}`);
    // 두 번째 항목 위로 이동
    const upBtns = await page.$$('[data-testid="fav-order-row"] button[aria-label*="위로 이동"]');
    await upBtns[1].click();
    await new Promise((r) => setTimeout(r, 150));
    const orderRowsAfter = await page.$$eval('[data-testid="fav-order-row"]', (els) => els.map((e) => e.textContent));
    assert.notEqual(orderRowsAfter[0].slice(3), orderRowsBefore[0].slice(3), 'Favorite reorder did not swap order');
    // 삭제(×) 버튼 동작 확인 후 닫기
    await page.click('[data-testid="fav-order-row"] button[aria-label*="삭제"]');
    await new Promise((r) => setTimeout(r, 150));
    const orderRowsAfterDel = await page.$$eval('[data-testid="fav-order-row"]', (els) => els.length);
    assert.equal(orderRowsAfterDel, 1, `Expected 1 favorite after delete, got ${orderRowsAfterDel}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="favorites-editor-modal"]'));
    const favTabText = await page.$eval('[data-testid="ribbon-tab-favorites"]', (el) => el.textContent);
    assert.ok(favTabText.includes('★ 즐겨찾기 (1)'), `Ribbon favorites tab did not reflect count: ${favTabText}`);
    await page.click('[data-testid="ribbon-tab-main"]');
    await page.waitForSelector('[data-testid="ribbon-main-body"]');

    // 7) 창 리사이즈 (1920 -> 960 -> 1366) 후 겹침·폭발 0건 검증
    for (const w of [1920, 960, 1366]) {
      await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
      await new Promise((r) => setTimeout(r, 120));
      const res = await page.evaluate(() => {
        const t = document.querySelector('[data-ui-topbar]').getBoundingClientRect();
        const r = document.querySelector('[data-ui-ribbon]')?.getBoundingClientRect();
        const p = document.querySelector('.page-area').getBoundingClientRect();
        return {
          docW: document.documentElement.scrollWidth,
          winW: window.innerWidth,
          topbarBottom: Math.round(t.bottom),
          ribbonBottom: r ? Math.round(r.bottom) : 0,
          pageTop: Math.round(p.top),
        };
      });
      assert.ok(res.docW <= res.winW + 2, `Dynamic resize ${w} overflow: ${res.docW} > ${res.winW}`);
      assert.ok(res.pageTop >= Math.max(res.topbarBottom, res.ribbonBottom) - 1, `Topbar/Ribbon overlaps page-area at ${w}: topbarBottom=${res.topbarBottom}, ribbonBottom=${res.ribbonBottom}, pageTop=${res.pageTop}`);
    }

    // 8) 즐겨찾기 50개 스트레스 테스트 + 픽셀 오와열/높이 실측 + 스크린샷 2장 저장
    const layoutSrc = fs.readFileSync(path.join(process.cwd(), 'components', 'Layout.js'), 'utf8');
    const menuBlock = layoutSrc.match(/export const MENU_ITEMS = \[([\s\S]*?)\n\];/)?.[1] || '';
    const candidateMenus = [];
    for (const m of menuBlock.matchAll(/\{\s*href:\s*'([^']+)'\s*,\s*labelKey:\s*'([^']+)'([^}]*)\}/g)) {
      if (m[3].includes('userIds')) continue;
      candidateMenus.push({ href: m[1], labelKey: m[2] });
      if (candidateMenus.length >= 50) break;
    }
    assert.equal(candidateMenus.length, 50, `Expected 50 candidate menu items, got ${candidateMenus.length}`);

    favStore.items = candidateMenus.map((item, idx) => ({
      FavoriteKey: 5000 + idx,
      FavName: item.labelKey,
      FilterData: JSON.stringify({ href: item.href, customOrder: idx + 1 }),
      SortOrder: idx + 1,
    }));

    await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
    await page.goto(`${base}/orders`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="ribbon-main-body"]');
    await page.waitForFunction(() => (document.querySelector('[data-testid="ribbon-tab-favorites"]')?.textContent || '').includes('50'));
    await new Promise((r) => setTimeout(r, 150));

    // 8-a) Main 모드 픽셀 실측 (1366x768)
    const mainMetrics = await page.evaluate(() => {
      const ribbon = document.querySelector('[data-ui-ribbon]');
      const body = document.querySelector('[data-testid="ribbon-main-body"]');
      const labels = [...document.querySelectorAll('[data-ribbon-group-label]')];
      const lgBtns = [...document.querySelectorAll('.nv-ribbon-btn-lg')];
      const smGrids = [...document.querySelectorAll('.nv-items-grid3x2')];
      const labelBottoms = labels.map((el) => Math.round(el.getBoundingClientRect().bottom));
      const lgHeights = lgBtns.map((el) => Math.round(el.getBoundingClientRect().height));
      const smHeights = [...document.querySelectorAll('.nv-ribbon-btn-sm')].map((el) => Math.round(el.getBoundingClientRect().height));
      const smColWidthSpreads = smGrids.map((grid) => {
        const byCol = new Map();
        for (const btn of grid.querySelectorAll('.nv-ribbon-btn-sm')) {
          const r = btn.getBoundingClientRect();
          const colKey = Math.round(r.left);
          if (!byCol.has(colKey)) byCol.set(colKey, []);
          byCol.get(colKey).push(Math.round(r.width));
        }
        let maxSpread = 0;
        for (const ws of byCol.values()) {
          maxSpread = Math.max(maxSpread, Math.max(...ws) - Math.min(...ws));
        }
        return maxSpread;
      });
      return {
        ribbonHeight: Math.round(ribbon.getBoundingClientRect().height),
        bodyHeight: Math.round(body.getBoundingClientRect().height),
        bodyScrollW: body.scrollWidth,
        bodyClientW: body.clientWidth,
        groupCount: labels.length,
        favLeakedInMain: document.querySelectorAll('[data-testid="ribbon-favorites-group"], [data-testid="ribbon-favorite-item"]').length,
        labelBottomDiff: Math.max(...labelBottoms) - Math.min(...labelBottoms),
        lgHeightDiff: Math.max(...lgHeights) - Math.min(...lgHeights),
        smHeightDiff: Math.max(...smHeights) - Math.min(...smHeights),
        smColWidthMaxSpread: Math.max(...smColWidthSpreads),
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
      };
    });

    assert.equal(mainMetrics.favLeakedInMain, 0, `Favorites leaked into Main ribbon: ${mainMetrics.favLeakedInMain}`);
    assert.ok(mainMetrics.ribbonHeight <= 92, `Main ribbon height exceeded 92px: ${mainMetrics.ribbonHeight}`);
    assert.equal(mainMetrics.groupCount, 6, `Expected 6 Main ribbon groups, got ${mainMetrics.groupCount}`);
    assert.ok(mainMetrics.labelBottomDiff <= 1, `Main group label bottom misaligned: diff=${mainMetrics.labelBottomDiff}px`);
    assert.ok(mainMetrics.lgHeightDiff <= 1, `Main large buttons height diff > 1px: ${mainMetrics.lgHeightDiff}px`);
    assert.ok(mainMetrics.smHeightDiff <= 1, `Main 3-row small buttons height diff > 1px: ${mainMetrics.smHeightDiff}px`);
    assert.ok(mainMetrics.smColWidthMaxSpread <= 1, `Main 3-row column width spread > 1px: ${mainMetrics.smColWidthMaxSpread}px`);
    assert.ok(mainMetrics.bodyScrollW <= mainMetrics.bodyClientW + 1, `Main ribbon overflowed horizontally at 1366px: scrollW=${mainMetrics.bodyScrollW} > clientW=${mainMetrics.bodyClientW}`);
    assert.ok(mainMetrics.docW <= mainMetrics.winW + 2, `Main 1366px doc overflow: ${mainMetrics.docW} > ${mainMetrics.winW}`);

    const shotDir = process.env.RIBBON_SHOT_DIR || 'C:/Users/USER/.gemini/antigravity/brain/66a7e66b-6a3e-40bf-a035-031bdd013c5e/scratch';
    fs.mkdirSync(shotDir, { recursive: true });
    const mainShotPath = path.join(shotDir, 'ribbon-main-fixed.png');
    await page.screenshot({ path: mainShotPath });

    // 8-b) 그룹 ▾ 드롭다운 및 [전체메뉴 ▾] 플로팅 오버레이가 리본 세로 높이를 1px도 늘리지 않는지 확인
    await page.click('[data-nv-more-btn]');
    await page.waitForSelector('[data-nv-ribbon-dropdown]');
    const ribbonHeightWithDrop = await page.$eval('[data-ui-ribbon]', (el) => Math.round(el.getBoundingClientRect().height));
    assert.ok(ribbonHeightWithDrop <= 92, `Group dropdown expanded Main ribbon height: ${ribbonHeightWithDrop}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-nv-ribbon-dropdown]'));

    await page.click('[data-testid="ribbon-tab-all"]');
    await page.waitForSelector('[data-testid="ribbon-all-menu-panel"]');
    const allMenuInfo = await page.evaluate(() => {
      const pop = document.querySelector('[data-testid="ribbon-all-menu-panel"]');
      const ribbon = document.querySelector('[data-ui-ribbon]');
      return {
        position: getComputedStyle(pop).position,
        popHeight: Math.round(pop.getBoundingClientRect().height),
        ribbonHeight: Math.round(ribbon.getBoundingClientRect().height),
      };
    });
    assert.equal(allMenuInfo.position, 'fixed', 'All-menu popover must be position: fixed');
    assert.ok(allMenuInfo.popHeight <= 445, `All-menu popover height exceeded 445px: ${allMenuInfo.popHeight}`);
    assert.ok(allMenuInfo.ribbonHeight <= 92, `All-menu popover expanded Main ribbon height: ${allMenuInfo.ribbonHeight}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="ribbon-all-menu-panel"]'));

    // 8-c) ★ 즐겨찾기 (50) 클릭 → 패널 열림 + 높이 <=185px + 50개 격자 오와열 실측 + 스크린샷
    await page.click('[data-testid="ribbon-tab-favorites"]');
    await page.waitForSelector('[data-testid="ribbon-favorites-panel"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="ribbon-main-body"]'));
    await new Promise((r) => setTimeout(r, 150));

    const favMetrics = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="ribbon-favorites-panel"]');
      const ribbon = document.querySelector('[data-ui-ribbon]');
      const items = [...document.querySelectorAll('[data-testid="ribbon-favorite-item"]')];
      const heights = items.map((el) => Math.round(el.getBoundingClientRect().height));
      const byCol = new Map();
      for (const el of items) {
        const r = el.getBoundingClientRect();
        const colKey = Math.round(r.left);
        if (!byCol.has(colKey)) byCol.set(colKey, []);
        byCol.get(colKey).push(Math.round(r.width));
      }
      let maxColWidthSpread = 0;
      for (const ws of byCol.values()) {
        maxColWidthSpread = Math.max(maxColWidthSpread, Math.max(...ws) - Math.min(...ws));
      }
      return {
        count: items.length,
        panelHeight: Math.round(panel.getBoundingClientRect().height),
        ribbonHeight: Math.round(ribbon.getBoundingClientRect().height),
        minItemH: Math.min(...heights),
        maxItemH: Math.max(...heights),
        maxColWidthSpread,
        colCount: byCol.size,
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
      };
    });

    assert.equal(favMetrics.count, 50, `Expected 50 favorite items rendered, got ${favMetrics.count}`);
    assert.ok(favMetrics.panelHeight <= 185, `Favorites panel height exceeded 185px: ${favMetrics.panelHeight}`);
    assert.ok(favMetrics.ribbonHeight <= 185, `Favorites ribbon wrapper height exceeded 185px: ${favMetrics.ribbonHeight}`);
    assert.ok(favMetrics.minItemH >= 25 && favMetrics.maxItemH <= 27 && (favMetrics.maxItemH - favMetrics.minItemH) <= 1, `Favorite item height mismatch: min=${favMetrics.minItemH}, max=${favMetrics.maxItemH}`);
    assert.ok(favMetrics.maxColWidthSpread <= 1, `Favorite column width spread > 1px: ${favMetrics.maxColWidthSpread}px`);
    assert.ok(favMetrics.docW <= favMetrics.winW + 2, `Favorites 1366px overflow: ${favMetrics.docW} > ${favMetrics.winW}`);

    const favShotPath = path.join(shotDir, 'ribbon-favorites-50-fixed.png');
    await page.screenshot({ path: favShotPath });

    // 3개 뷰포트 전부 50개 즐겨찾기 상태 가로 넘침 없음 확인
    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
      await new Promise((r) => setTimeout(r, 100));
      const vpRes = await page.evaluate(() => ({
        docW: document.documentElement.scrollWidth,
        winW: window.innerWidth,
        favH: Math.round(document.querySelector('[data-testid="ribbon-favorites-panel"]').getBoundingClientRect().height),
      }));
      assert.ok(vpRes.docW <= vpRes.winW + 2, `Favorites 50 overflow at ${vp.name}: ${vpRes.docW} > ${vpRes.winW}`);
      assert.ok(vpRes.favH <= 185, `Favorites 50 height > 185px at ${vp.name}: ${vpRes.favH}`);
    }

    // 8-d) ★ 즐겨찾기 재클릭 / 닫기 × / ESC / 항목 클릭 닫힘 확인
    await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
    await page.click('[data-testid="ribbon-tab-favorites"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="ribbon-favorites-panel"]'));

    await page.click('[data-testid="ribbon-tab-favorites"]');
    await page.waitForSelector('[data-testid="ribbon-favorites-panel"]');
    await page.click('[data-testid="favorites-panel-close"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="ribbon-favorites-panel"]'));

    await page.click('[data-testid="ribbon-tab-favorites"]');
    await page.waitForSelector('[data-testid="ribbon-favorites-panel"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="ribbon-favorites-panel"]'));

    await page.click('[data-testid="ribbon-tab-favorites"]');
    await page.waitForSelector('[data-testid="ribbon-favorites-panel"]');
    await page.click('[data-testid="ribbon-favorite-item"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="ribbon-favorites-panel"]'));

    assert.deepEqual(pageErrors, [], `Unhandled page errors: ${pageErrors.join(' | ')}`);

    console.log(JSON.stringify({
      result: 'PASS',
      testedRoutes: CORE_ROUTES.length,
      viewports: VIEWPORTS.map((v) => v.name),
      checksCount: matrixResults.length,
      ribbonCollapseAvailH: { expanded: availExpanded, collapsed: availCollapsed },
      columnDragWidth: { before: colBefore.width, afterDrag: colAfterDrag, afterReload: colAfterReload },
      splitDragWidth: { before: splitBefore.leftW, afterDrag: splitAfterDrag, collapsed: leftCollapsedW, expanded: leftExpandedW },
      mdiTabsVerified: true,
      favoritesModalVerified: true,
      mainRibbonMetrics: mainMetrics,
      favorites50Metrics: favMetrics,
      screenshots: { main: mainShotPath, favorites50: favShotPath },
      zeroPageErrors: true,
    }, null, 2));
  } finally {
    await browser?.close().catch(() => {});
    if (server?.pid) {
      try {
        process.kill(server.pid);
      } catch {}
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

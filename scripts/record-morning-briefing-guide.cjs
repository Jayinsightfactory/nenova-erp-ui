// Actual local /briefing UI with a synthetic admin session. Every API is intercepted with practice data and every
// non-local request is blocked, so no ERP connection or write can happen. `--dry-run` runs the same checks without recording.
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), jwt = require('jsonwebtoken'), puppeteer = require('puppeteer-core');
const { createWorkflowGuideRecorder } = require('./lib/workflow-guide-recorder.cjs');
const dry = process.argv.includes('--dry-run'), root = process.cwd();
const WORKFLOW = 'morning-briefing', GUIDE = 'overview';

const day = offset => new Date(Date.now() + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
const USER = { userId: 'nenovaSS3', userName: '연습 관리자', authority: 1, deptName: '경영지원', accountActive: true };
const FIXTURES = {
  '/api/auth/me': { success: true, user: USER },
  '/api/m/order-request': { success: true, isAdmin: true, requests: [
    { RequestKey: 9001, CustKey: 1, CustName: '연습꽃집 가', OrderWeek: '46-01', Status: 'pending', itemCount: 3, RequesterName: '연습 직원', CreatedAt: day(0) + 'T08:10:00', Memo: '' },
    { RequestKey: 9002, CustKey: 2, CustName: '연습꽃집 나', OrderWeek: '46-01', Status: 'pending', itemCount: 1, RequesterName: '연습 직원', CreatedAt: day(0) + 'T08:25:00', Memo: '' },
  ] },
  '/api/mgmt/approvals': { success: true, rows: [] },
  '/api/incoming/eta': { success: true, stages: ['발주', '선적', '통관중', '도착', '입고등록'], suggested: [], rows: [
    { id: 'eta-1', year: 2026, week: '46-01', farm: '연습농장 A', awb: '000-00000001', eta: day(-1), stage: '선적', late: true, matched: null },
    { id: 'eta-2', year: 2026, week: '46-01', farm: '연습농장 B', awb: '000-00000002', eta: day(0), stage: '통관중', late: false, matched: null },
    { id: 'eta-3', year: 2026, week: '46-02', farm: '연습농장 C', awb: '', eta: day(5), stage: '발주', late: false, matched: null },
  ] },
  '/api/stats/dashboard': { success: true, source: 'fixture', year: 2026, week: '46-01', kpi: { totalSales: 12500000, totalWithVat: 13750000, custCount: 18, totalQty: 420, orderCount: 37, lowStockCount: 0, unfixedCount: 4 }, salesByArea: [], topCustomers: [] },
  '/api/mgmt/ar-aging': { success: true, asOf: day(0), source: '연습 자료', totals: { total: 8200000, d0_30: 6000000, d31_60: 1400000, d61_90: 800000, d90p: 0, credit: 0, futureExcluded: 0, totalPaid: 0 }, rows: [] },
  '/api/mgmt/credit-limit': { success: true, balanceTotal: 8200000, history: [], rows: [
    { custKey: 1, signboard: '연습꽃집 가', custName: '연습꽃집 가', limitKRW: 5000000, balance: 1200000, pct: 24, status: 'ok' },
  ] },
};

async function main() {
  fs.mkdirSync(path.join(root, '.verify'), { recursive: true });
  const listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const secret = crypto.randomUUID(), base = 'http://127.0.0.1:' + port, log = fs.openSync('.verify/morning-briefing-guide-server.log', 'w');
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port)], { env: { ...process.env, DB_SERVER: '', JWT_SECRET: secret }, stdio: ['ignore', log, log], windowsHide: true });
  fs.closeSync(log); let browser;
  try {
    for (let i = 0; i < 90; i++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch {} if (i === 89) throw Error('UI server unavailable'); await new Promise(r => setTimeout(r, 1000)); }
    browser = await puppeteer.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const page = await browser.newPage(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setCookie({ name: 'nenovaToken', value: jwt.sign(USER, secret, { expiresIn: '1h' }), url: base });
    await page.evaluateOnNewDocument(user => { localStorage.setItem('nenovaUser', JSON.stringify(user)); }, USER);
    let external = 0, writes = 0; const calls = {};
    await page.setRequestInterception(true); page.on('request', req => {
      const u = new URL(req.url());
      if (['blob:', 'data:'].includes(u.protocol)) return req.continue();
      if (!['127.0.0.1', 'localhost'].includes(u.hostname)) { external++; return req.abort(); }
      if (!u.pathname.startsWith('/api/')) return req.continue();
      if (req.method() !== 'GET') writes++;
      calls[u.pathname] = (calls[u.pathname] || 0) + 1;
      const body = FIXTURES[u.pathname] || { success: true, items: [], rows: [], data: [], requests: [], favorites: [] };
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    // Start from another screen so step 1 shows where the menu is.
    await page.goto(base + '/work/operations', { waitUntil: 'networkidle0', timeout: 120000 });
    const menu = '[data-ui-sidebar] a[href="/briefing"]';
    await page.waitForSelector(menu);
    assert.equal(await page.$$eval(menu, nodes => nodes.length), 1, 'menu is registered exactly once');
    const center = selector => page.$eval(selector, node => node.scrollIntoView({ block: 'center' }));

    const rec = dry ? null : await createWorkflowGuideRecorder(page, { workflowId: WORKFLOW, guideId: GUIDE, title: '아침 브리핑 한 장 보기', sourceFiles: ['pages/briefing.js', 'lib/morningBriefing.js'], fixtureOnly: true });
    const say = async (text, ms = 5000) => { if (rec) { await rec.caption(text); await rec.pause(ms); } };
    const point = async (number, text, selector, action) => {
      await center(selector);
      if (rec) { await rec.caption(text); await rec.focus(selector, number); }
      console.log('focus', number, selector);
      if (action) await action();
      if (rec) { await rec.pause(3000); await rec.unfocus(); }
    };

    // 1. 메뉴에서 열기
    rec?.chapter('open', '1. 메뉴에서 아침 브리핑을 엽니다');
    await point(1, '1. 왼쪽 메뉴 맨 위 묶음에서 "아침 브리핑"을 누릅니다.', menu, async () => {
      await page.click(menu);
      await page.waitForFunction(() => document.querySelector('main.briefing h1')?.innerText === '아침 브리핑' && document.querySelectorAll('[data-briefing-card]').length > 0);
    });
    assert.equal(new URL(page.url()).pathname, '/briefing');
    assert.equal(await page.$$eval('[data-ui-shell]', n => n.length), 1, 'one shell');
    assert.equal(await page.$$eval('[data-ui-sidebar]', n => n.length), 1, 'one sidebar');
    const cards = await page.$$eval('[data-briefing-card]', nodes => nodes.map(n => ({ id: n.dataset.briefingCard, status: n.className.match(/red|amber|green|gray/)?.[0], text: n.innerText })));
    assert.deepEqual(cards.map(c => c.id), ['orderRequests', 'incoming', 'week', 'receivables', 'approvals', 'creditLimit'], 'red first, then amber, then green');
    assert.deepEqual(cards.map(c => c.status), ['red', 'red', 'amber', 'amber', 'green', 'green']);
    const text = await page.evaluate(() => document.querySelector('main.briefing').innerText);
    for (const expected of ['바로 확인할 것 2가지', '2건 대기', '연습꽃집 가 · 46-01차 · 품목 3개', '예정일 지남 1건', '진행 중 3건 · 오늘 도착 1건 · 예정일 지남 1건', '미확정 4건', '매출 12,500,000원', '61~90일 미수 800,000원', '미수 합계 8,200,000원', '대기 중인 결재 없음', '한도 초과·임박 없음']) assert(text.includes(expected), 'missing text: ' + expected);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow at 1920');
    if (dry) await page.screenshot({ path: '.verify/morning-briefing-admin-1920.png', fullPage: true });
    await point(1, '1. 맨 위 색 띠가 오늘의 결론입니다.\n빨강이면 바로 확인할 것이 있다는 뜻입니다.', '[data-briefing="summary"]');
    await say('1. 색 띠 오른쪽에서 바로 확인·확인 필요·문제 없음이 각각 몇 가지인지 봅니다.');

    // 2. 카드 읽기
    rec?.chapter('read-cards', '2. 빨간 카드부터 차례로 읽습니다');
    await point(2, '2. 급한 카드가 앞에 옵니다. 주문 신청 승인 대기 2건,\n거래처·차수·품목 수·신청한 사람이 보입니다.', '[data-briefing-card="orderRequests"]');
    await point(2, '2. 입고 예정 카드는 도착 예정일이 지났는데\n입고 등록이 없는 건을 빨강으로 알려 줍니다.', '[data-briefing-card="incoming"]');
    await point(2, '2. 노랑 카드는 급하지 않지만 확인할 것입니다.\n이번 차수 미확정 4건이 보입니다.', '[data-briefing-card="week"]');
    await say('2. 초록 카드는 오늘 문제 없음입니다.\n불러오지 못한 항목은 0이 아니라 회색 "확인 못 함"으로 나옵니다.', 5500);

    // 3. 원본 화면으로 이동
    rec?.chapter('open-source', '3. 카드 아래 링크로 처리 화면을 엽니다');
    const link = '[data-briefing-card="orderRequests"] a.open';
    await point(3, '3. 카드 아래 "주문 신청 승인 화면 열기"를 누릅니다.', link, async () => {
      await page.click(link);
      await page.waitForFunction(() => location.pathname === '/admin/order-requests' && document.body.innerText.includes('연습꽃집 가'));
    });
    await say('3. 주문 신청 승인 화면이 열렸습니다. 승인·반려는 이 화면에서 합니다.\n아침 브리핑은 보기만 하고 자료를 바꾸지 않습니다.', 5500);
    await page.goBack({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => location.pathname === '/briefing' && document.querySelectorAll('[data-briefing-card]').length === 6);
    if (rec) await rec.restoreOverlay();
    await say('3. 뒤로 가면 아침 브리핑으로 돌아옵니다.', 3500);

    // 4. 다시 불러오기
    rec?.chapter('reload', '4. 다시 불러오기로 최신 숫자를 봅니다');
    const before = calls['/api/stats/dashboard'];
    await point(4, '4. 오른쪽 위 "다시 불러오기"를 누르면 최신 숫자로 다시 읽습니다.', '[data-briefing="reload"]', async () => {
      await page.click('[data-briefing="reload"]');
      await page.waitForFunction(() => !document.querySelector('[data-briefing="reload"]').disabled && document.querySelector('main.briefing .loaded').innerText.includes('기준'));
    });
    assert.equal(calls['/api/stats/dashboard'], before + 1, 'reload fetches again');
    await say('4. 버튼 왼쪽 "기준" 시각이 방금 시각으로 바뀌었는지 확인합니다.\n"인쇄 (A4)"로 한 장 출력도 할 수 있습니다.', 5500);

    // Keyboard: the reload button is reachable and focus is visible; the guide toggle is a native <details>.
    await page.focus('[data-briefing="reload"]');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset.briefing), 'reload');
    assert.equal(writes, 0, 'briefing must not issue write requests');
    assert.deepEqual(errors, [], 'no page errors');

    if (rec) {
      const result = await rec.stop();
      const file = 'config/workflow-guides.json', registry = JSON.parse(fs.readFileSync(file, 'utf8'));
      const guide = registry.workflows.find(w => w.id === WORKFLOW).guides.find(g => g.id === GUIDE);
      guide.status = 'ready'; guide.chapters = result.chapters;
      fs.writeFileSync(file, JSON.stringify(registry, null, 2) + '\n');
    }

    // Non-admin: admin-only APIs are never called and only three cards render. Mobile width: no horizontal overflow.
    const staff = { userId: 'guide-staff', userName: '연습 직원', authority: 4, deptName: '영업', accountActive: true };
    FIXTURES['/api/auth/me'] = { success: true, user: staff };
    await page.setCookie({ name: 'nenovaToken', value: jwt.sign(staff, secret, { expiresIn: '1h' }), url: base });
    for (const key of Object.keys(calls)) delete calls[key];
    await page.goto(base + '/briefing', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelectorAll('[data-briefing-card]').length > 0);
    assert.deepEqual((await page.$$eval('[data-briefing-card]', n => n.map(x => x.dataset.briefingCard))).sort(), ['incoming', 'orderRequests', 'week']);
    assert.equal(Object.keys(calls).filter(p => p.startsWith('/api/mgmt/')).length, 0, 'non-admin never calls admin APIs');
    await page.screenshot({ path: '.verify/morning-briefing-staff-1920.png', fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(base + '/briefing?popup=1', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelectorAll('[data-briefing-card]').length > 0);
    assert.equal(await page.$$eval('[data-ui-sidebar]', n => n.length), 0, 'popup has no sidebar');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'no horizontal overflow at 390');
    await page.screenshot({ path: '.verify/morning-briefing-390.png', fullPage: true });

    console.log(JSON.stringify({ passed: true, dry, blockedExternalRequests: external, productionWrites: writes, pageErrors: errors.length }));
  } finally { await browser?.close(); server.kill(); }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });

// Actual desktop home shell with practice data: morning briefing panel in the fixed top-left slot + search results under the search box.
// No production network, no ERP reads or writes.
const { fixture } = require('./desktop-task-schedule-smoke.cjs');
const puppeteer = require('puppeteer-core'), assert = require('node:assert/strict'), fs = require('node:fs');
(async () => {
  const app = await fixture(), browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage(), errors = []; let hold = null, failing = false;
    await page.exposeFunction('fixtureInvoke', async (action, payload) => {
      if (action === 'morningBriefing') { if (hold) await hold; if (failing) { app.calls.push({ action, payload }); throw Error('아침 브리핑을 불러오지 못했습니다. (500)'); } }
      return app.invoke(action, payload);
    });
    await page.evaluateOnNewDocument(() => { window.desktop = { invoke: (a, p) => window.fixtureInvoke(a, p), onState(cb) { window.fixtureEmit = cb; } }; });
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true); page.on('request', r => (new URL(r.url()).hostname === '127.0.0.1' ? r.continue() : r.abort()));
    const box = selector => page.$eval(selector, e => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom) }; });
    const frame = async () => ({ update: await box('.app-update-panel'), pm: await box('#pmLivePanel'), search: await box('.search-wrap'), columns: (({ top, left, width }) => ({ top, left, width }))(await box('.home-columns')), heading: await box('.home-heading') });
    fs.mkdirSync('.verify', { recursive: true });
    for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768]]) {
      await page.setViewport({ width, height }); let release; hold = new Promise(r => { release = r; });
      await page.goto(app.base + '/index.html'); await page.waitForSelector('.hw-task');
      // 1) 브리핑이 아직 안 온 상태의 배치를 먼저 잰다.
      assert.equal(await page.$eval('#briefingList', e => e.children.length), 0);
      const before = await frame(), emptyPanel = await box('#briefingPanel');
      release(); hold = null; await page.waitForFunction(() => document.querySelectorAll('#briefingList [data-briefing-card]').length === 6);
      // 2) 카드가 들어와도 칸 크기와 나머지 배치는 그대로, 넘치는 내용은 칸 안에서만 스크롤.
      const after = await frame(), panel = await box('#briefingPanel');
      assert.deepEqual(after, before, `home frame must not move at ${width}px`);
      assert.deepEqual(panel, emptyPanel, `briefing slot keeps its size at ${width}px`);
      const list = await page.$eval('#briefingList', e => ({ scroll: e.scrollHeight, client: e.clientHeight, overflowY: getComputedStyle(e).overflowY }));
      assert.equal(list.overflowY, 'auto'); if (width === 1366) assert.ok(list.scroll > list.client, 'content longer than the slot scrolls inside it');
      assert.ok((await page.$eval('#briefingList [data-briefing-card="incoming"]', e => e.title)).includes('예정일 지남 1건'), 'detail lines stay available on hover');
      assert.ok(panel.height >= 76 && panel.height <= 168, `slot height ${panel.height}`);
      const intro = await box('.home-intro'); assert.ok(panel.bottom <= intro.bottom + 1 && panel.left >= intro.left, 'slot sits under the title inside the first column');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const rows = await page.$$eval('#briefingList [data-briefing-card]', n => n.map(e => [e.dataset.briefingCard, e.className.match(/is-(\w+)/)[1], e.tagName]));
      assert.deepEqual(rows.map(r => r[0]), ['orderRequests', 'incoming', 'week', 'receivables', 'approvals', 'creditLimit']);
      assert.deepEqual(rows.map(r => r[1]), ['red', 'red', 'amber', 'amber', 'green', 'green']); assert.ok(rows.every(r => r[2] === 'BUTTON'));
      assert.equal(await page.$eval('#briefingSummary', e => e.textContent), '바로 확인할 것 2가지'); assert.equal(await page.$eval('#briefingPanel', e => e.dataset.state), 'red');
      console.log('layout', width, JSON.stringify({ slot: panel, headingHeight: after.heading.height }));
      await page.screenshot({ path: `.verify/desktop-briefing-${width}.png` });
    }
    await page.setViewport({ width: 1920, height: 1080 });
    // 3) 카드·전체 보기는 해당 화면을 탭으로 연다(쓰기 없음). 스크롤로 마지막 카드까지 볼 수 있다.
    await page.click('#briefingList [data-briefing-card="orderRequests"]'); assert.deepEqual(app.calls.at(-1), { action: 'open', payload: { url: '/admin/order-requests', title: '주문 신청 승인 대기' } });
    await page.click('#briefingOpen'); assert.deepEqual(app.calls.at(-1), { action: 'open', payload: { url: '/briefing', title: '아침 브리핑' } });
    await page.$eval('#briefingList', e => { e.scrollTop = e.scrollHeight; });
    const last = await box('#briefingList [data-briefing-card="creditLimit"]'), slot = await box('#briefingList'); assert.ok(last.bottom <= slot.bottom + 1, 'last card reachable by scrolling');
    const loads = () => app.calls.filter(c => c.action === 'morningBriefing').length; const n = loads();
    await page.click('#briefingReload'); await page.waitForFunction(() => !document.querySelector('#briefingReload').disabled); assert.equal(loads(), n + 1);
    // 4) 검색 결과는 검색창 바로 밑에 뜨고, 홈 배치를 밀지 않는다.
    const base = await frame(); assert.equal(await page.$eval('#searchResults', e => e.hidden), true);
    await page.focus('#menuSearch'); await page.keyboard.type('주문');
    await page.waitForFunction(() => !document.querySelector('#searchResults').hidden);
    const results = await box('#searchResults'), input = await box('.search-box');
    assert.ok(results.top >= input.bottom && results.top - input.bottom <= 8, `results directly under the search box (gap ${results.top - input.bottom})`);
    assert.equal(results.left, input.left); assert.equal(results.width, input.width);
    assert.deepEqual(await page.$$eval('#searchResults button', b => b.map(e => e.dataset.searchHref)), ['/orders/new']);
    assert.match(await page.$eval('.search-results-count', e => e.textContent), /검색 결과 1개/);
    assert.deepEqual(await frame(), base, 'opening results must not move the home frame');
    await page.screenshot({ path: '.verify/desktop-search-results-1920.png' });
    await page.keyboard.press('ArrowDown'); assert.equal(await page.evaluate(() => document.activeElement.dataset.searchHref), '/orders/new');
    await page.keyboard.press('Enter'); assert.deepEqual(app.calls.at(-1), { action: 'open', payload: { url: '/orders/new', title: '주문등록' } });
    await page.keyboard.press('Escape'); assert.equal(await page.$eval('#menuSearch', e => e.value), ''); assert.equal(await page.$eval('#searchResults', e => e.hidden), true); assert.equal(await page.evaluate(() => document.activeElement.id), 'menuSearch');
    await page.keyboard.type('없는메뉴이름'); assert.match(await page.$eval('.search-results-count', e => e.textContent), /검색 결과가 없습니다/); assert.equal(await page.$$eval('#searchResults button', b => b.length), 0);
    await page.$eval('#menuSearch', e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); }); assert.equal(await page.$eval('#searchResults', e => e.hidden), true);
    // 5) 실패는 초록·0으로 보이지 않고, 이전 카드도 남기지 않는다.
    failing = true; await page.click('#briefingReload');
    await page.waitForFunction(() => document.querySelector('#briefingPanel').dataset.state === 'gray' && document.querySelector('#briefingSummary').textContent.includes('불러오지 못했습니다'));
    assert.equal(await page.$eval('#briefingList', e => e.children.length), 0); failing = false;
    assert.equal(app.calls.filter(c => c.payload?.method === 'POST').length, 0, 'no write requests'); assert.deepEqual(errors, []);
    console.log('Desktop briefing PASS: slot fixed + inner scroll + frame unchanged at 1920/1600/1366, cards open tabs, reload, search results under box, keyboard, failure gray, writes 0, JS0');
  } finally { await browser.close(); await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

// Local production pages only; every API request is fulfilled by an in-memory fixture.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const base = 'http://127.0.0.1:3221';
const id = '643045f0-8bb3-4aac-9724-d8ca3f63897e';
(async () => {
  const browser = await puppeteer.launch({ executablePath: ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync), headless: true });
  try {
    for (const width of [1920, 800]) {
      const context = await browser.createBrowserContext(), page = await context.newPage();
      const posts = [], errors = [];
      await page.setViewport({ width, height: 1080 });
      await page.setCookie({ name: 'nenovaToken', value: jwt.sign({ userId: 'home-source-fixture', authority: 6, accountActive: true, userName: 'Fixture' }, 'home-fixture-only-not-production'), url: base });
      page.on('pageerror', e => errors.push(e.message));
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) {
          if (!['GET','HEAD'].includes(request.method())) posts.push(url.pathname);
          let body = { success: true, user: {userId:'home-source-fixture',userName:'Fixture',authority:6}, menus: [], data: [] };
          if (url.pathname === '/api/operations-knowledge') body = { success: true, revision: 1, items: [{ id, title: '연결 지침 원문', status: 'CURRENT', priority: 'NORMAL', category: 'SITUATION', tags: {countries:[],flowers:[],farms:[],stages:[]}, action: '원문 연결 확인', comments: [], attachments: [], updatedAt: '2026-10-09T01:00:00Z' }], audit: [], legacyHandoffs: {items:[]} };
          if (url.pathname === '/api/sales/farm-quality') {
            const year = Number(url.searchParams.get('year'));
            body = url.searchParams.has('caseKey') ? { success:true, events:[{EventKey:'1',Kind:'COMMENT',Body:'연도별 원문 '+year,AuthorName:'Fixture',CreatedAt:'2026-10-09T01:00:00Z',EventNo:1,Evidence:[]}] } : { success: true, scope: {year,from:1,to:53}, cases: [{ CaseKey:id,OrderYear:year,Title:'연결 피드백 '+year,Status:'WAITING',FarmName:'Fixture Farm',ProductName:'Fixture Rose',Version:1,RecentEvents:[],EventCount:1 }], groups: [], signals: [], farmTrends: [], issueCandidates: [], inbox:{items:[],groups:[],summary:{}}, canManage:false,canDelete:false };
          }
          return request.respond({ status: 200, contentType:'application/json', body:JSON.stringify(body) });
        }
        if (url.origin !== base) return request.abort();
        return request.continue();
      });
      await page.goto(base+'/operations-knowledge?itemId='+id+'&popup=1',{waitUntil:'networkidle0'});
      await page.waitForFunction(() => [...document.querySelectorAll('h2,h3')].some(n=>n.textContent==='연결 지침 원문'));
      for (const year of [2025, 2026]) {
        await page.goto(base+'/sales/farm-quality?year='+year+'&caseKey='+id+'&popup=1',{waitUntil:'networkidle0'});
        await page.waitForFunction(y=>document.querySelector('.detail')?.textContent.includes('연결 피드백 '+y)&&document.querySelector('.detail')?.textContent.includes('연도별 원문 '+y),{},year);
        assert.equal(await page.$eval('.toolbar input', el=>Number(el.value)),year);
      }
      assert.deepEqual(posts, [], 'source navigation cannot write');
      assert.deepEqual(errors, [], 'source navigation has no runtime errors');
      await context.close(); console.log('Home source deep links passed '+width+'x1080, 2025/2026, no API writes');
    }
  } finally { await browser.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });

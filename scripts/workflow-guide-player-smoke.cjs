const assert = require('node:assert/strict'), fs = require('node:fs'), net = require('node:net'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken'), puppeteer = require('puppeteer-core');
async function main() {
  const targetId=process.env.GUIDE_WORKFLOW_ID || 'incoming-approval';
  const target=require('../config/workflow-guides.json').workflows.find(w=>w.id===targetId);
  if(!target)throw Error('Unknown guide workflow');
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve)); const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const secret = crypto.randomUUID(), base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '-p', String(port)], { env: { ...process.env, DB_SERVER: '', JWT_SECRET: secret }, stdio: 'ignore', windowsHide: true }); let browser;
  try {
    for (let n = 0; n < 60; n++) { try { if ((await fetch(base + '/login')).status === 200) break; } catch {} if (n === 59) throw Error('Local built UI did not start'); await new Promise(resolve => setTimeout(resolve, 1000)); }
    browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
    const page = await browser.newPage(), errors = [], assets = [], writes = [];
    await page.setViewport({ width: 1920, height: 1080 });
    const user = { userId: 'guide-player-test', userName: '가이드 재생 검증', authority: 1, deptName: '대표', accountActive: true };
    await page.setCookie({ name: 'nenovaToken', value: jwt.sign(user, secret, { expiresIn: '10m' }), url: base });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (new URL(response.url()).pathname.startsWith('/guides/')) assets.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    await page.setRequestInterception(true); page.on('request', request => {
      const url = new URL(request.url()); if (url.origin !== base) return request.abort();
      if (!url.pathname.startsWith('/api/')) return request.continue();
      if (request.method() !== 'GET') writes.push(url.pathname);
      const data = { success: true, user, items: [], rows: [], data: [], products: [], countries: [], records: [], history: [], references: [], options: [], masters: [], requests: [], permissions: { request: true, review: true }, value: null, revision: 0 };
      if(targetId==='packing-list-from-invoice'&&url.pathname==='/api/work/manuals'){data.handover=require('../data/import-handover.json');data.me=user;data.departments=[];data.manuals=[];}
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(base + (targetId==='profit-explicit-query'?'/sales/profit-report':targetId==='packing-list-from-invoice'?'/work/manuals?manual=packing-list-from-invoice':targetId==='manifest-farm-matching'?'/master/codes':targetId==='incoming-approval'?'/import/tools?tab=incoming':'/import/tools'), { waitUntil: 'networkidle0' });
    if(targetId==='invoice-farm-history')await page.click('button[aria-controls="import-panel-history"]');
    if(targetId==='manifest-farm-matching'){await page.focus('[role="tab"][aria-selected="true"]');await page.keyboard.press('End');assert.equal(await page.$eval('[role="tab"][aria-selected="true"]',node=>node.textContent.trim()),'🌾 농장');}
    if(targetId==='packing-amount-review'){await page.click('button[aria-label="콜롬비아"]');}
    await page.evaluate(titleText=>{const title=[...document.querySelectorAll('h3')].find(n=>n.textContent===titleText&&n.closest('details'));if(!title)throw Error('Guide missing');title.closest('details').id='guide-player-target';},target.title);
    const summary = await page.$('#guide-player-target > summary');
    assert(summary, 'Guide entry missing'); await summary.focus(); if(!await page.$eval('#guide-player-target',details=>details.open))await page.keyboard.press('Enter');
    await page.waitForSelector('#guide-player-target video'); assert(await page.$eval('#guide-player-target video', video => video.paused));
    const roles = [...new Set(target.guides.map(guide => guide.role))];
    for (const role of roles) {
      const button = await page.evaluateHandle(role => [...document.querySelector('#guide-player-target').querySelectorAll('button')].find(node => node.textContent === `${role}용`), role); if(button.asElement()){await button.asElement().focus(); await page.keyboard.press('Space');}
      await page.waitForFunction(role => document.querySelector('#guide-player-target video')?.getAttribute('aria-label').startsWith(role), {}, role);
      await page.$eval('#guide-player-target video', video => { video.muted = true; return video.play(); });
      await page.waitForFunction(() => document.querySelector('#guide-player-target video').currentTime > .3, { timeout: 15000 });
      await page.$eval('#guide-player-target video', video => video.pause());
      await page.$eval('#guide-player-target video', video => { video.textTracks[0].mode = 'showing'; });
      const chapters = await page.$$(`#guide-player-target nav[aria-label="${role} 영상 목차"] button`);
      const expectedChapters = target.guides.find(guide => guide.role === role).chapters;
      assert.equal(chapters.length, expectedChapters.length);
      const newPackingChapter = expectedChapters.findIndex(chapter => chapter.scenario === 'packing-quantity');
      await chapters[newPackingChapter >= 0 ? newPackingChapter : 1].focus(); await page.keyboard.press('Enter');
      assert(await page.$eval('#guide-player-target video', video => video.currentTime > 1 && video.paused));
      await page.waitForFunction(() => { const video = document.querySelector('#guide-player-target video'); return !video.seeking && video.readyState >= 2; });
      await page.waitForFunction(() => document.querySelector('#guide-player-target video track')?.readyState === 2, { timeout: 15000 });
      assert(await page.$eval('#guide-player-target video', video => video.textTracks.length === 1 && video.textTracks[0].language === 'ko'));
      await page.$eval('#guide-player-target video', video => { video.textTracks[0].mode = 'disabled'; });
      assert(await page.$('a[download][href$=".mp4"]')); assert(await page.$('a[download][href$=".vtt"]'));
    }
    fs.mkdirSync('.verify', { recursive: true }); await page.screenshot({ path: '.verify/workflow-guide-player-desktop.png' });
    await page.setViewport({ width: 390, height: 844 }); await page.$eval('#guide-player-target video', video => video.scrollIntoView({ block: 'center' }));
    assert(await page.$eval('#guide-player-target video', video => { const rect = video.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }));
    await page.screenshot({ path: '.verify/workflow-guide-player-mobile.png' });
    await page.$eval('#guide-player-target video', video => video.play()); await summary.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#guide-player-target video').paused);
    assert.deepEqual(errors, []); assert(assets.length >= roles.length * 2); assert(assets.every(asset => [200, 206, 304].includes(asset.status)));
    assert(writes.every(url => !url.startsWith('/api/warehouse')), 'Guide must not submit ERP requests');
    console.log('PASS guide player: keyboard open/roles/chapters, actual MP4 playback, Korean VTT, download, collapse pause, 1920/390; all APIs synthetic');
  } finally { await browser?.close(); server.kill(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

const assert = require('node:assert/strict'), fs = require('node:fs'), net = require('node:net'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken'), puppeteer = require('puppeteer-core');
async function main() {
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
      return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(base + '/import/tools?tab=incoming', { waitUntil: 'networkidle0' });
    const summary = await page.evaluateHandle(() => [...document.querySelectorAll('summary')].find(node => node.textContent.includes('사용 가이드 영상')));
    assert(summary.asElement(), 'Guide entry missing'); await summary.asElement().focus(); await page.keyboard.press('Enter');
    await page.waitForSelector('video'); assert(await page.$eval('video', video => video.paused));
    for (const role of ['수입부', '영업지원']) {
      const button = await page.evaluateHandle(role => [...document.querySelectorAll('button')].find(node => node.textContent === `${role}용`), role); await button.asElement().focus(); await page.keyboard.press('Space');
      await page.waitForFunction(role => document.querySelector('video')?.getAttribute('aria-label').startsWith(role), {}, role);
      await page.$eval('video', video => { video.muted = true; return video.play(); });
      await page.waitForFunction(() => document.querySelector('video').currentTime > .3, { timeout: 15000 });
      await page.$eval('video', video => video.pause());
      await page.$eval('video', video => { video.textTracks[0].mode = 'showing'; });
      const chapters = await page.$$(`nav[aria-label="${role} 영상 목차"] button`); assert.equal(chapters.length, role==='수입부'?5:3);
      await chapters[1].focus(); await page.keyboard.press('Enter');
      assert(await page.$eval('video', video => video.currentTime > 1 && video.paused));
      await page.waitForFunction(() => { const video = document.querySelector('video'); return !video.seeking && video.readyState >= 2; });
      await page.waitForFunction(() => document.querySelector('video track')?.readyState === 2, { timeout: 15000 });
      assert(await page.$eval('video', video => video.textTracks.length === 1 && video.textTracks[0].language === 'ko'));
      await page.$eval('video', video => { video.textTracks[0].mode = 'disabled'; });
      assert(await page.$('a[download][href$=".mp4"]')); assert(await page.$('a[download][href$=".vtt"]'));
    }
    fs.mkdirSync('.verify', { recursive: true }); await page.screenshot({ path: '.verify/workflow-guide-player-desktop.png' });
    await page.setViewport({ width: 390, height: 844 }); await page.$eval('video', video => video.scrollIntoView({ block: 'center' }));
    assert(await page.$eval('video', video => { const rect = video.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }));
    await page.screenshot({ path: '.verify/workflow-guide-player-mobile.png' });
    await page.$eval('video', video => video.play()); await summary.asElement().focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('video').paused);
    assert.deepEqual(errors, []); assert(assets.length >= 4); assert(assets.every(asset => [200, 206, 304].includes(asset.status)));
    assert(writes.every(url => !url.startsWith('/api/warehouse')), 'Guide must not submit ERP requests');
    console.log('PASS guide player: keyboard open/roles/chapters, actual MP4 playback, Korean VTT, download, collapse pause, 1920/390; all APIs synthetic');
  } finally { await browser?.close(); server.kill(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

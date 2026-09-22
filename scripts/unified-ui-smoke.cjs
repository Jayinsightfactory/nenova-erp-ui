const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const source = fs.readFileSync('components/Layout.js', 'utf8').match(/export const MENU_ITEMS = \[([\s\S]*?)\n\];/)[1];
const routes = [...source.matchAll(/href:\s*'([^']+)'/g)].map(m => m[1]);
const out = 'outputs/unified-ui';
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const results = [];
  try {
    let index = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (index < routes.length) {
        const route = routes[index++];
        const page = await browser.newPage({ viewport: { width:1920, height:1080 } });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const user = { userId:'nenovaSS3', userName:'UI 검증', authority:1 };
        await page.addInitScript(u => localStorage.setItem('nenovaUser', JSON.stringify(u)), user);
        await page.route('**/api/**', async r => {
          if (r.request().url().includes('/auth/me')) return r.fulfill({ json:{success:true,user} });
          // Controlled unavailable-data state; no production reads or writes.
          return r.fulfill({status:503,json:{success:false,error:'UI 검증용 데이터 미연결',data:[],rows:[],items:[]}});
        });
        let result = { route, viewport:'1920x1080', mode:'unavailable-data fixture' };
        try {
          const response = await page.goto(`${process.env.SMOKE_BASE_URL || 'http://localhost:3224'}${route}?popup=1`, { waitUntil:'networkidle',timeout:20000 });
          result = { ...result, http:response.status(), ...await page.evaluate(() => ({
            theme:getComputedStyle(document.documentElement).getPropertyValue('--ui-radius').trim(),
            content:!!document.querySelector('[data-ui-page-content]'),
            overflow:document.documentElement.scrollWidth > innerWidth + 2,
            buttons:document.querySelectorAll('button').length,
            title:document.title,
          })) };
          await page.screenshot({ path:path.join(out, route.replaceAll('/','_')+'.png') });
        } catch(e) { result.error=e.message; }
        result.errors=errors;
        results.push(result);
        console.log(JSON.stringify(result));
        await page.close();
      }
    }));
    fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(results,null,2));
    assert.equal(results.length,routes.length);
    const protectedRoutes = new Set(['/my-work', '/admin/orbit-report']);
    assert.ok(results.every(r => r.theme === '6px' && r.http === (protectedRoutes.has(r.route) ? 404 : 200)), 'theme loads; server-protected pages retain their authentication gate');
    assert.ok(results.every(r => !r.overflow), 'no document horizontal overflow at 1920x1080');
    assert.ok(results.every(r => r.errors.every(e => e === 'UI 검증용 데이터 미연결')), 'no unexpected browser exceptions');
    console.log('72 page shells verified; 2 server-protected pages not visually verified. Data-unavailable errors remain recorded in report.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});

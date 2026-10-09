const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const base = process.env.LOGIN_SMOKE_BASE || 'http://127.0.0.1:3219';
(async () => {
  const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    for (const width of [1920, 800]) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({width, height:1080});
      let success = true; const posts = [];
      await page.setRequestInterception(true);
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname === '/api/auth/login') {
          assert.equal(request.method(), 'POST'); const body = JSON.parse(request.postData()); posts.push(body);
          return request.respond({status:200, contentType:'application/json', body:JSON.stringify(success ? {success:true,user:{userId:body.userId,userName:'Fixture'}} : {success:false,error:'테스트 로그인 실패'})});
        }
        if (url.pathname.startsWith('/api/')) return request.respond({status:200,contentType:'application/json',body:'{"success":true,"data":[],"menus":[]}'});
        if (url.pathname === '/dashboard') return request.respond({status:200,contentType:'text/html',body:'<html><body>Login fixture destination</body></html>'});
        if (url.pathname.includes('/_next/data/') && url.pathname.endsWith('/dashboard.json')) return request.respond({status:200,contentType:'application/json',body:'{"pageProps":{}}'});
        if(url.origin !== new URL(base).origin && !['data:','devtools:'].includes(url.protocol)) return request.abort();
        return request.continue();
      });
      const enter = async (id, password) => {
        await page.$eval('#login-id', el => { el.focus(); el.select(); }); await page.keyboard.type(id);
        await page.$eval('#login-password', el => { el.focus(); el.select(); }); await page.keyboard.type(password); await page.keyboard.press('Enter');
      };
      const loginPage = async () => { await page.goto(base+'/login',{waitUntil:'networkidle0'}); await page.waitForSelector('#login-id'); };
      const remembered = async () => (await page.cookies()).find(c=>c.name==='nenovaLoginId')?.value;
      const fixturePassword = 'fixture-secret-never-persist';
      await loginPage();
      await enter('fixture-a',fixturePassword); await page.waitForFunction("location.pathname === '/dashboard'");
      assert.equal(await remembered(),'fixture-a');
      await page.evaluate(()=>localStorage.clear()); // PC account reset and logged-out auth state.
      for(const cookie of await page.cookies()) if(cookie.name !== 'nenovaLoginId') await page.deleteCookie(cookie);
      await loginPage();
      assert.deepEqual(await page.evaluate(()=>({id:document.querySelector('#login-id').value,pw:document.querySelector('#login-password').value,focus:document.activeElement.id})),{id:'fixture-a',pw:'',focus:'login-password'});
      await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift'); assert.equal(await page.evaluate(()=>document.activeElement.id),'login-id');
      await page.keyboard.press('Tab'); assert.equal(await page.evaluate(()=>document.activeElement.id),'login-password');
      await page.keyboard.type('cancel-me');
      const cancel = await page.$$('button');
      for(const button of cancel) if((await button.evaluate(el=>el.textContent)).trim()==='취소') await button.click();
      assert.deepEqual(await page.evaluate(()=>({id:document.querySelector('#login-id').value,pw:document.querySelector('#login-password').value,focus:document.activeElement.id})),{id:'fixture-a',pw:'',focus:'login-password'});
      success=false; await enter('fixture-fail',fixturePassword); await page.waitForFunction("document.body.textContent.includes('테스트 로그인 실패')"); assert.equal(await remembered(),'fixture-a');
      success=true; await enter('fixture-b',fixturePassword); await page.waitForFunction("location.pathname === '/dashboard'"); assert.equal(await remembered(),'fixture-b');
      const persisted = JSON.stringify(await page.cookies())+await page.evaluate(()=>JSON.stringify({...localStorage})+JSON.stringify({...sessionStorage})); assert.ok(!persisted.includes(fixturePassword),'password must never persist');
      await page.setCookie({name:'nenovaLoginId',value:'%E0%A4%A',url:base}); await loginPage(); assert.equal(await page.$eval('#login-id',el=>el.value),'');
      await enter('fixture-c',fixturePassword); await page.waitForFunction("location.pathname === '/dashboard'"); assert.equal(await remembered(),'fixture-c');
      const blocked = await page.evaluateOnNewDocument(()=>Object.defineProperty(document,'cookie',{get(){throw Error('cookie blocked');},set(){throw Error('cookie blocked');},configurable:true}));
      await loginPage(); await enter('fixture-d',fixturePassword); await page.waitForFunction("location.pathname === '/dashboard'"); assert.equal(await remembered(),'fixture-c','blocked remembering must not prevent normal login');
      await page.removeScriptToEvaluateOnNewDocument(blocked.identifier); await loginPage();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
      assert.equal(posts.length,5); console.log('login browser fixture passed '+width+'x1080'); await context.close();
    }
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

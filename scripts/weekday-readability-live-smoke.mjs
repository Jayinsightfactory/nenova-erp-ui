// Authenticated production READ-ONLY UI check. Never permits ERP/baseline/note writes.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const base='https://nenovaweb.com';
assert.ok(process.env.SMOKE_USER && process.env.SMOKE_PASSWORD && process.env.PLAYWRIGHT_MODULE);
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,channel:'chrome',ignoreDefaultArgs:['--hide-scrollbars']});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
try {
  const login=await context.request.post(`${base}/api/auth/login`,{data:{userId:process.env.SMOKE_USER,password:process.env.SMOKE_PASSWORD}});
  assert.equal(login.status(),200); assert.equal((await login.json()).success,true);
  const page=await context.newPage(),errors=[],blocked=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const req=route.request(),pathname=new URL(req.url()).pathname;
    const readonly=['GET','HEAD'].includes(req.method())
      || ['/api/estimate/weekday-compare','/api/estimate/weekday-print'].includes(pathname)
      || (pathname==='/api/estimate/weekday-baseline' && req.method()==='POST' && req.postDataJSON()?.action==='preview');
    if(!readonly) {
      // Suppress telemetry too, keeping this production check strictly non-mutating.
      if(!/^\/api\/(replay|action-log|work\/replay)/.test(pathname))blocked.push(pathname);
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true})});
    }
    return route.continue();
  });
  await page.goto(`${base}/estimate/weekday?popup=1`,{waitUntil:'networkidle',timeout:60000});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor({timeout:60000});
  assert.ok(await page.locator('.wcm-table-scroll tbody tr').count()>1);
  for(const selector of ['.wcm-scroll-top','.wcm-scroll-bottom']) {
    await page.locator(selector).evaluate(el=>{el.scrollLeft=700;});
    await page.waitForFunction(()=>['.wcm-scroll-top','.wcm-scroll-bottom','.wcm-table-scroll'].every(selector=>Math.abs(document.querySelector(selector).scrollLeft-700)<1));
    await page.locator(selector).evaluate(el=>{el.scrollLeft=0;});
    await page.waitForFunction(()=>['.wcm-scroll-top','.wcm-scroll-bottom','.wcm-table-scroll'].every(selector=>document.querySelector(selector).scrollLeft===0));
  }
  const summary=await page.locator('.wcm-major-total').first().evaluate(el=>({
    width:el.getBoundingClientRect().width,
    font:parseFloat(getComputedStyle(el.querySelector('.wcm-remainder-value')).fontSize),
    labels:el.innerText,
    overflow:el.scrollWidth>el.clientWidth+1,
  }));
  assert.ok(summary.width>=199);assert.ok(summary.font>=14);assert.equal(summary.overflow,false);
  assert.match(summary.labels,/합계/);assert.match(summary.labels,/변경/);assert.match(summary.labels,/견적/);
  await page.setViewportSize({width:1280,height:800});
  await page.waitForFunction(()=>['.wcm-scroll-top','.wcm-scroll-bottom'].every(selector=>Math.abs(document.querySelector(selector).scrollWidth-document.querySelector('.wcm-table-scroll').scrollWidth)<=1));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  const html=await page.content();
  const build=html.match(/"buildId":"([^"]+)"/)?.[1] || 'unknown';
  console.log(JSON.stringify({livePass:true,viewport:'1920x1080',zoom:'100%',narrowViewport:'1280x800',summary,scrollbars:'top/bottom/table synchronized',build,noErpWrites:true,errors}));
} finally {await browser.close();}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const base='https://nenovaweb.com';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
assert.ok(process.env.SMOKE_USER&&process.env.SMOKE_PASSWORD,'Auth must come from environment, never repository');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const output=path.resolve('output/weekday-horizontal-live');fs.mkdirSync(output,{recursive:true});
try {
  const login=await context.request.post(`${base}/api/auth/login`,{data:{userId:process.env.SMOKE_USER,password:process.env.SMOKE_PASSWORD}});
  assert.equal(login.status(),200);assert.equal((await login.json()).success,true);
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const writes=[];page.on('request',req=>{if(req.method()==='POST'&&/\/api\//.test(req.url())&&!/weekday-(?:compare|print)|auth|replay|action-log/.test(req.url()))writes.push(new URL(req.url()).pathname);});
  await page.goto(`${base}/estimate/weekday?popup=1`,{waitUntil:'networkidle',timeout:60000});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor({timeout:60000});
  assert.match(await page.locator('.weekday-workspace > header').innerText(),/주광농원/);
  assert.equal(await page.locator('.wcm-table-scroll table').count(),1);
  const rows=await page.locator('.wcm-table-scroll tbody tr').count();assert.ok(rows>1);
  const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,tableWidth:document.querySelector('.wcm-table-scroll table').getBoundingClientRect().width,visibleRows:[...document.querySelectorAll('.wcm-table-scroll tbody tr')].filter(row=>row.getBoundingClientRect().bottom<=innerHeight).length}));
  assert.equal(dimensions.width,1920);assert.equal(dimensions.height,1080);assert.ok(dimensions.documentWidth<=1921);
  await page.screenshot({path:path.join(output,'production-1920x1080.png')});
  const calendar=await (await context.request.get(`${base}/api/estimate/weekday-calendar?year=2026&majorWeek=38`)).json();
  const current=calendar.cycles.find(row=>row.offset===0);
  const majorResponse=await context.request.post(`${base}/api/estimate/weekday-print`,{data:{year:2026,majorWeek:38,custKey:533,mode:'major'}});
  const major=await majorResponse.json();assert.equal(majorResponse.status(),200,JSON.stringify(major));assert.equal(major.readOnly,true);
  let dailyRows=0;
  for(const day of current.days) {
    const response=await context.request.post(`${base}/api/estimate/weekday-print`,{data:{year:2026,majorWeek:38,custKey:533,mode:'dates',dates:[day.date]}});
    const result=await response.json();assert.equal(response.status(),200,JSON.stringify(result));assert.equal(result.draftIncluded,false);dailyRows+=result.items.length;
  }
  const invalid=await context.request.post(`${base}/api/estimate/weekday-print`,{data:{year:2026,majorWeek:38,custKey:533,mode:'dates',dates:[calendar.cycles[2].days[0].date]}});
  assert.equal(invalid.status(),409);
  const missingYear=await context.request.get(`${base}/api/estimate/weekday-products?custKey=533&orderWeeks=38-01`);assert.equal(missingYear.status(),400);
  const unauth=await browser.newContext();assert.equal((await unauth.request.post(`${base}/api/estimate/weekday-print`,{data:{year:2026,majorWeek:38,custKey:533,mode:'major'}})).status(),401);await unauth.close();
  await page.getByRole('button',{name:'전체 견적',exact:true}).nth(1).click();
  if(major.items.length) {
    await page.getByRole('dialog').waitFor();const frame=page.frameLocator('iframe[title="전산 확정 견적서"]');
    await frame.locator('.item-table tbody td').first().waitFor();
    assert.equal(await frame.locator('.item-table tbody td').first().evaluate(el=>getComputedStyle(el).fontSize),'10.6667px');
    await page.screenshot({path:path.join(output,'production-print-1920x1080.png')});
  }
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
  console.log(JSON.stringify({livePass:true,viewport:'1920x1080',zoom:'100%',rows,dimensions,majorPrintRows:major.items.length,dailyPrintRows:dailyRows,errors,noErpWrites:true}));
} finally{await browser.close();}

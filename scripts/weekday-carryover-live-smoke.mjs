// Authenticated operating READ-ONLY smoke. No ERP, baseline, note or carryover saves.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { validateWeekdayConfirmationResponse } from '../lib/weekdayConfirmation.js';
const base='https://nenovaweb.com';
assert.ok(process.env.SMOKE_USER && process.env.SMOKE_PASSWORD && process.env.PLAYWRIGHT_MODULE);
const pw=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const chromium=pw.chromium || pw.default?.chromium || pw['module.exports']?.chromium;
const browser=await chromium.launch({headless:true,channel:'chrome',ignoreDefaultArgs:['--hide-scrollbars']});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
try {
  const login=await context.request.post(`${base}/api/auth/login`,{data:{userId:process.env.SMOKE_USER,password:process.env.SMOKE_PASSWORD}});
  assert.equal(login.status(),200);assert.equal((await login.json()).success,true);
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date()).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`;
  const expected=await (await context.request.get(`${base}/api/estimate/weekday-calendar?defaultNext=1&date=${today}`)).json();
  assert.equal(expected.success,true);assert.equal(expected.readOnly,true);
  const confirmation=[];
  for(const majorWeek of ['39','40','41']) {
    const result=await context.request.get(`${base}/api/estimate/weekday-confirmation?year=2026&majorWeek=${majorWeek}`);
    assert.equal(result.status(),200);
    const summary=validateWeekdayConfirmationResponse({year:2026,majorWeek},await result.json());
    confirmation.push({majorWeek,state:summary.state,total:summary.totalCount,fixed:summary.fixedCount,categories:summary.categories.length});
  }
  const page=await context.newPage(),errors=[],blocked=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
    const req=route.request(),pathname=new URL(req.url()).pathname;
    const readonly=['GET','HEAD'].includes(req.method())
      || ['/api/estimate/weekday-compare','/api/estimate/weekday-print'].includes(pathname)
      || pathname==='/api/estimate/weekday-baseline' && req.method()==='POST' && req.postDataJSON()?.action==='preview';
    if(readonly) return route.continue();
    if(!/^\/api\/(replay|action-log|work\/replay)/.test(pathname))blocked.push(pathname);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true})});
  });
  await page.goto(`${base}/estimate/weekday?popup=1`,{waitUntil:'networkidle',timeout:60000});
  await page.getByRole('status').filter({hasText:'전후 차수 전산 대조 완료'}).waitFor({timeout:60000});
  assert.equal(await page.getByLabel('조회 연도').inputValue(),String(expected.scope.year));
  assert.equal(await page.getByLabel('중심 차수').inputValue(),expected.scope.majorWeek);
  const defaultCarry=await (await context.request.get(`${base}/api/estimate/weekday-carryover?year=${expected.scope.year}&majorWeek=${expected.scope.majorWeek}&custKey=533`)).json();
  assert.equal(defaultCarry.success,true,JSON.stringify(defaultCarry));assert.equal(defaultCarry.readOnly,true);
  assert.equal(defaultCarry.context.custKey,533);assert.ok(defaultCarry.context.cycles.length>=3);
  await page.getByLabel('조회 연도').fill('2026');
  await page.getByLabel('중심 차수').fill('38');
  await page.getByLabel('중심 차수').press('Tab');
  await page.getByText('현재 2026 / 38차',{exact:true}).waitFor({timeout:60000});
  const blueSunday=page.locator('.wcm-cell input[aria-label^="Hydrangea Blue "][aria-label*="2026/38-01 2026-09-20"]');
  await blueSunday.waitFor({timeout:60000});
  await page.waitForFunction(()=>{
    const input=document.querySelector('.wcm-cell input[aria-label^="Hydrangea Blue "][aria-label*="2026/38-01 2026-09-20"]');
    return input && !input.disabled;
  },null,{timeout:60000});
  const dayProof={value:await blueSunday.inputValue(),enabled:await blueSunday.isEnabled(),title:await blueSunday.locator('..').getAttribute('title')};
  assert.match(dayProof.title,/전산 원문 38-02: 0 박스/);
  await blueSunday.click();assert.equal(await blueSunday.evaluate(el=>document.activeElement===el),true);
  const typography=await blueSunday.evaluate(el=>({size:parseFloat(getComputedStyle(el).fontSize),weight:Number(getComputedStyle(el).fontWeight),align:getComputedStyle(el).textAlign}));
  assert.ok(typography.size>=16 && typography.weight>=600 && typography.align==='center');
  const selected=page.locator('.wcm-selected');
  await selected.waitFor();
  const selectedMetrics=await selected.evaluate(el=>({width:el.getBoundingClientRect().width,font:parseFloat(getComputedStyle(el).fontSize)}));
  assert.ok(selectedMetrics.width>=600 && selectedMetrics.font>=16);
  await page.getByRole('button',{name:'선택 칸 내역 닫기'}).click();
  // No fill/blur-changing edit and no save are performed against operating data.
  await page.getByLabel('중심 차수').click();
  const close=page.getByRole('button',{name:/Hydrangea Blue .*2026\/37차 마감 잔량 수정·이력/});
  await close.waitFor({timeout:60000});await close.click();
  const dialog=page.getByRole('dialog',{name:'웹 전용 마감 잔량 수정·이력'});
  await dialog.waitFor();assert.ok(await dialog.getByLabel('수동 마감 잔량').isEnabled());
  const popup1920=await dialog.boundingBox();
  assert.ok(popup1920.x>=0 && popup1920.y>=0 && popup1920.x+popup1920.width<=1920 && popup1920.y+popup1920.height<=1080);
  await page.setViewportSize({width:1280,height:800});
  const popup1280=await dialog.boundingBox();
  assert.ok(popup1280.x>=0 && popup1280.y>=0 && popup1280.x+popup1280.width<=1280 && popup1280.y+popup1280.height<=800);
  await dialog.getByRole('button',{name:'닫기',exact:true}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  for(const selector of ['.wcm-scroll-top','.wcm-scroll-bottom']) {
    await page.locator(selector).evaluate(el=>{el.scrollLeft=700;});
    await page.waitForFunction(()=>['.wcm-scroll-top','.wcm-scroll-bottom','.wcm-table-scroll']
      .every(selector=>Math.abs(document.querySelector(selector).scrollLeft-700)<1));
  }
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  const build=(await page.content()).match(/"buildId":"([^"]+)"/)?.[1] || 'unknown';
  console.log(JSON.stringify({livePass:true,build,viewport:'1920x1080 @100%',narrowViewport:'1280x800',today,
    defaultCenter:expected.scope,carryGet:true,contextInputs:defaultCarry.context.inputs.length,confirmation,typography,selectedMetrics,dayProof,popup1920,popup1280,noOperatingWrites:true,errors}));
}finally{await context.close();await browser.close();}

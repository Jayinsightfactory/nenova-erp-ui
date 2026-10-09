// Isolated fixture: verifies presentation preferences without ERP/message writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1920,height:1080}}),writes=[],errors=[];
  const firstLine='41-1 변경사항 참고 안내';
  const original=`${firstLine}\n검증꽃집\n회의 안내입니다.\n확인 부탁드립니다.`;
  const message={source:'nenovakakao',chatroom:'영업방',chat_id:'hide-fixture',external_message_id:'one',sender:'검증 담당',created_at:new Date().toISOString(),message:original};
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('nenovaUser',JSON.stringify({userId:'fixture',userName:'UI 검사',authority:1})));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   let data={success:true,data:[],rows:[],items:[],operations:[],history:[],applications:[],mappings:{},favorites:[],hasMore:false};
   if(url.pathname.endsWith('/auth/me'))data={success:true,user:{userId:'fixture',userName:'UI 검사',authority:1,accountActive:true}};
   if(url.pathname.endsWith('/orders/weeks'))data={success:true,weeks:['2026-41-01','2026-41-02']};
   if(url.pathname.endsWith('/sales-feed'))data={ok:true,messages:[message],hasMore:false,nextAfterKey:null};
   if(url.pathname.endsWith('/paste-preanalysis'))data={analysisStorage:{cacheMiss:true}};
   if(url.pathname.endsWith('/delivery-status')){const body=request.postDataJSON();data={ok:true,year:body.year,week:body.week,items:body.sources.map(source=>({identity:source.identity,status:'UNCONFIRMED'}))};}
   else if(request.method()!=='GET'&&!url.pathname.endsWith('/paste-preanalysis')&&!url.pathname.endsWith('/distribution-live-history'))writes.push(url.pathname);
   await route.fulfill({json:data});
  });
  const target=process.argv[2]||'http://localhost:3225/orders/paste?popup=1';
  await page.goto(target);
  // Open the reference category if the classifier correctly excludes this notice.
  await page.waitForFunction(()=>document.querySelector('.source-hide-toggle')||document.querySelector('[data-testid=compact-match-tab-review]')?.textContent.includes('1건'));
  if(await page.locator('.source-hide-toggle').count()===0){await page.locator('.non-action-reference summary').click();await page.getByTestId('compact-match-tab-review').click();}
  const card=page.locator('.compact-match-row').first();
  await card.locator('.source-hide-toggle').click();
  await page.waitForSelector('.collapsed-message-preview');
  assert.equal(await card.locator('.collapsed-message-preview').innerText(),firstLine);
  assert.equal(await card.locator('.paired-message-layout').count(),0);
  assert.equal(await card.locator('.compact-source-evidence').count(),0);
  assert.equal(await page.locator('.compact-match-row').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.waitForTimeout(500); // Wait for IndexedDB presentation preference commit.
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('.source-unhide-toggle')||document.querySelector('[data-testid=compact-match-tab-review]')?.textContent.includes('1건'));
  if(await page.locator('.source-unhide-toggle').count()===0){await page.locator('.non-action-reference summary').click();await page.getByTestId('compact-match-tab-review').click();}
  await page.waitForSelector('.source-unhide-toggle');
  assert.equal(await page.locator('.collapsed-message-preview').innerText(),firstLine);
  fs.mkdirSync('outputs/inbox-hide-smoke',{recursive:true});
  await page.screenshot({path:'outputs/inbox-hide-smoke/1920.png'});
  await page.locator('.source-unhide-toggle').click();
  assert.equal(await page.locator('[data-testid="complete-kakao-message"]').innerText(),original);
  await page.setViewportSize({width:1366,height:768});
  await page.locator('.source-hide-toggle').click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('.source-unhide-toggle').click();
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('.source-hide-toggle')||document.querySelector('[data-testid=compact-match-tab-review]')?.textContent.includes('1건'));
  if(await page.locator('.source-hide-toggle').count()===0){await page.locator('.non-action-reference summary').click();await page.getByTestId('compact-match-tab-review').click();}
  await page.waitForSelector('.source-hide-toggle');
  assert.equal(await page.locator('.collapsed-message-preview').count(),0,'unhide persists too');
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport:'1920x1080 / 1366x768',firstLineOnly:true,hiddenReload:true,unhiddenReload:true,rawPreserved:true,erpWrites:writes,errors}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

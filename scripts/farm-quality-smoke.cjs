const assert=require('node:assert/strict');
const fs=require('node:fs');
const puppeteer=require(process.env.PUPPETEER_CORE_PATH||'puppeteer-core');
(async()=>{
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();let posts=0;const requests=[];const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const cases=['NEW','WAITING','WAITING','ANSWERED','OBSERVING','CLOSED','RECURRED'].map((Status,i)=>({CaseKey:`10000000-0000-4000-8000-00000000000${i}`,OrderYear:2026,Status,FarmName:`농장 ${i+1}`,ProductName:'CARNATION / Novia 긴 품목명 확인',Title:'꽃잎 손상 반복 · 품질 확인',DueDate:i===2?'2025-01-01':'2099-01-01',Version:2,CreatedByName:'홍길동',UpdatedAt:'2026-09-14T01:00:00Z',LatestBody:'영업부 현장 상태 추가 확인했습니다.',LatestAuthor:'홍길동',LatestDepartment:'영업부'}));
  const groups=[{key:'a',farmName:'농장 1',productName:'CARNATION / Novia',quantity:15,unit:'박스',sourceKey:10,prodKey:2,weeks:{35:5,36:10}}];
  await page.setRequestInterception(true);
  page.on('request',r=>{
   if(!r.url().includes('/api/'))return r.continue();
   let data={success:true};let status=200;
   if(r.url().includes('/api/auth/me'))data.user={userId:'fixture',userName:'테스트 수입부',deptName:'수입부',authority:1};
   if(r.url().includes('/api/sales/farm-quality')){
    if(r.method()==='POST'){posts++;requests.push(JSON.parse(r.postData()));if(posts===1){status=503;data={error:'테스트 저장 실패'};}else data.caseKey=cases[0].CaseKey;}
    else if(r.url().includes('caseKey='))data.events=[{EventKey:1,AuthorName:'홍길동',Department:'영업부',Kind:'COMMENT',Body:'추가 불량 상태 확인 요청',CreatedAt:'2026-09-14T01:00:00Z',AfterStatus:'WAITING'}];
    else Object.assign(data,{cases,groups,excluded:2,canManage:true,author:{name:'테스트 수입부',department:'수입부'}});
   }
   r.respond({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  fs.mkdirSync('outputs/farm-quality',{recursive:true});
  const base=process.env.SMOKE_BASE_URL||'http://localhost:3015';
  for(const width of [1920,760,390]){
   await page.setViewport({width,height:1080,deviceScaleFactor:1});
   await page.goto(base+'/sales/farm-quality?popup=1',{waitUntil:'networkidle0'});
   await page.waitForSelector('.case');
   const dims=await page.evaluate(()=>({w:innerWidth,doc:document.documentElement.scrollWidth,side:document.querySelectorAll('[data-ui-sidebar]').length,top:document.querySelectorAll('[data-ui-topbar]').length}));
   assert(dims.doc<=width+2,JSON.stringify(dims));assert.equal(dims.side,0);
   await page.click('.case');await page.waitForSelector('.event-list article');
   assert(await page.$('.composer textarea'));
   await page.screenshot({path:`outputs/farm-quality/${width}.png`,fullPage:true});
  }
  await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
  await page.evaluate(()=>sessionStorage.removeItem('nvPopupWin'));
  await page.goto(base+'/sales/farm-quality',{waitUntil:'networkidle0'});
  await page.waitForSelector('.case');
  assert.equal(await page.$$eval('[data-ui-topbar]',a=>a.length),1);
  await page.click('.case');await page.waitForSelector('.event-list article');
  const box=await page.$eval('.composer',e=>({bottom:e.getBoundingClientRect().bottom,right:e.getBoundingClientRect().right}));
  assert(box.bottom<=1080&&box.right<=1920,JSON.stringify(box));
  await page.type('.composer textarea','보존되는 코멘트');await page.click('.composer .primary');
  await page.waitForFunction(()=>document.querySelector('[role=alert]')?.textContent.includes('테스트 저장 실패'));
  assert.equal(await page.$eval('.composer textarea',e=>e.value),'보존되는 코멘트');
  await page.click('.composer .primary');await page.waitForFunction(()=>document.querySelector('.success')?.textContent.includes('저장 완료'));
  assert.equal(requests[0].requestId,requests[1].requestId,'retry must reuse request id');
  assert.equal(posts,2);
  await page.evaluate(()=>[...document.querySelectorAll('.status-filters button')].find(e=>e.textContent.startsWith('미답변')).click());
  assert.equal(await page.$$eval('.case',a=>a.length),2);
  await page.evaluate(()=>[...document.querySelectorAll('main nav button')].find(e=>e.textContent==='불량 그래프').click());
  await page.waitForSelector('.chart-panels');
  const chartBounds=await page.$eval('.chart-panels',e=>({right:e.getBoundingClientRect().right,scroll:e.scrollWidth,client:e.clientWidth}));
  assert(chartBounds.right<=1920&&chartBounds.scroll<=chartBounds.client+2,JSON.stringify(chartBounds));
  await page.screenshot({path:'outputs/farm-quality/graphs-1920.png',fullPage:true});
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: 1920x1080 / 760 / 390; shell, overflow, detail, failure preservation, idempotent retry, unanswered filter, graphs');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

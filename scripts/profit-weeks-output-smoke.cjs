// Production-build browser fixture only. Every API intercepted; no ERP/SQL writes.
const assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core');
const fs=require('node:fs');
(async()=>{
 const {buildProfitReportXlsx}=await import('../lib/profitReportExcel.js');
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage();await page.setViewport({width:1920,height:1080});
  const calls=[],writes=[],errors=[];let failWeek=null,delayWeek=null;
  page.on('pageerror',e=>errors.push(e.message));
  await page.evaluateOnNewDocument(()=>{window.print=()=>{window.top.__prints=(window.top.__prints||0)+1;};});
  await page.setRequestInterception(true);
  page.on('request',async req=>{
   const url=new URL(req.url());if(!url.pathname.startsWith('/api/'))return req.continue();
   if(req.method()!=='GET'){writes.push(url.pathname);return req.respond({status:403,body:'blocked'});}
   const year=url.searchParams.get('year')||'2026',major=String(url.searchParams.get('week')||'29').padStart(2,'0');
   const rows=[{category:'에콰도르',auto:{N:1000,L:0,O:0,Q:100,S:0,R:1,H:0,E:200,F:0},manual:{},source:{}}];
   let data={success:true,rows:[],history:[],items:[]};
   if(url.pathname==='/api/auth/me')data={success:true,user:{userId:'fixture',role:'admin'}};
   if(url.pathname==='/api/sales/profit-report'){
    if(major===delayWeek)await new Promise(r=>setTimeout(r,800));
    data=major===failWeek?{success:false,error:'합성 조회 실패'}:{success:true,orderYear:year,major,rows,note:'문라이트1\n문라이트2',audit:{issues:[],errorCount:0,warningCount:0}};
   }
   if(url.pathname==='/api/sales/profit-report-output'){
    calls.push([year,major]);
    data={success:true,year,major,workbook:buildProfitReportXlsx({major,rows,note:'문라이트1\n문라이트2',visibleCols:url.searchParams.get('cols').split(',').filter(Boolean),displayCategory:url.searchParams.get('category')!=='0',displaySheetFirst:true,returnWorkbook:true})};
   }
   try{await req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});}catch{/* cancelled fixture request */}
  });
  const click=async text=>{const h=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===text),text);assert.ok(h.asElement(),text);await h.asElement().click();await h.dispose();};
  const fill=async(label,value)=>{const s=`input[aria-label="${label}"]`;await page.focus(s);await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.keyboard.type(value);assert.equal(await page.$eval(s,e=>e.value),value);};
  const printButton='[data-testid="profit-weeks-output"] [data-testid="profit-print-button"]';
  const ready=async()=>{try{await page.waitForFunction(s=>{const b=document.querySelector(s);return b&&!b.disabled;},{},printButton);}catch(e){console.error(await page.evaluate(()=>document.body.innerText.slice(0,5000)));throw e;}};
  await page.goto((process.argv[2]||'http://localhost:3218')+'/sales/profit-report?year=2026&week=29',{waitUntil:'networkidle0'});
  const categoryTitle=await page.$eval('h1',e=>e.textContent);
  await click('차수별');await ready();
  await fill('시작 차수','27');await fill('마지막 차수','29');
  assert.equal(await page.$eval(printButton,e=>e.disabled),true);
  await click('조회');await ready();
  assert.equal(await page.$eval('h1',e=>e.textContent),'📈 차수별 매출이익 보고서 — 27~29차 (2026)');
  assert.match(await page.$eval(printButton,e=>e.textContent),/3개 차수 · 3장/);
  assert.equal(await page.$eval('[data-testid="profit-weeks-output"]',e=>[...e.querySelectorAll('button')].some(b=>/^저장|확정/.test(b.textContent))),false);
  await page.click(printButton);await page.waitForFunction(()=>window.__prints===1);
  assert.deepEqual(calls,[['2026','27'],['2026','28'],['2026','29']]);calls.length=0;
  let frame=page.frames().find(f=>f.parentFrame());assert.match(await frame.content(),/문라이트1 · 문라이트2/);
  await page.click('[data-testid="profit-output-weeks"] summary');
  await page.$eval('[data-testid="profit-output-weeks"]',e=>[...e.querySelectorAll('label')].find(l=>l.textContent.trim()==='28차').click());
  await page.click(printButton);await page.waitForFunction(()=>window.__prints===2);
  assert.deepEqual(calls,[['2026','27'],['2026','29']]);calls.length=0;
  await fill('차수별 보고서 연도','2025');assert.equal(await page.$eval(printButton,e=>e.disabled),true);
  assert.equal(await page.$eval('h1',e=>e.textContent),'📈 차수별 매출이익 보고서 — 조회 범위 확인 필요');
  await click('조회');await ready();await page.click(printButton);await page.waitForFunction(()=>window.__prints===3);
  assert.equal(await page.$eval('h1',e=>e.textContent),'📈 차수별 매출이익 보고서 — 27~29차 (2025)');
  assert.ok(calls.every(c=>c[0]==='2025'));assert.equal(calls.length,3);calls.length=0;
  failWeek='28';await click('조회');await page.waitForFunction(()=>document.body.innerText.includes('28차 조회 실패'));
  assert.equal(await page.$eval(printButton,e=>e.disabled),true);assert.equal(calls.length,0);
  assert.equal(await page.$eval('h1',e=>e.textContent),'📈 차수별 매출이익 보고서 — 조회 범위 확인 필요');
  failWeek=null;delayWeek='28';await click('조회');await fill('마지막 차수','30');
  await new Promise(r=>setTimeout(r,1100));assert.equal(await page.$eval(printButton,e=>e.disabled),true);
  delayWeek=null;await click('조회');await ready();assert.match(await page.$eval(printButton,e=>e.textContent),/4개 차수/);
  assert.equal(await page.$eval('h1',e=>e.textContent),'📈 차수별 매출이익 보고서 — 27~30차 (2025)');
  await page.setViewport({width:390,height:900});
  const bounds=await page.$eval(printButton,e=>{const r=e.getBoundingClientRect();return [r.left,r.right,innerWidth];});assert.ok(bounds[0]>=0&&bounds[1]<=bounds[2]);
  fs.mkdirSync('.verify',{recursive:true});await page.screenshot({path:'.verify/profit-weeks-output-mobile.png',fullPage:true});
  await page.setViewport({width:1920,height:1080});
  await click('카테고리별');
  assert.equal(await page.$eval('h1',e=>e.textContent),categoryTitle);
  await page.type('textarea[maxlength="2000"]',' 미저장 초안');
  await click('차수별');
  assert.equal(await page.$eval(printButton,e=>e.disabled),true);
  assert.ok(await page.evaluate(()=>document.body.innerText.includes('미저장 변경을 저장하거나 취소')));
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log('PASS weeks output: loaded range/default/selection/2025 scope/partial failure/late response/direct print/note horizontal/390px; API writes=0');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

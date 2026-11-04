// API-isolated UI regression. Never connects test requests to the ERP database.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
(async()=>{
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage();await page.setViewport({width:1920,height:1080});
 const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 let rows=[
 {deductionKey:983,orderYear:2026,orderWeek:'42',rowVersionNo:1,custKey:565,customerName:'태림원예',prodKey:3389,productName:'그로우',matchedProductDbName:'그로우 규격없음',quantity:80,sourceUnit:'단',distributionCostUnit:'단',manualCostEditable:true,registrationEligible:false,registrationEligibilityCode:'COST_MISSING'},
 {deductionKey:926,orderYear:2026,orderWeek:'42',rowVersionNo:1,custKey:680,customerName:'라움',prodKey:181,productName:'Graciosa',quantity:1,sourceUnit:'송이',estimateKey:10499,missingLinkedEstimate:true,registrationEligible:false,registrationEligibilityCode:'LINKED_ESTIMATE_MISSING'},
 {deductionKey:1260,orderYear:2026,orderWeek:'44',rowVersionNo:1,custKey:689,customerName:'태림A',prodKey:2328,productName:'디디스커스',quantity:10,sourceUnit:'단',distributionCost:7500,registrationEligible:true,registrationEligibilityCode:'ELIGIBLE'}];
 await page.setRequestInterception(true);
 page.on('request',async req=>{
  const u=new URL(req.url());if(!u.pathname.startsWith('/api/'))return req.continue();
  let body={success:true,user:{userId:'fixture',userName:'fixture',authority:0},rows:[],managerOptions:[]};
  if(u.pathname==='/api/sales/defect-deductions'){
   const payload=req.postData()?JSON.parse(req.postData()):{};
   if(u.searchParams.get('view')==='support')body.rows=rows;
   if(u.searchParams.get('view')==='cost-candidates')body={success:true,keyword:'그로우',products:[{prodKey:3389,productName:'그로우 규격없음',current:true,unit:'단',costs:[]},{prodKey:3397,productName:'그로우 75-80cm',current:false,unit:'단',costs:[{cost:6200,customerName:'태림원예',year:2026,week:'41-01'},{cost:4000,customerName:'꽃길',year:2026,week:'42-01'}]}]};
   if(payload.action){writes.push(payload);if(payload.action==='manage-edit'){body.rows=[{noteOnly:false}];if(!payload.preview)rows[0]={...rows[0],...payload.changes,rowVersionNo:2,distributionCost:6200,registrationEligible:true,registrationEligibilityCode:'ELIGIBLE'};}else throw Error('unexpected write '+payload.action);}
  }
  await req.respond({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 const click=async text=>{for(const b of await page.$$('button'))if((await b.evaluate(e=>e.textContent)).includes(text)){await b.click();return;}throw Error('button missing: '+text);};
 await page.goto('http://localhost:3096/sales/defect-deductions?year=2026&week=44',{waitUntil:'networkidle0',timeout:180000});
 await click('영업지원 전산등록');await page.waitForFunction(()=>document.body.innerText.includes('등록 대상 (2건)'));
 assert.equal(await page.$eval('tbody',e=>e.innerText.includes('라움')),false);
 await click('보류 (1건)');await page.waitForFunction(()=>document.querySelector('tbody')?.innerText.includes('라움'));
 assert.equal(await page.$eval('tbody',e=>e.innerText.includes('태림원예')),false);
 assert.equal(await page.$eval('thead th:nth-child(2)',e=>e.textContent),'불량 차수');
 assert.equal(await page.$eval('.support-source-period',e=>e.textContent),'2026년 42차 불량');
 assert.equal(await page.$eval('.support-source-period',e=>getComputedStyle(e).display !== 'none' && Number(getComputedStyle(e).fontWeight)>=700),true);
 assert.match(await page.$eval('tbody',e=>e.innerText),/보류.*이전 차감 견적 없음/);
 for(const width of [1920,1000]) {
  await page.setViewport({width,height:1080});
  assert.equal(await page.$eval('.support-source-period',e=>e.getBoundingClientRect().right<=e.closest('td').getBoundingClientRect().right),true);
 }
 await page.setViewport({width:1920,height:1080});
 await page.screenshot({path:'C:/Users/USER/defect-held-week-local-1104.png',fullPage:true});
 await click('등록 대상');await page.waitForFunction(()=>document.querySelector('tbody')?.innerText.includes('태림원예'));
 await click('단가 직접입력');await page.waitForFunction(()=>document.body.innerText.includes('그로우 75-80cm'));
 const text=await page.$eval('[aria-label="최근 출고단가 후보"]',e=>e.innerText);
 assert.match(text,/6,200원\/단/);assert.match(text,/꽃길.*2026년 42-01차.*4,000원/);
 await page.focus('input[aria-label="출고단가 품목 검색"]');await page.keyboard.press('Tab');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.body.innerText.includes('그로우 75-80cm'));
 await page.focus('[aria-label="최근 출고단가 후보"] button');await page.keyboard.press('ArrowDown');assert.match(await page.evaluate(()=>document.activeElement.textContent),/이 출고 품목으로 매칭/);await page.keyboard.press('ArrowUp');assert.match(await page.evaluate(()=>document.activeElement.textContent),/출고단가 조회/);
 await page.screenshot({path:'C:/Users/USER/defect-cost-held-local-1104.png',fullPage:true});
 await click('이 출고 품목으로 매칭하고 재검사');await page.waitForSelector('[role="dialog"]',{hidden:true});
 assert.equal(writes.length,2);assert.equal(writes[0].preview,true);assert.equal(writes[1].preview,false);
 assert.deepEqual(writes[1].changes,{prodKey:3397,productName:'그로우 75-80cm'});
 assert.equal(rows[0].quantity,80);assert.equal(rows[1].estimateKey,10499);assert.equal(rows[1].missingLinkedEstimate,true);
 assert.deepEqual(errors,[]);console.log('UI PASS: held list separated; current/different product references with customer/week/unit; keyboard search; explicit rematch preview/save; quantity/deleted quote preserved; ERP writes=0');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

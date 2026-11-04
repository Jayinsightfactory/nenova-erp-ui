// Fully API-isolated: no ERP requests or writes reach a database.
const assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
(async()=>{
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox','--disable-gpu','--renderer-process-limit=1']});
 try{
 const page=await browser.newPage();await page.setViewport({width:1600,height:1000});
 const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 let rows=[
 {deductionKey:1,orderYear:2026,orderWeek:'42',rowVersionNo:2,custKey:565,customerName:'태림원예',prodKey:3389,productName:'그로우',quantity:80,sourceUnit:'단',registrationEligible:false,registrationEligibilityCode:'COST_MISSING',manualHoldHistoryKey:0},
 {deductionKey:2,orderYear:2026,orderWeek:'43',rowVersionNo:3,custKey:565,customerName:'태림원예',prodKey:2085,productName:'오션송',quantity:4,sourceUnit:'단',distributionCost:6500,registrationEligible:true,registrationEligibilityCode:'ELIGIBLE',manualHoldHistoryKey:0},
 {deductionKey:3,orderYear:2026,orderWeek:'42',rowVersionNo:8,custKey:680,customerName:'라움',prodKey:181,productName:'Graciosa',quantity:1,sourceUnit:'송이',estimateKey:10499,missingLinkedEstimate:true,registrationEligible:false,registrationEligibilityCode:'LINKED_ESTIMATE_MISSING'}];
 await page.setRequestInterception(true);
 page.on('request',async req=>{
 const u=new URL(req.url());if(!u.pathname.startsWith('/api/'))return req.continue();
 let body={success:true,user:{userId:'fixture',userName:'fixture',authority:0},rows:[],managerOptions:[]};
 if(u.pathname==='/api/sales/defect-deductions'){
  if(u.searchParams.get('view')==='support')body.rows=rows;
  const payload=req.postData()?JSON.parse(req.postData()):{};
  if(payload.action){
   assert.equal(payload.action,'support-hold');writes.push(payload);
   for(const selected of payload.rows){const r=rows.find(r=>r.deductionKey===selected.deductionKey);assert.equal(selected.sourceWeek,r.orderWeek);assert.equal(selected.expectedRowVersionNo,r.rowVersionNo);assert.equal(selected.expectedHoldHistoryKey,r.manualHoldHistoryKey);r.manualHeld=payload.hold;r.manualHoldHistoryKey++;r.registrationEligible=!payload.hold&&r.deductionKey===2;r.registrationEligibilityCode=payload.hold?'MANUAL_HOLD':r.deductionKey===2?'ELIGIBLE':'COST_MISSING';}
   body={success:true,changed:payload.rows.length,held:payload.hold};
  }
 }
 await req.respond({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 const click=async text=>{for(const b of await page.$$('button'))if((await b.evaluate(e=>e.textContent)).includes(text)){await b.click();return;}throw Error('missing button '+text);};
 const enabled=async text=>page.evaluate(text=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes(text))?.disabled===false,text);
 await page.goto('http://localhost:3096/sales/defect-deductions?year=2026&week=44',{waitUntil:'networkidle0',timeout:180000});
 await click('영업지원 전산등록');await page.waitForFunction(()=>document.body.innerText.includes('등록 대상 (2건)'));
 assert.equal(await page.$eval('input[aria-label="태림원예 그로우 선택"]',e=>e.disabled),false);
 await page.click('input[aria-label="보류 이동·해제 항목 전체 선택"]');
 assert.equal(await enabled('견적서관리에 불량차감 등록'),false);assert.equal(await enabled('선택 항목 보류로 이동'),true);
 await click('선택 항목 보류로 이동');await page.waitForFunction(()=>document.body.innerText.includes('등록 대상 (0건)'));
 assert.deepEqual(writes[0].rows.map(r=>r.deductionKey),[1,2]);assert.equal(writes[0].hold,true);
 await page.reload({waitUntil:'networkidle0'});await click('영업지원 전산등록');await page.waitForFunction(()=>document.body.innerText.includes('보류 (3건)'));await click('보류 (3건)');
 await page.waitForFunction(()=>document.querySelector('tbody')?.innerText.includes('담당자 보류'));
 assert.equal(await page.$eval('input[aria-label="라움 Graciosa 선택"]',e=>e.disabled),true);
 assert.match(await page.$eval('tbody',e=>e.innerText),/2026년 42차 불량/);
 await page.screenshot({path:'C:/Users/USER/defect-manual-hold-local-1104.png',fullPage:true});
 await page.click('input[aria-label="보류 이동·해제 항목 전체 선택"]');await click('선택 보류 해제');await page.waitForFunction(()=>document.body.innerText.includes('등록 대상 (2건)'));
 assert.equal(writes.length,2);assert.equal(writes[1].hold,false);assert.deepEqual(writes[1].rows.map(r=>r.expectedHoldHistoryKey),[1,1]);
 assert.equal(rows[0].quantity,80);assert.equal(rows[1].quantity,4);assert.equal(rows[2].estimateKey,10499);assert.equal(rows[2].missingLinkedEstimate,true);assert.deepEqual(errors,[]);
 console.log('UI PASS: issue checkboxes, mixed selection register blocked, bulk hold, reload persists, source week, manual-only resume, audit descriptors, quantity and system-held quote preserved; ERP writes=0');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

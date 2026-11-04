// Local UI fixture only. Every API is intercepted; no operational data is written.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
(async () => {
 const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
 try {
 const page=await browser.newPage(); await page.setViewport({width:1440,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let rows=[1,2,3,4,5].map(id=>({deductionKey:id,orderYear:2026,orderWeek:'43',rowVersionNo:1,custKey:100+id,prodKey:200+id,customerName:`검증업체${id}`,productName:`검증품목${id}`,quantity:10,sourceUnit:'단',distributionCost:10000,distributionCostUnit:'단',manualCostEditable:true,registrationEligible:true,registrationEligibilityCode:'ELIGIBLE'}));
 rows[1]={...rows[1],distributionCost:null,registrationEligible:false,registrationEligibilityCode:'COST_MISSING',registrationError:'단가 없음'};
 rows[2]={...rows[2],prodKey:null,registrationEligible:false,registrationEligibilityCode:'CUSTOMER_SALE_MISSING',registrationError:'미매칭'};
 rows[3]={...rows[3],custKey:101,prodKey:201};
 rows[4]={...rows[4],sourceFactReview:true,registrationEligible:false,registrationEligibilityCode:'SOURCE_FACT_REVIEW_REQUIRED',registrationError:'원문 대조 필요'};
 let savedCost=false, savedMatch=false, failLoad=false; const registrations=[];
 const preview=r=>({...r,sourceOrderYear:2026,sourceOrderWeek:'43',after:{AppliedOrderYear:2026,AppliedOrderWeek:'44',ShipmentKey:r.custKey,ProdKey:r.prodKey,ProdName:r.productName,Quantity:-10,Unit:'단',Cost:r.distributionCost,Amount:-90909,Vat:-9091}});
 await page.setRequestInterception(true);
 page.on('request', async req=>{
  const url=new URL(req.url());if(!url.pathname.startsWith('/api/'))return req.continue();
  let body={success:true,user:{userId:'fixture',userName:'검증',authority:0},rows:[]};let status=200;
  if(url.pathname==='/api/sales/defect-deductions'){
   const payload=req.postData()?JSON.parse(req.postData()):{};
   if(url.searchParams.get('view')==='support'){body.rows=rows;if(failLoad){status=500;body={error:'재조회 실패 fixture'};}}
   if(url.searchParams.get('view')==='registration-preview')body.rows=url.searchParams.get('ids').split(',').map(Number).map(id=>preview(rows.find(r=>r.deductionKey===id)));
   if(url.searchParams.get('view')==='lookups')body.products=[{ProdKey:203,ProdName:'매칭완료품목',FlowerName:'카네이션'}];
   if(payload.action==='manual-cost-save'){assert.equal(payload.expectedRowVersionNo,1);rows[1]={...rows[1],distributionCost:Number(payload.cost),registrationEligible:true,registrationEligibilityCode:'ELIGIBLE',registrationError:'',rowVersionNo:2};savedCost=true;}
   if(payload.action==='manage-edit'){body.rows=[{noteOnly:false}];if(!payload.preview){rows[2]={...rows[2],...payload.changes,registrationEligible:true,registrationEligibilityCode:'ELIGIBLE',registrationError:'',rowVersionNo:2};savedMatch=true;}}
   if(payload.action==='review-source'){assert.equal(payload.rows[0].evidence.messageOrdinal,1);assert.match(payload.rows[0].evidence.sourceSha256,/^[a-f0-9]{64}$/);if(!payload.preview)rows[4]={...rows[4],sourceFactReview:false,registrationEligible:true,registrationEligibilityCode:'ELIGIBLE',registrationError:'',rowVersionNo:2};}
   if(payload.action==='register'){registrations.push(payload.ids);status=409;body={error:'fixture: intercepted register; no production writes'};}
  }
  await req.respond({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await page.goto('http://localhost:3094/sales/defect-deduction-register-review?year=2026&week=44&ids=1,2,3,4,5&support=1&resolve=1&popup=1',{waitUntil:'networkidle0',timeout:180000});
 const click=async text=>{const buttons=await page.$$('button');for(const button of buttons){if((await button.evaluate(e=>e.textContent)).includes(text)){await button.click();return;}}throw Error('missing button '+text);};
 await page.waitForFunction(()=>document.body.innerText.includes('단가를 입력하세요'));
 assert.match(await page.$eval('body',e=>e.innerText),/같은 수량의 신고 2건/);
 await page.type('input[aria-label="검증업체2 단가"]','12500');await click('단가 저장하고 재검사');
 await page.waitForFunction(()=>document.body.innerText.includes('정상 1건 등록하기'));assert.equal(savedCost,true);
 await click('업체·품목 매칭 / 수량 수정');
 await page.waitForSelector('input[aria-label="업체 품목 검색"]');
 await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='업체 품목 검색');
 await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'업체 품목 검색');
 await page.keyboard.press('Escape');await page.waitForSelector('input[aria-label="업체 품목 검색"]',{hidden:true});assert.match(await page.evaluate(()=>document.activeElement.textContent),/업체·품목 매칭/);
 await page.keyboard.press('Enter');await page.waitForSelector('input[aria-label="업체 품목 검색"]');await page.type('input[aria-label="업체 품목 검색"]','매칭완료');await click('검색');
 await page.waitForFunction(()=>document.body.innerText.includes('매칭완료품목'));await click('매칭완료품목');await click('수정 저장하고 재검사');
 await page.waitForFunction(()=>document.body.innerText.includes('정상 2건 등록하기'));assert.equal(savedMatch,true);
 await click('같은 신고입니다');await page.waitForFunction(()=>document.body.innerText.includes('정상 3건 등록하기'));
 await click('보류 ');
 await page.locator('summary').click();
 const fixture=path.join(os.tmpdir(),'nenova-defect-source-ui-fixture.txt');
 fs.writeFileSync(fixture,'네노바 수입(불량 공유방) 님과 카카오톡 대화\n--------------- 2026년 10월 30일 금요일 ---------------\n[검증] [오후 1:00] 43-1 검증업체5 검증품목5 10단\n');
 await (await page.$('input[type=file]')).uploadFile(fixture);
 await page.waitForSelector('input[aria-label="원문 메시지 검색"]');await page.type('input[aria-label="원문 메시지 검색"]','검증업체5');
 await page.select('select[aria-label="대조할 원문 메시지"]','1');await page.type('textarea','검증용 원문과 업체 품목 수량 단위가 일치함');
 await page.click('fieldset input[type=checkbox]');await click('원문 대조 저장하고 재검사');
 await page.waitForFunction(()=>document.body.innerText.includes('정상 4건 등록하기'));fs.unlinkSync(fixture);
 await click('등록 예정 품목');
 await page.screenshot({path:'C:/Users/USER/defect-resolution-local-smoke.png',fullPage:true});
 page.on('dialog',d=>d.accept());await click('정상 4건 등록하기');
 await page.waitForFunction(()=>document.body.innerText.includes('fixture: intercepted register'));
 assert.deepEqual(registrations,[[1,2,3,5]],'only resolved rows sent, duplicate excluded');
 failLoad=true;await click('새로 불러오기');await page.waitForFunction(()=>document.body.innerText.includes('재조회 실패 fixture'));
 assert.equal(await page.$$eval('button',bs=>bs.find(b=>b.textContent.includes('정상 4건 등록하기')).disabled),true);
 assert.deepEqual(errors,[]);console.log('UI PASS: missing price, matching, source file/message review, duplicate selection, exact register IDs, failed reload disables write; all API intercepted');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

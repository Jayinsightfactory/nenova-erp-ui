// Local-only real PDF UI check. All API calls are intercepted; external requests abort.
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const base='http://127.0.0.1:33179';
 const evidence=JSON.parse(fs.readFileSync(process.env.PACKING_UI_EVIDENCE,'utf8'));
 const browser=await require('puppeteer-core').launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
 const context=await browser.createBrowserContext();await context.setCookie({name:'nenovaToken',value:require('jsonwebtoken').sign({userId:'fixture',authority:1,accountActive:true},'isolated-packing-next-test-only'),url:base});
 const page=await context.newPage();await page.setViewport({width:1920,height:1080});const dialogs=[],errors=[];
 page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});page.on('pageerror',e=>errors.push(e.message));
 await page.setRequestInterception(true);page.on('request',async r=>{const u=new URL(r.url());if(['data:','blob:'].includes(u.protocol))return r.continue();if(u.origin!==base)return r.abort();if(!u.pathname.startsWith('/api/'))return r.continue();let d={success:true,rows:[],items:[],value:null,revision:0};if(u.pathname==='/api/auth/me')d={success:true,user:{userId:'fixture',authority:1,accountActive:true}};if(u.pathname==='/api/import/tools/product-matches')d={success:true,...evidence.catalog};if(u.pathname==='/api/import/tools/upload-history')d={success:true,record:{id:'fixture'},rows:[]};await r.respond({status:200,contentType:'application/json',body:JSON.stringify(d)});});
 const click=async text=>{await page.waitForFunction(t=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===t&&!b.disabled),{timeout:15000},text);await page.evaluate(t=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===t).click(),text);};
 const set=async(sel,v)=>page.$eval(sel,(e,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},v);
 await page.goto(base+'/import/tools?popup=1',{waitUntil:'networkidle0'});console.log('PAGE');await page.click('button[aria-label="중국"]');await(await page.$('input[accept*=".pdf"]')).uploadFile(process.env.PACKING_UI_PDF);await click('패킹 리스트 생성');console.log('GENERATE');
 try{
 await page.waitForSelector('[data-testid="packing-review-open"]',{timeout:30000});await page.click('[data-testid="packing-review-open"]');await page.waitForSelector('[data-testid="metadata-date"]',{timeout:15000});
 const date=process.env.PACKING_UI_DATE||'2026-10-04';
 await set('[data-testid="metadata-date"]',date);await click('수정값 적용 · 결과 재생성');await page.waitForSelector('[data-testid="packing-review-blocked"]');
 assert.match(dialogs.at(-1),/인쇄 날짜 확인 사유/);assert.match(await page.$eval('[data-testid="packing-review-blocked"]',e=>e.innerText),/인쇄 날짜 확인 사유/);assert.equal(await page.$eval('[data-testid="metadata-date"]',e=>e.value),date);
 await page.screenshot({path:'.test-blocked.png'});
 await set('[data-testid="metadata-reason-date"]','TEST_ONLY 원문 날짜 확인');await click('수정값 적용 · 결과 재생성');
 await new Promise(r=>setTimeout(r,300));const summary=await page.$('[data-testid="packing-review-blocked"]');if(summary)assert.doesNotMatch(await summary.evaluate(e=>e.innerText),/인쇄 날짜 확인 사유/);assert.deepEqual(errors,[]);
 console.log('PASS: popup + inline blocker; date retained; reason resolves date blocker; remaining validation preserved; no ERP requests sent');
 }catch(e){await page.screenshot({path:'.test-browser-failure.png'});console.log((await page.$eval('body',e=>e.innerText)).slice(-3500));throw e;}
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

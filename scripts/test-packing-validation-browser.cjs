// Actual local web upload + original PDF render + correction. All APIs mocked;
// no production writes, paid AI, or claim that unresolved DB matches are complete.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
(async()=>{
 const listener=require('node:net').createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const base=`http://127.0.0.1:${port}`,secret=randomUUID(),env={...process.env,JWT_SECRET:secret};
 for(const k of Object.keys(env))if(/^(DB_|MSSQL|SQL_|NENOVAWEB_SERVICE)/.test(k))delete env[k];
 const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port)],{env,stdio:'ignore',windowsHide:true});
 let browser;const errors=[],calls=[];const catalog=JSON.parse(fs.readFileSync('.test-packing-catalog.json','utf8'));
 try{
  for(let i=0;i<100;i++){try{await fetch(base);break;}catch{}await new Promise(r=>setTimeout(r,300));}
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.createBrowserContext();await context.setCookie({name:'nenovaToken',value:jwt.sign({userId:'local-validation',userName:'Local test',authority:1,accountActive:true},secret,{expiresIn:'20m'}),url:base});
  const page=await context.newPage();await page.setViewport({width:1920,height:1080});page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',req=>{
   const u=new URL(req.url());if(u.protocol==='blob:'||u.protocol==='data:')return req.continue();
   if(u.origin!==base)return req.abort();if(!u.pathname.startsWith('/api/'))return req.continue();
   calls.push({path:u.pathname,method:req.method()});
   let data={success:true,rows:[],history:[],items:[],value:null,revision:0};
   if(u.pathname==='/api/auth/me')data={success:true,user:{userId:'local-validation',authority:1,accountActive:true}};
   if(u.pathname==='/api/import/tools/product-matches')data={success:true,scope:'team',...catalog,revision:0};
   if(u.pathname==='/api/import/tools/upload-history')data={success:true,record:{id:'local-history'},rows:[]};
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(base+'/import/tools?popup=1',{waitUntil:'networkidle0'});
  await page.click('button[aria-label="중국"]');await(await page.$('input[accept*=".pdf"]')).uploadFile('C:/Users/USER/Documents/카카오톡 받은 파일/41-1 중국 해상 ci1.pdf');
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='패킹 리스트 생성'&&!b.disabled));
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='패킹 리스트 생성').click());
  await page.waitForSelector('[data-testid="packing-validation-issues"]',{timeout:60000});
  const text=await page.$eval('[data-testid="packing-validation-issues"]',x=>x.innerText);assert.match(text,/4\/10\/2026/);assert.match(text,/101/);assert.match(text,/단가/);
  await page.screenshot({path:'.validation-issues-browser.png',fullPage:false});
  await page.$eval('[data-testid="packing-validation-issues"] button',b=>b.click());
  await page.waitForFunction(()=>document.activeElement?.id==='metadata-date-0');
  const set=async(selector,value)=>{await page.$eval(selector,(el,v)=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);};
  await set('[data-testid="metadata-date"]','2026-10-04');await set('[data-testid="metadata-reason-date"]','격리 테스트: 원문 날짜 확인');
  await set('[data-testid="metadata-reason-invoice_total"]','격리 테스트: 원본 총액 검산');
  await set('[data-source-row-key="0:100"] input[aria-label$=" 단가"]','0');
  await set('[data-source-row-key="0:100"] input[aria-label$=" 금액"]','0');
  await set('[data-source-row-key="0:100"] input[aria-label$=" 수정 사유"]','격리 테스트: 원문 대시를 명시0으로 확인한 시나리오');
  await page.waitForFunction(()=>document.querySelector('[data-pdf-ready="true"]'),{timeout:30000});
  await page.screenshot({path:'.validation-edit-browser.png',fullPage:false});
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('수정값 적용 · 결과 재생성')).click());
  await page.waitForFunction(()=>!document.querySelector('[role="dialog"][aria-label*="metadata"]'),{timeout:30000});
  assert.equal(await page.$('[data-testid="packing-validation-issues"]'),null);
  assert.equal(await page.$('[data-testid="packing-receipt-prepare"]'),null,'unresolved DB matches must remain blocked');
  assert.equal(calls.filter(c=>/parse-pdf|receipts.*commit/.test(c.path)).length,0);
  assert.deepEqual(errors,[]);await page.screenshot({path:'.validation-corrected-browser.png',fullPage:false});
  console.log('PASS actual 7-page PDF browser upload, 101-row diagnostics, direct correction, actual PDF render, regenerated results; unresolved DB matches remain blocked; zero AI/ERP writes.');
 }finally{await browser?.close();child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});

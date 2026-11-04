const assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),jwt=require('jsonwebtoken'),puppeteer=require('puppeteer-core');
async function main(){
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const secret=crypto.randomUUID(),base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port)],{env:{...process.env,DB_SERVER:'',JWT_SECRET:secret},stdio:'ignore',windowsHide:true});
 let browser;
 try{
  for(let n=0;n<45;n++){try{if((await fetch(base+'/login')).status===200)break;}catch{}if(n===44)throw Error('Local server did not start');await new Promise(r=>setTimeout(r,1000));}
  browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
  const page=await browser.newPage(),errors=[],writes=[];await page.setViewport({width:1920,height:1080});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  const user={userId:'fixture',userName:'화면 검증',authority:1,deptName:'수입부',accountActive:true};
  await page.setCookie({name:'nenovaToken',value:jwt.sign(user,secret,{expiresIn:'10m'}),url:base});
  const master={WarehouseKey:7970,OrderYear:'2026',OrderWeek:'41-01',FarmName:'Fixture Farm',InvoiceNo:'TEST-1',InputDate:'2026-10-01',UploadDtm:'2026-10-03',totalBox:2};
  await page.setRequestInterception(true);page.on('request',r=>{
   const u=new URL(r.url());if(u.origin!==base)return r.abort();if(!u.pathname.startsWith('/api/'))return r.continue();
   if(!['GET','HEAD'].includes(r.method())&&u.pathname.startsWith('/api/warehouse'))writes.push(u.pathname);
   let d={success:true,items:[],rows:[],data:[],products:[],countries:[],records:[],history:[],references:[],options:[],requests:[],permissions:{request:true,review:true},value:null,revision:0};
   if(u.pathname==='/api/auth/me')d.user=user;
   if(u.pathname==='/api/warehouse')d.masters=[master];
   if(u.pathname==='/api/warehouse/correction')d={success:true,draftOwner:'fixture',header:master,details:[{WdetailKey:1,ProdKey:1,OutQuantity:2}],farms:[{FarmName:'Fixture Farm'}],history:[]};
   if(u.pathname==='/api/warehouse/invoice-costs')d.costs=null;
   return r.respond({status:200,contentType:'application/json',body:JSON.stringify(d)});
  });
  const click=async(text,scope='body')=>{const h=await page.evaluateHandle(({text,scope})=>[...document.querySelector(scope).querySelectorAll('button,a')].find(b=>b.textContent.trim()===text),{text,scope});assert(h.asElement(),`Missing ${text}`);await h.asElement().focus();await page.keyboard.press('Enter');await h.dispose();};
  await page.goto(base+'/incoming?warehouseKey=7970&from=2026-10-01&to=2026-11-30',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='농장·품목 수정 / 파일 교체'&&!b.disabled));
  const href=await page.$eval('a[href*="tab=incoming"]',a=>a.href);assert.equal(new URL(href).searchParams.get('warehouseKey'),'7970');
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle0'}),click('입고 정정 업무')]);
  await page.waitForSelector('#import-panel-incoming:not([hidden]) [data-row-key="7970"]');
  assert.equal(new URL(page.url()).searchParams.get('tab'),'incoming');assert.equal(await page.$$eval('.sidebar',e=>e.length),1);
  await page.focus('nav[aria-label="수입부 업무도구"] button');await page.keyboard.press('ArrowRight');assert(await page.evaluate(()=>document.activeElement.textContent.includes('입고 조회·수정')));await page.keyboard.press('Space');
  await click('농장·품목 수정 / 파일 교체','#import-panel-incoming');await page.waitForSelector('dialog[open] select[aria-label="수정 농장"]');
  assert(await page.$eval('dialog',e=>e.textContent.includes('#7970')));await page.keyboard.press('Tab');await page.keyboard.down('Shift');await page.keyboard.press('Tab');await page.keyboard.up('Shift');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'농장·품목 수정 / 파일 교체');
  await click('업무도구로 돌아가기','#import-panel-incoming');await page.waitForSelector('#import-panel-packing:not([hidden])');await click('입고 정정 업무');
  await page.waitForSelector('#import-panel-incoming:not([hidden])');assert.equal(await page.$eval('#import-panel-incoming button',()=>new URL(location.href).searchParams.get('tab')),'incoming');
  await click('농장·품목 수정 / 파일 교체','#import-panel-incoming');await page.waitForSelector('dialog[open]');await page.keyboard.press('Escape');
  fs.mkdirSync('.verify',{recursive:true});await page.screenshot({path:'.verify/incoming-tools-desktop.png'});
  await page.setViewport({width:390,height:844});await click('농장·품목 수정 / 파일 교체','#import-panel-incoming');await page.waitForSelector('dialog[open]');assert(await page.$eval('dialog',d=>{const r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));await page.screenshot({path:'.verify/incoming-tools-mobile.png'});await page.keyboard.press('Escape');
  await page.setViewport({width:1920,height:1080});await page.goto(base+'/import/tools?tab=incoming&popup=1&warehouseKey=7970&from=2025-10-01&to=2025-11-30',{waitUntil:'networkidle0'});
  await page.waitForSelector('#import-panel-incoming:not([hidden])');assert.equal(await page.$$eval('.sidebar',e=>e.length),0);assert.equal(new URL(page.url()).searchParams.get('from'),'2025-10-01');assert.equal(new URL(page.url()).searchParams.get('popup'),'1');
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);console.log('PASS: incoming entry, tools quick button/tab, selected receipt, tab return, popup/year filters, correction modal/Escape/focus, desktop/mobile; ERP writes 0');
 }finally{if(browser)await browser.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

// Real Chromium UI, synthetic authentication responses only; never logs in to a business account.
const assert=require('node:assert/strict'),puppeteer=require('puppeteer-core');
(async()=>{
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const context=await browser.createBrowserContext(),page=await context.newPage(),sent=[];
  await page.setRequestInterception(true);
  page.on('request',req=>{
   if(!new URL(req.url()).pathname.startsWith('/api/'))return req.continue();
   if(req.method()==='POST'){assert.equal(new URL(req.url()).pathname,'/api/auth/login');sent.push(JSON.parse(req.postData()).rememberDevice);}
   return req.respond({status:200,contentType:'application/json',body:JSON.stringify({success:false,error:'Synthetic verification only'})});
  });
  for(const route of ['/login','/m/login']){
   await page.setViewport(route==='/login'?{width:1280,height:900}:{width:390,height:844});
   await page.goto((process.argv[2]||'http://localhost:3221')+route,{waitUntil:'networkidle0'});
   assert.equal(await page.$eval('input[type="checkbox"]',e=>e.checked),false);
   await page.type('input[autocomplete="username"]','fixture');await page.type('input[type="password"]','fixture-password-only');
   const before=sent.length;await page.click('button[type="submit"]');
   await page.waitForFunction(()=>!document.querySelector('button[type="submit"]').disabled);
   assert.deepEqual(sent.slice(before),[false]);
   await page.click('input[type="checkbox"]');await page.click('button[type="submit"]');
   await page.waitForFunction(()=>!document.querySelector('button[type="submit"]').disabled);
   assert.deepEqual(sent.slice(before),[false,true]);
   assert.ok(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('fixture-password-only'));
   await page.reload({waitUntil:'networkidle0'});assert.equal(await page.$eval('input[type="checkbox"]',e=>e.checked),false);
  }
  console.log('PASS Chromium: desktop/mobile unchecked defaults, explicit true/false login payloads, no password storage; real authentication requests=0');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});

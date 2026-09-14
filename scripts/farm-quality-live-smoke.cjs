// Read-only production verification. Only login is POST; no quality/ERP mutations.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const puppeteer=require(process.env.PUPPETEER_CORE_PATH||'puppeteer-core');
(async()=>{
 const base=process.env.SMOKE_BASE_URL||'https://nenovaweb.com';
 if(!process.env.SMOKE_USER||!process.env.SMOKE_PASS)throw Error('Configured smoke credentials required');
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:process.env.SMOKE_USER,password:process.env.SMOKE_PASS})});
 assert.equal(login.status,200,'login');const auth=await login.json();assert(auth.token,'token');
 const r=await fetch(base+'/api/sales/farm-quality?year=2026',{headers:{Authorization:`Bearer ${auth.token}`}});
 assert.equal(r.status,200,'quality API');const data=await r.json();assert(data.success&&Array.isArray(data.groups)&&Array.isArray(data.cases));
 console.log(JSON.stringify({liveRead:'passed',groups:data.groups.length,cases:data.cases.length}));
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({width:1920,height:1080,deviceScaleFactor:1});
  await page.setCookie({name:'nenovaToken',value:auth.token,url:base,httpOnly:true,secure:base.startsWith('https')});
  await page.goto(base+'/sales/farm-quality?popup=1',{waitUntil:'networkidle0'});
  await page.waitForSelector('.status-filters');assert.equal(await page.$$eval('[data-ui-popupbar]',a=>a.length),1);
  assert.equal(await page.$$eval('[role=alert]',a=>a.length),0);
  await page.evaluate(()=>[...document.querySelectorAll('main nav button')].find(e=>e.textContent==='불량 그래프').click());
  await page.waitForSelector('.chart-panels');
  const bounds=await page.$eval('.chart-panels',e=>({right:e.getBoundingClientRect().right,scroll:e.scrollWidth,client:e.clientWidth}));
  assert(bounds.right<=1920&&bounds.scroll<=bounds.client+2,JSON.stringify(bounds));
  fs.mkdirSync('outputs/farm-quality',{recursive:true});await page.screenshot({path:'outputs/farm-quality/live-1920.png',fullPage:true});
  assert.equal(errors.length,0,errors.join('\n'));console.log('Live 1920x1080: authenticated page, graph, shell and overflow passed; no business writes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

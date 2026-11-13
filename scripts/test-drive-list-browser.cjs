'use strict';
// Actual Next screen + HTTP response, isolated loopback fixtures only. Never
// authenticates to ERP, invokes a stored-file write, or opens remote endpoints.
process.env.NODE_ENV='development';process.env.NEXT_TELEMETRY_DISABLED='1';process.env.NEXT_DIST_DIR='.verify/next-drive-list-fixture';
process.env.NENOVA_WORK_LOGS='0';for(const key of ['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'])process.env[key]='';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const next=require('next'),puppeteer=require('puppeteer-core'),{sendDriveListJson}=require('../lib/workDriveListResponse.cjs');
const files=Array.from({length:12000},(_,i)=>({id:'fixture-'+i,filename:'fixture-'+i+'.xlsx',rel:'originals/fixture-'+i+'.xlsx',sha:'fixture-sha-'+i,ext:'xlsx',cycle:String(1+i%48)+'-1',stage:'발주',dept:'fixture',uploaderName:'fixture',hostname:'fixture-pc',sourceDir:'synthetic/'+'.'.repeat(460),uploadedAt:'2026-11-01T00:00:00Z',mtime:'2026-11-01T00:00:00Z',size:1024,version:1,canDownload:true,confidence:0.9}));
const payload={success:true,me:'fixture',dept:'fixture',isAdmin:true,stages:['발주','입고'],files,usage:{used:12288000,max:107374182400,pct:0.01,files:12000,onDisk:12288000,onDiskPct:0.01,indexedNaive:12288000}};
let app,server,browser,mode='table',requests=0,pendingUsage=[];
function releaseUsage(){for(const res of pendingUsage.splice(0)){res.setHeader('Content-Type','application/json');res.statusCode=mode==='failure'?503:200;res.end(JSON.stringify(mode==='failure'?{success:false,error:'fixture usage failure'}:{success:true,usage:mode==='zero'?{used:0,max:100,files:0,onDisk:0,onDiskPct:0,indexedNaive:0,pct:0}:payload.usage}));}}const errors=[],results=[];
(async()=>{
 app=next({dev:true,webpack:true,dir:process.cwd()});await app.prepare();const handle=app.getRequestHandler();
 server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/api/work/drive'){
   if(url.searchParams.get('usage')==='only'){pendingUsage.push(res);return;}
   requests++;assert.equal(url.searchParams.get('format'),'table-v1');assert.equal(url.searchParams.get('usage'),'deferred');res.setHeader('Cache-Control','no-store');
   return void sendDriveListJson(res,{...payload,usage:mode==='legacy'?payload.usage:null},{table:mode!=='legacy'}).catch(()=>res.destroy());
  }
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/api/auth/me'?{success:true,user:{userId:'fixture',userName:'fixture'}}:{success:true,items:[],rows:[],favorites:[]}));return;}
  return handle(req,res);
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage();await page.setViewport({width:1920,height:1080});
 page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());return url.hostname==='127.0.0.1'||['data:','about:','blob:'].includes(url.protocol)?request.continue():request.abort();});
 const url='http://127.0.0.1:'+server.address().port+'/work/drive?popup=1';
 for(const format of ['table','legacy','failure','zero']){
  mode=format;const started=performance.now();await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('.wd .sub')?.textContent.includes('12,000'),{timeout:60000});
  const firstMs=performance.now()-started;await page.waitForFunction(()=>document.querySelector('.wd .sub')?.textContent.includes('12,000'));
  assert(pendingUsage.length>0,'Usage must still be pending after files are visible');
  if(format!=='legacy')assert((await page.$eval('.wd .sub',e=>e.textContent)).includes('사용량 확인 중'));
  await page.type('.wd .search input','fixture-11999');await page.waitForSelector('.lst tbody tr');assert.equal(await page.$eval('.lst tbody',element=>element.querySelectorAll('tr').length),1);await page.click('.lst tbody tr');await page.waitForSelector('.right a.btn');assert((await page.$eval('.right a.btn',element=>element.getAttribute('href'))).includes('download=fixture-11999'));
  releaseUsage();await page.waitForFunction(mode=>document.querySelector('.wd .sub')?.textContent.includes(mode==='failure'?'사용량 확인 실패':mode==='zero'?'(0%)':'사용량 '),{},format);
  assert((await page.$eval('.wd .sub',e=>e.textContent)).includes('12,000'),'Usage failure/zero must not discard files');
  const prior=requests;await page.click('button[title="새로고침"]');await page.waitForFunction(()=>document.querySelector('.wd .sub')?.textContent.includes('12,000'));await new Promise(resolve=>setTimeout(resolve,300));assert(requests>prior);assert(pendingUsage.length>0);releaseUsage();
  results.push({format,firstMs:Math.round(firstMs),files:12000,searchMatched:1,downloadLink:true,filesUsableBeforeUsage:true,refreshWhileUsagePending:true});
 }
 assert.deepEqual(errors,[]);fs.mkdirSync('.verify',{recursive:true});fs.writeFileSync(path.join('..','drive-list-deferred-browser.json'),JSON.stringify({viewport:'1920x1080',results,errors},null,2));console.log(JSON.stringify({results,errors},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();for(const res of pendingUsage.splice(0))res.destroy();if(server)await new Promise(resolve=>server.close(resolve));if(app)await app.close();process.exit(process.exitCode||0);});

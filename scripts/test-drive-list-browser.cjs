'use strict';
const {buildSearchWindow}=require('../lib/workDriveSearch.cjs');
require('node:module').register(require('node:url').pathToFileURL(require('node:path').join(process.cwd(),'scripts/work-drive-esm-loader.mjs')));
let categories;
// Real Next screen, loopback synthetic catalog only. No ERP authentication/write.
process.env.NODE_ENV='development';process.env.NEXT_TELEMETRY_DISABLED='1';process.env.NEXT_DIST_DIR='.verify/next-drive-list-fixture';process.env.NENOVA_WORK_LOGS='0';for(const key of ['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD'])process.env[key]='';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),next=require('next'),puppeteer=require('puppeteer-core'),{sendDriveListJson}=require('../lib/workDriveListResponse.cjs');
const files=Array.from({length:20820},(_,i)=>({id:'fixture-'+i,filename:'fixture-'+i+'.xlsx',rel:'originals/fixture-'+i+'.xlsx',sha:'fixture-sha-'+i,ext:'xlsx',cycle:String(1+i%48)+'-1',stage:'발주',dept:'fixture',uploaderName:'fixture',hostname:'fixture-pc',sourceDir:'synthetic/'+'.'.repeat(100),uploadedAt:'2026-11-01T00:00:00Z',mtime:'2026-11-01T00:00:00Z',size:1024,version:1,canDownload:true,confidence:0.9}));
const usage={used:files.length*1024,max:107374182400,pct:0.01,files:files.length,onDisk:files.length*1024,onDiskPct:0.01,indexedNaive:files.length*1024},base={success:true,me:'fixture',dept:'fixture',isAdmin:true,stages:['발주','입고'],usage:null};
let app,server,browser,page,mode='progressive',searchFailures=0,lastSearchWindow=null,pendingFull=[],pendingUsage=[],previewRequests=0,fullRequests=0;const errors=[],results=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await delay(10);}throw Error('Fixture request did not arrive');}
function send(res,payload,table=true){return sendDriveListJson(res,payload,{table}).catch(()=>res.destroy());}
function finishFull(entries=pendingFull.splice(0),status=200,extra={}){for(const {res}of entries){if(res.destroyed)continue;if(status!==200){res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:false,error:status===403?'fixture permission changed':'fixture temporary failure'}));}else void send(res,{...base,files,catalog:{complete:true,totalFiles:files.length},...extra});}}
function finishUsage(){for(const res of pendingUsage.splice(0)){if(res.destroyed)continue;res.setHeader('Content-Type','application/json');res.statusCode=mode==='usage-failure'?503:200;res.end(JSON.stringify(mode==='usage-failure'?{success:false,error:'fixture usage failure'}:{success:true,usage:mode==='zero'?{...usage,used:0,pct:0}:usage}));}}
async function navigate(nextMode){for(const {res}of pendingFull.splice(0))res.destroy();for(const res of pendingUsage.splice(0))res.destroy();mode=nextMode;await page.goto('http://localhost:'+server.address().port+'/work/drive?popup=1',{waitUntil:'domcontentloaded'});await page.waitForSelector('.wd .card,.wd .lst tbody tr',{timeout:60000});}
(async()=>{
 categories=await import(require('node:url').pathToFileURL(path.join(process.cwd(),'lib/workDriveCategories.js')));
 app=next({dev:true,webpack:true,dir:process.cwd()});await app.prepare();const handle=app.getRequestHandler();
 server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/api/work/drive'){
   res.setHeader('Cache-Control','no-store');if(url.searchParams.get('usage')==='only'){pendingUsage.push(res);return;}
   assert.equal(url.searchParams.get('format'),'table-v1');assert.equal(url.searchParams.get('usage'),'deferred');
   if(url.searchParams.get('preview')==='1'){previewRequests++;const selected=mode==='small'?files.slice(0,83):mode==='legacy'?files:files.slice(0,100);return void send(res,{...base,files:selected,...(mode==='legacy'?{}:{catalog:{complete:mode==='small',totalFiles:mode==='small'?83:files.length}})},mode!=='legacy');}
   if(url.searchParams.has('search')){const query=url.searchParams.get('search'),criteria=JSON.parse(url.searchParams.get('criteria')||'{}'),window=buildSearchWindow(files,query,criteria,{me:base.me,dept:base.dept},categories);lastSearchWindow={rows:window.files.length,total:window.totalFiles,scope:criteria.scope,jsonBytes:Buffer.byteLength(JSON.stringify(window))};if(mode==='search-failure'&&criteria.scope==='mine')await delay(600);if(mode==='search-failure'&&searchFailures++===0){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:false,error:'fixture search unavailable'}));return;}return void send(res,{...base,files:window.files,search:{...window,files:undefined,query},catalog:{complete:true}});}
   fullRequests++;pendingFull.push({res});return;
  }
  if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname==='/api/auth/me'?{success:true,user:{userId:'fixture',userName:'fixture'}}:{success:true,items:[],rows:[],favorites:[]}));return;}return handle(req,res);
 });server.on('upgrade',app.getUpgradeHandler());await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});page=await browser.newPage();page.setDefaultNavigationTimeout(120000);await page.setViewport({width:1920,height:1080});page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);page.on('request',request=>{const url=new URL(request.url());return ['localhost','127.0.0.1'].includes(url.hostname)||['data:','about:','blob:'].includes(url.protocol)?request.continue():request.abort();});
 if(process.argv.includes('--record-guide')){
  base.isAdmin=false;
  await page.goto('http://localhost:'+server.address().port+'/work/drive',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('.wd .card');
  await require('./lib/work-drive-search-guide.cjs').recordDriveGuide(page);
  return;
 }
 if(process.argv.includes('--verify-guide')){
  await navigate('small');
  const summary=await page.$('.wd details summary');
  await summary.focus();await page.keyboard.press('Enter');
  await page.waitForSelector('details[open] video');
  const metadata=await page.$eval('details[open] video',async video=>{
   await video.play();video.pause();
   return {duration:video.duration,dimensions:[video.videoWidth,video.videoHeight],captions:video.querySelector('track').getAttribute('srclang')};
  });
  assert(metadata.duration>0);assert.deepEqual(metadata.dimensions,[1920,1080]);assert.equal(metadata.captions,'ko');
  await page.focus('details[open] nav button:last-child');await page.keyboard.press('Enter');
  assert(await page.$eval('video',v=>v.currentTime>0&&v===document.activeElement));
  assert.equal(await page.$$eval('details[open] a[download]',links=>links.length),2);
  console.log('Guide player verified',metadata);return;
 }
 // Keep the full response withheld while files, category selection and detail are
 // usable. A search outside the first 100 must complete after the catalog arrives.
 await navigate('progressive');await until(()=>pendingFull.length===1);assert((await page.$eval('.wd',e=>e.textContent)).includes('일부 목록 기준'));assert((await page.$eval('.wd .sub',e=>e.textContent)).includes('20,820'));
 await page.$$eval('.wd .seg button',buttons=>buttons.find(button=>button.textContent==='목록').click());await page.click('.lst tbody tr');const selected=await page.$eval('.right .dn',e=>e.textContent);await page.$$eval('select.sel',selects=>{const select=selects.find(s=>[...s.options].some(o=>o.textContent==='대분류'));select.value='발주';select.dispatchEvent(new Event('change',{bubbles:true}));});
 const searchStart=performance.now();await page.type('.wd .search input','fixture-20819');await page.waitForFunction(()=>document.querySelector('.lst tbody')?.textContent.includes('fixture-20819'));const independentSearchMs=Math.round(performance.now()-searchStart);assert.equal(fullRequests,1);finishFull();assert.equal(await page.$eval('.wd .search input',e=>e.value),'fixture-20819');assert.equal(await page.$('.right .dn'),null);assert.equal(await page.$$eval('select.sel',selects=>selects.find(s=>[...s.options].some(o=>o.textContent==='대분류')).value),'발주');assert(await page.$eval('.wd .search input',e=>e===document.activeElement));assert(!(await page.$eval('.wd',e=>e.textContent)).includes('일부 목록 기준'));finishUsage();results.push({case:'preview-before-full',filesVisibleBeforeFull:100,fullFiles:files.length,searchRestored:true,filterAndFocusPreserved:true,unmatchedDetailCleared:true,independentSearchMs});
 // Broad matches retain all counts/sort/filter inputs while painting only 200 rows.
 await page.focus('.wd .search input');await page.keyboard.down('Control');await page.keyboard.press('KeyA');await page.keyboard.up('Control');const broadStart=performance.now();await page.type('.wd .search input','fixture-');await page.waitForFunction(()=>document.querySelectorAll('.lst tbody tr').length===200&&document.body.textContent.includes('파일 200개 더 보기'));const broadSearchMs=Math.round(performance.now()-broadStart);assert((await page.$eval('.wd .cnt',e=>e.textContent)).includes('20,820'));
 await page.$$eval('.wd button',buttons=>buttons.find(b=>b.textContent.includes('파일 200개 더 보기')).focus());await page.keyboard.press('Enter');await page.waitForFunction(()=>document.querySelectorAll('.lst tbody tr').length===400);results.push({case:'broad-search',exactMatches:20820,initialPaintRows:200,keyboardMoreRows:400,broadSearchMs,responseFiles:lastSearchWindow.rows,responseJsonBytes:lastSearchWindow.jsonBytes});
 // Search failure has a working explicit retry; administrator scope is not reset after choosing mine.
 await navigate('search-failure');await page.type('.wd .search input','fixture-20819');await page.waitForFunction(()=>document.body.textContent.includes('fixture search unavailable'));await page.$$eval('.wd button',buttons=>buttons.find(b=>b.textContent==='검색 다시 시도').click());await page.waitForFunction(()=>document.querySelector('.lst tbody')?.textContent.includes('fixture-20819'));await page.$$eval('.wd .seg.soft button',buttons=>buttons.find(b=>b.textContent==='내 파일').click());await page.waitForFunction(()=>document.querySelector('.wd .warn')?.textContent==='내 파일에서 검색 중…');await until(()=>lastSearchWindow?.scope==='mine');await page.waitForSelector('input[aria-label="내 파일 검색"]');assert(await page.$eval('.search-tools',e=>e.querySelector('.seg').nextElementSibling.matches('.search')));await page.click('button[aria-label="검색어 지우기"]');assert(await page.$eval('.search input',e=>!e.value&&e===document.activeElement));await page.type('.search input','fixture-20819');await page.waitForFunction(()=>document.querySelector('.wd .empty-state')?.textContent==='내 파일에서 검색 중…');await page.waitForFunction(()=>document.querySelector('.lst tbody')?.textContent.includes('fixture-20819'));results.push({case:'search-retry-scope',retryWorks:true,explicitAdminMineRetained:true});
 // A failed catalog leaves preview files available and retries only the full read.
 await navigate('progressive');await until(()=>pendingFull.length===1);const previewsBefore=previewRequests;finishFull(undefined,503);await page.waitForFunction(()=>document.body.textContent.includes('전체 목록을 불러오지 못했습니다'));assert(await page.$('.wd .card'));await page.$$eval('.wd button',buttons=>buttons.find(b=>b.textContent==='목록 다시 불러오기').click());await until(()=>pendingFull.length===1);assert.equal(previewRequests,previewsBefore);finishFull();await page.waitForFunction(()=>document.querySelector('.wd .sub')?.textContent.includes('20,820'));finishUsage();results.push({case:'full-failure-retry',previewRetained:true,fullOnlyRetry:true});
 // Reload aborts the first full request. Its late response cannot overwrite the
 // second generation; query selection stays in the screen throughout the reload.
 await navigate('progressive');await until(()=>pendingFull.length===1);const stale=pendingFull.splice(0);await page.type('.wd .search input','fixture-20819');await page.click('button[title="새로고침"]');await page.waitForFunction(()=>document.querySelector('.lst tbody')?.textContent.includes('fixture-20819'));finishFull(stale,200,{files:[{...files[0],filename:'stale-forbidden.xlsx'}]});await delay(100);assert(!(await page.$eval('.wd',e=>e.textContent)).includes('stale-forbidden'));assert.equal(await page.$eval('.wd .search input',e=>e.value),'fixture-20819');finishUsage();results.push({case:'reload-race',staleResponseIgnored:true,queryPreserved:true});
 // Reauthorization failure removes both preview and open detail.
 await navigate('progressive');await until(()=>pendingFull.length===1);await page.click('.wd .card');assert(await page.$('.right .dn'));finishFull(undefined,403);await page.waitForFunction(()=>document.body.textContent.includes('파일 접근 권한을 확인해 주세요'));assert.equal(await page.$('.wd .card,.right .dn,.lst tbody tr'),null);finishUsage();results.push({case:'permission-change',previewAndDetailCleared:true});
 for(const fallback of ['legacy','small']){const before=fullRequests;await navigate(fallback);await delay(100);assert.equal(fullRequests,before);assert(!(await page.$eval('.wd',e=>e.textContent)).includes('일부 목록 기준'));finishUsage();results.push({case:fallback,duplicateFullSkipped:true});}
 for(const usageMode of ['usage-failure','zero']){await navigate(usageMode);await until(()=>pendingFull.length===1&&pendingUsage.length>0);finishUsage();await page.waitForFunction(mode=>document.querySelector('.wd .sub')?.textContent.includes(mode==='zero'?'(0%)':'사용량 확인 실패'),{},usageMode);assert(await page.$('.wd .card'));finishFull();await page.waitForFunction(()=>document.querySelector('.wd .sub')?.textContent.includes('20,820'));results.push({case:usageMode,filesRemainUsable:true});}
 assert.deepEqual(errors,[]);const output=path.resolve(process.argv[2]||path.join('..','drive-first-files-browser.json'));fs.writeFileSync(output,JSON.stringify({viewport:'1920x1080',results,errors},null,2));console.log(JSON.stringify({output,results,errors},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();for(const {res}of pendingFull.splice(0))res.destroy();for(const res of pendingUsage.splice(0))res.destroy();if(server)await new Promise(resolve=>server.close(resolve));if(app)await app.close();process.exit(process.exitCode||0);});

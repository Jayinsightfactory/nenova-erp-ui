'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDriveCatalogLoader}=require('../lib/workDriveCatalogLoad.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(payload,status=200)=>({status,json:async()=>payload});
const file=id=>({id,filename:id+'.xlsx',canDownload:true});
const payload=(files,complete=true,extra={})=>({success:true,me:'fixture',dept:'fixture',isAdmin:false,files,catalog:{complete,totalFiles:200},...extra});
function fixture(fetch,nextPaint){const events={files:[],states:[],usage:[],usageErrors:[],denied:0};const loader=createDriveCatalogLoader({fetch,nextPaint,onFiles:(value,meta)=>events.files.push({value,meta}),onStatus:value=>events.states.push(value),onUsage:value=>events.usage.push(value),onUsageError:value=>events.usageErrors.push(value),onDenied:()=>events.denied++});return {loader,events};}
test('preview is available before paint and full network completion; the full catalog replaces it',async()=>{
 let paint,full;const calls=[];const {loader,events}=fixture(async(url,options)=>{calls.push({url,options});return url.includes('preview=1')?response(payload([file('recent')],false)):new Promise(resolve=>{full=resolve;});},()=>new Promise(resolve=>{paint=resolve;}));
 const loading=loader.load();await tick();assert.equal(events.files[0].value.files[0].id,'recent');assert.equal(events.states.at(-1).phase,'partial');assert.equal(calls.length,1);paint();await loading;assert.equal(calls.length,2);full(response(payload([file('recent'),file('older-search-result')])));await tick();assert.equal(events.files.at(-1).value.files.length,2);assert.equal(events.states.at(-1).phase,'ready');loader.close();
});
test('full failure keeps preview usable; explicit retry completes without restarting preview',async()=>{
 let calls=0;const {loader,events}=fixture(async url=>{calls++;return url.includes('preview=1')?response(payload([file('recent')],false)):calls===2?response({success:false,error:'fixture transient'},503):response(payload([file('recent'),file('older')]));});
 await loader.load();await tick();assert.equal(events.states.at(-1).phase,'error');assert.equal(events.states.at(-1).retry,'full');assert.equal(events.files.length,1);await loader.retry();assert.equal(calls,3);assert.equal(events.files.at(-1).value.files.length,2);loader.close();
});
test('abort and generation prevent an old full response from overwriting a newer reload or unmounted screen',async()=>{
 let oldFull,previewCount=0;const signals=[];const {loader,events}=fixture(async(url,{signal})=>{signals.push(signal);if(url.includes('preview=1'))return response(payload([file('generation-'+(++previewCount))],previewCount>1));return new Promise(resolve=>{oldFull=resolve;});});
 await loader.load();await loader.load();assert.equal(signals[1].aborted,true);oldFull(response(payload([file('stale')])));await tick();assert.equal(events.files.at(-1).value.files[0].id,'generation-2');const count=events.files.length;loader.close();await loader.load();assert.equal(events.files.length,count);
});
test('legacy servers are complete without catalog metadata and unsupported-preview fallback is bounded',async()=>{
 for(const unsupported of [false,true]){let calls=0;const {loader,events}=fixture(async()=>{calls++;return unsupported&&calls===1?response({success:false,error:'unsupported'},404):response({success:true,files:[file('legacy')],isAdmin:false});});await loader.load();assert.equal(calls,unsupported?2:1);assert.equal(events.states.at(-1).phase,'ready');loader.close();}
});
test('full permission loss clears visible data and disallows a stale retry; usage failure alone preserves files',async()=>{
 let calls=0;const {loader,events}=fixture(async url=>{calls++;return url.includes('preview=1')?response(payload([file('recent')],false)):response({},403);});await loader.load();await tick();assert.equal(events.denied,1);assert.equal(events.states.at(-1).denied,true);await loader.retry();assert.equal(calls,2);loader.close();
 const second=fixture(async url=>url.includes('usage=only')?response({success:false,error:'usage not available'},503):response(payload([file('recent')],true,{isAdmin:true,usage:null})));await second.loader.load();await tick();assert.equal(second.events.files.length,1);assert.equal(second.events.denied,0);assert.equal(second.events.usageErrors.at(-1),'usage not available');second.loader.close();
});
test('a late administrator usage response cannot publish after full catalog changes permission',async()=>{
 let usage;const {loader,events}=fixture(async url=>url.includes('usage=only')?new Promise(resolve=>{usage=resolve;}):response(payload([file('recent')],!url.includes('preview=1'),{isAdmin:url.includes('preview=1')})));await loader.load();await tick();usage(response({success:true,usage:{used:777}}));await tick();assert(!events.usage.some(value=>value?.used===777));loader.close();
});

test('API preview is explicit opt-in and uses only the authorized preview reader',async()=>{
 const fs=require('node:fs'),path=require('node:path');const source=fs.readFileSync(path.join(process.cwd(),'pages/api/work/drive.js'),'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*/gm,'').replace('export default','return');const user={userId:'fixture',userName:'fixture'};let previews=0,lists=0,totalFiles=155;
 const deps={fs,path,withAuth:fn=>fn,deptOfName:()=>({name:'fixture',dept:'fixture'}),isOrbitReportViewer:()=>false,WORK_DRIVE_ADMIN_USER_IDS:[],STAGES:['발주'],readDrivePreviewAsync:async input=>{assert.equal(input,user);previews++;return {files:[file('authorized')],totalFiles};},readDriveListAsync:async()=>{lists++;return {rows:[]};},readDriveUsageAsync:async()=>{throw Error('No admin usage');},listVisible:()=>[],sendDriveListJson:async(res,value)=>res.status(200).json(value),getFile:()=>null,downloadLog:()=>[],reclassify:()=>({}),reclassifyAll:()=>({})};const handler=new Function(...Object.keys(deps),source)(...Object.values(deps));
 async function request(query){const res={setHeader(){},status(code){this.statusCode=code;return this;},json(value){this.payload=value;return this;}};await handler({method:'GET',user,query},res);return res;}
 let result=await request({format:'table-v1',preview:'1',usage:'deferred'});assert.deepEqual(result.payload.files,[file('authorized')]);assert.deepEqual(result.payload.catalog,{complete:false,totalFiles:155});assert.equal(lists,0);assert.equal(previews,1);
 result=await request({preview:'1'});assert(!result.payload.catalog);assert.equal(lists,1);assert.equal(previews,1);result=await request({format:'table-v1',usage:'deferred'});assert.equal(result.payload.catalog.complete,true);totalFiles=1;result=await request({format:'table-v1',preview:'1'});assert.equal(result.payload.catalog.complete,true);
});

test('a preview failure after a populated screen offers a new preview reload, not an inert full retry',async()=>{
 let calls=0;const {loader,events}=fixture(async()=>++calls===2?response({success:false,error:'preview unavailable'},503):response(payload([file('existing')])));await loader.load();await loader.load();assert.equal(events.states.at(-1).retry,'preview');assert.equal(events.files.length,1);await loader.load();assert.equal(events.states.at(-1).phase,'ready');loader.close();
});

const transient=(status=503,hint='0')=>({...response({success:false,error:'fixture temporary failure'},status),headers:{get:name=>name.toLowerCase()==='retry-after'?hint:null}});
async function eventually(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('Expected loader state did not arrive');}
test('preview respects the real Retry-After delay once and then succeeds',async()=>{
 let calls=0;const {loader,events}=fixture(async()=>++calls===1?transient(503,'1'):response(payload([file('recovered')])));const start=performance.now();await loader.load();assert.equal(calls,2);assert(performance.now()-start>=900);assert.equal(events.files.at(-1).value.files[0].id,'recovered');assert.equal(events.states.at(-1).phase,'ready');loader.close();
});
test('full GET retries 429 once without losing the preview or creating a new preview request',async()=>{
 let previews=0,fulls=0;const {loader,events}=fixture(async url=>url.includes('preview=1')?(previews++,response(payload([file('recent')],false))):++fulls===1?transient(429):response(payload([file('recent'),file('older')])));await loader.load();assert.equal(events.files[0].value.files.length,1);await eventually(()=>events.states.at(-1).phase==='ready');assert.equal(previews,1);assert.equal(fulls,2);assert.equal(events.files.at(-1).value.files.length,2);loader.close();
});
test('only one automatic attempt is allowed; exhaustion retains manual full retry',async()=>{
 let fulls=0;const {loader,events}=fixture(async url=>url.includes('preview=1')?response(payload([file('recent')],false)):++fulls<3?transient():response(payload([file('recovered')])));await loader.load();await eventually(()=>events.states.at(-1).phase==='error');assert.equal(fulls,2);assert.equal(events.states.at(-1).retry,'full');assert.equal(events.files.length,1);await loader.retry();assert.equal(fulls,3);assert.equal(events.states.at(-1).phase,'ready');loader.close();
});
test('missing, invalid and long Retry-After hints, permission denial and usage reads never auto-retry',async()=>{
 for(const [status,hint]of [[503,null],[503,'bad'],[503,'3600'],[401,'0'],[403,'0'],[500,'0']]){let calls=0;const {loader,events}=fixture(async()=>{calls++;return transient(status,hint);});await loader.load();assert.equal(calls,1);assert.equal(events.states.at(-1).phase,'error');loader.close();}
 let usageCalls=0;const {loader,events}=fixture(async url=>url.includes('usage=only')?(usageCalls++,transient()):response(payload([file('recent')],true,{isAdmin:true})));await loader.load();await eventually(()=>events.usageErrors.length>1);assert.equal(usageCalls,1);assert.equal(events.files.length,1);loader.close();
});
test('cancellation and a new request generation clear the Retry-After timer without another fetch',async()=>{
 let calls=0;const first=fixture(async()=>{calls++;return transient(503,'1');});const pending=first.loader.load();await tick();first.loader.close();await pending;assert.equal(calls,1);assert.equal(first.events.files.length,0);
 let secondCalls=0;const second=fixture(async()=>++secondCalls===1?transient(503,'1'):response(payload([file('new-generation')])));const old=second.loader.load();await tick();await second.loader.load();await old;assert.equal(secondCalls,2);assert.equal(second.events.files.at(-1).value.files[0].id,'new-generation');second.loader.close();
});
test('an aborted full retry wait cannot reenter after a newer reload completes',async()=>{
 let previews=0,fulls=0;const {loader,events}=fixture(async url=>url.includes('preview=1')?response(payload([file('generation-'+(++previews))],previews>1)):(fulls++,transient(503,'1')));await loader.load();await tick();assert.equal(fulls,1);await loader.load();await tick();assert.equal(fulls,1);assert.equal(events.files.at(-1).value.files[0].id,'generation-2');loader.close();
});

test('real browser honors a Retry-After preview/full and cancels a pending retry', {skip:process.env.NENOVA_CATALOG_BROWSER!=='1'},async()=>{
 const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),puppeteer=require('puppeteer-core');let mode='recover',previewCalls=0,fullCalls=0,firstPreviewAt=0,lastPreviewAt=0,server,browser;const errors=[];
 const decoder=fs.readFileSync(path.join(process.cwd(),'lib/workDriveListDecode.cjs'),'utf8'),loaderSource=fs.readFileSync(path.join(process.cwd(),'lib/workDriveCatalogLoad.cjs'),'utf8');
 try{
  server=http.createServer((req,res)=>{
   if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<div id="files"></div><div id="status"></div><script src="/decoder.js"></script><script src="/loader.js"></script>');return;}
   if(req.url==='/decoder.js'||req.url==='/loader.js'){res.setHeader('Content-Type','application/javascript');res.end('(function(){const module={exports:{}};const require=()=>window.driveDecoder;'+(req.url==='/decoder.js'?decoder:loaderSource)+';window.'+(req.url==='/decoder.js'?'driveDecoder':'driveLoader')+'=module.exports;})();');return;}
   if(!req.url.startsWith('/api/work/drive')){res.statusCode=404;res.end();return;}
   const preview=req.url.includes('preview=1'),count=preview?++previewCalls:++fullCalls;if(preview){lastPreviewAt=performance.now();if(count===1)firstPreviewAt=lastPreviewAt;}
   res.setHeader('Content-Type','application/json');if(mode==='cancel'||count===1){res.statusCode=503;res.setHeader('Retry-After',preview?'1':'0');res.end(JSON.stringify({success:false,error:'fixture changing index'}));return;}res.end(JSON.stringify(payload(preview?[file('recent')]:[file('recent'),file('older')],!preview)));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{window.loader=window.driveLoader.createDriveCatalogLoader({onFiles:p=>document.querySelector('#files').textContent=p.files.map(f=>f.id).join(','),onStatus:s=>document.querySelector('#status').textContent=s.phase,onUsage(){},onUsageError(){},onDenied(){}});void window.loader.load();});await page.waitForFunction(()=>document.querySelector('#status').textContent==='ready');assert.equal(previewCalls,2);assert.equal(fullCalls,2);assert(lastPreviewAt-firstPreviewAt>=900);assert.equal(await page.$eval('#files',e=>e.textContent),'recent,older');
  mode='cancel';previewCalls=0;fullCalls=0;await page.evaluate(()=>void window.loader.load());await eventually(()=>previewCalls===1);await page.evaluate(()=>window.loader.close());await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(previewCalls,1);assert.equal(fullCalls,0);assert.deepEqual(errors,[]);
 }finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
});

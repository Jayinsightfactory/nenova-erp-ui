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
 await loader.load();await tick();assert.equal(events.states.at(-1).phase,'error');assert.equal(events.files.length,1);await loader.retry();assert.equal(calls,3);assert.equal(events.files.at(-1).value.files.length,2);loader.close();
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

'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {createDriveSearchLoader}=require('../lib/workDriveSearchLoad.cjs'),{createDriveListReader}=require('../lib/workDriveListAsync.cjs');
const root=process.cwd();require('node:module').register(pathToFileURL(path.join(root,'scripts/work-drive-esm-loader.mjs')));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('whole-index search before catalog: ACL, aliases, corrected/deleted rows, cross-year same-cycle, versions and download flags equal full list',async()=>{
 const wd=await import(pathToFileURL(path.join(root,'lib/workDrive.js'))),before=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-drive-search-'));
 const users=[{userId:'nenovaSS3',userName:'fixture-admin'},{userId:'fixture',userName:'fixture-owner'},{userId:'other',userName:'fixture-other'}];
 const rows=Array.from({length:23100},(_,i)=>({id:String(i),filename:'ordinary-'+i+'.xlsx',uploaderName:'fixture-owner',stage:'발주',cycle:'46-1',uploadedAt:'2026-11-01'}));
 rows.push({id:'old',filename:'Target INVOICE.pdf',uploaderName:'fixture-owner',stage:'입고',cycle:'46-1',uploadedAt:'2025-11-01'}, {id:'new',filename:'Target INVOICE.pdf',uploaderName:'fixture-owner',stage:'입고',cycle:'45-1',uploadedAt:'2026-11-01'}, {id:'private',filename:'Target private.pdf',uploaderName:'fixture-other',sensitive:true,uploadedAt:'2026-11-02'}, {id:'removed',filename:'Target removed.pdf',uploaderName:'fixture-owner',uploadedAt:'2026-11-03'}, {id:'removed',filename:'Target removed.pdf',deleted:true}, {id:'corrected',filename:'Target old.pdf',uploaderName:'fixture-owner'},{id:'corrected',filename:'unrelated.pdf',uploaderName:'fixture-owner'});
 fs.mkdirSync(path.join(dir,'data/drive'),{recursive:true});const index=path.join(dir,'data/drive/index.jsonl');fs.writeFileSync(index,rows.map(JSON.stringify).join('\n')+'\n');process.chdir(dir);
 const reader=createDriveListReader({projectRoot:root});
 try{
  for(const user of users)for(const q of ['target','INVOICE','46-1','fixture-owner','not-present']){
   const start=performance.now(),actual=await reader.read({previewViewer:{...user,searchQuery:q,searchCriteria:{limit:50000}}}),full=wd.listVisible(user),expected=full.filter(f=>f.filename.toLowerCase().includes(q.toLowerCase())||(f.uploaderName||'').includes(q)||(f.cycle||'')===q);
   expected.sort((a,b)=>String(a.uploadedAt||'')>String(b.uploadedAt||'')?-1:String(a.uploadedAt||'')<String(b.uploadedAt||'')?1:0);
   assert.deepEqual(actual.files.map(({searchVersionCount,...f})=>f),expected);assert.equal(actual.totalFiles,expected.length);
   const versions=new Map();for(const f of full){const k=f.uploaderName+'|'+f.filename;versions.set(k,(versions.get(k)||0)+1);}for(const file of actual.files)assert.equal(file.searchVersionCount,versions.get(file.uploaderName+'|'+file.filename));
   if(q==='target'&&user===users[0])console.log(JSON.stringify({fixtureFiles:23106,searchMs:Math.round(performance.now()-start),matches:actual.totalFiles}));
  }
  fs.appendFileSync(index,JSON.stringify({id:'newly-uploaded',filename:'target fresh.xlsx',uploaderName:'fixture-owner'})+'\n');const fresh=await reader.read({previewViewer:{...users[1],searchQuery:'fresh'}});assert.equal(fresh.files[0].id,'newly-uploaded');
 }finally{await reader.close();process.chdir(before);assert(path.basename(dir).startsWith('nenova-drive-search-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('search races, cancellation, denial and retry never publish an old or unauthorized response',async()=>{
 const pending=[],results=[],states=[];let denied=0;
 const loader=createDriveSearchLoader({fetch:(url,{signal})=>new Promise(resolve=>pending.push({url,signal,resolve})),onResult:p=>results.push(p),onState:s=>states.push(s),onDenied:()=>denied++});
 const reply=(entry,query,status=200)=>entry.resolve({status,json:async()=>({success:true,files:[{id:query}],search:{query}})});
 const a=loader.search('old'),b=loader.search('new');assert(pending[0].signal.aborted);reply(pending[1],'new');await b;reply(pending[0],'old');await a;assert.deepEqual(results.map(p=>p.files[0].id),['new']);
 const c=loader.search('denied');reply(pending[2],'denied',403);await c;assert.equal(denied,1);assert.equal(states.at(-1).phase,'error');assert.equal(results.length,1);
 const d=loader.search('closed');loader.close();reply(pending[3],'closed');await d;assert.equal(results.length,1);
});
test('search pauses an in-flight full download and can resume complete catalog after clear',async()=>{
 const {createDriveCatalogLoader}=require('../lib/workDriveCatalogLoad.cjs');let resolveFull;const signals=[],files=[];
 const loader=createDriveCatalogLoader({fetch:async(url,{signal})=>{signals.push(signal);return url.includes('preview=1')?{status:200,json:async()=>({success:true,files:[{id:'preview'}],catalog:{complete:false}})}:new Promise(resolve=>resolveFull=resolve);},onFiles:p=>files.push(p),onStatus(){},onUsage(){},onUsageError(){},onDenied(){}});
 await loader.load();loader.pause();assert(signals[1].aborted);resolveFull({status:200,json:async()=>({success:true,files:[{id:'late'}],catalog:{complete:true}})});await tick();assert.equal(files.length,1);
 const resumed=loader.resume();await tick();resolveFull({status:200,json:async()=>({success:true,files:[{id:'complete'}],catalog:{complete:true}})});await resumed;assert.equal(files.at(-1).files[0].id,'complete');loader.close();
});
test('API search validates input before work and never waits for full catalog or disk usage',async()=>{
 const source=fs.readFileSync(path.join(root,'pages/api/work/drive.js'),'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*/gm,'').replace('export default','return');const user={userId:'fixture',userName:'fixture'};let calls=0;
 const deps={fs,path,withAuth:fn=>fn,deptOfName:()=>({name:'fixture',dept:'fixture'}),isOrbitReportViewer:()=>true,WORK_DRIVE_ADMIN_USER_IDS:[],STAGES:['발주'],readDriveSearchAsync:async(u,q)=>{assert.equal(u,user);calls++;if(q==='fail')throw Error('fixture');return {files:[{id:'authorized',canDownload:true}],totalFiles:1};},readDriveListAsync:()=>{throw Error('No full IPC allowed');},readDriveUsageAsync:()=>{throw Error('No disk scan allowed');},sendDriveListJson:async(res,value)=>res.status(200).json(value)};
 const handler=new Function(...Object.keys(deps),source)(...Object.values(deps));
 async function request(search){const headers={},res={setHeader(k,v){headers[k]=v;},status(code){this.statusCode=code;return this;},json(value){this.payload=value;return this;}};await handler({method:'GET',user,query:{search,format:'table-v1',usage:'deferred'}},res);return {...res,headers};}
 for(const query of ['',[],['one','two'],'x'.repeat(501)])assert.equal((await request(query)).statusCode,400);assert.equal(calls,0);
 const result=await request('Target');assert.equal(result.statusCode,200);assert.deepEqual(result.payload.search,{query:'Target',totalFiles:1});assert.equal(result.payload.files[0].canDownload,true);assert.equal(result.headers['Cache-Control'],'no-store');assert(!('usage'in result.payload));
 const failed=await request('fail');assert.equal(failed.statusCode,503);assert.equal(failed.headers['Retry-After'],'2');
});

test('bounded search window applies every existing filter and sort before limiting; full counts/facets never shrink to the page',async()=>{
 const category=await import(pathToFileURL(path.join(root,'lib/workDriveCategories.js'))),{buildSearchWindow,yearOf}=require('../lib/workDriveSearch.cjs');
 const now=Date.parse('2026-11-14T12:00:00Z'),viewer={me:'owner',dept:'sales'};
 const rows=Array.from({length:640},(_,i)=>({id:String(i),filename:`target ${i%4?'발주':'컨펌'} ${i<600?i%10:i}.${i%3?'xlsx':'pdf'}`,uploaderName:i%3?'owner':'other',dept:i%5?'sales':'import',ext:i%3?'xlsx':'pdf',sourceDir:i%2?'Desktop':'Downloads',uploadedAt:new Date(now-i*3600000).toISOString(),mtime:'2026-01-01T00:00:00Z',cycle:i%7?'46-1':'',stage:i%2?'발주':'입고',sensitive:i%4===0,hostname:i%5?'pc':'web',eventType:i%5?'modify':'web-upload',size:640-i}));
 const versions=new Map();for(const f of rows){const k=f.uploaderName+'|'+f.filename;versions.set(k,(versions.get(k)||0)+1);}
 const tests=[{}, {scope:'mine'},{scope:'dept'}, {scope:'mine',who:'other'}, {dept:'import'}, {ext:'pdf'}, {dir:'Downloads'}, {period:'1'}, {period:'7'}, {sensitive:'sens'}, {sensitive:'plain'}, {versions:'multi'}, {origin:'web'}, {origin:'pc'}, {stage:'발주'}, {stage:'발주',subcategory:'컨펌·확정'}, {stage:'입고',subcategory:'패킹리스트'}, {sortKey:'filename',sortDirection:1}, {sortKey:'size',sortDirection:-1}, {sortKey:'cycle',sortDirection:1}, {sortKey:'stage',sortDirection:1}, {scope:'mine',dept:'sales',ext:'xls',dir:'Desktop',sensitive:'plain',origin:'pc',stage:'발주'}];
 for(const c of tests){
  const inScope=f=>(c.scope||'all')==='all'||(c.scope==='mine'?f.uploaderName===viewer.me:f.dept===viewer.dept||f.uploaderName===viewer.me);
  const since=c.period?now-Number(c.period)*86400e3:0;
  const scoped=rows.filter(f=>(c.who?f.uploaderName===c.who:inScope(f))&&(!c.dept||f.dept===c.dept)&&(!c.ext||(f.ext==='xlsx'?'xls':f.ext)===c.ext)&&(!c.dir||f.sourceDir===c.dir)&&(!since||new Date(f.uploadedAt).getTime()>=since)&&(!c.sensitive||(c.sensitive==='sens'?f.sensitive:!f.sensitive))&&(!c.versions||versions.get(f.uploaderName+'|'+f.filename)>1)&&(!c.origin||(c.origin==='web')===(f.eventType==='web-upload'||f.hostname==='web')));
  const expected=category.filterCategories(scoped,c.stage,c.subcategory),k=c.sortKey||'uploadedAt',d=c.sortDirection||-1,val=f=>k==='cycle'?require('../lib/workDriveSearch.cjs').cycleKey(f.cycle):k==='size'?f.size:k==='stage'?category.fileSubcategory(f):String(f[k]||'');
  expected.sort((a,b)=>val(a)>val(b)?d:val(a)<val(b)?-d:0);
  const result=buildSearchWindow(rows,'target',{...c,limit:37,offset:-540},viewer,category,{now});
  assert.deepEqual(result.files.map(f=>f.id),expected.slice(0,37).map(f=>f.id),JSON.stringify(c));assert.equal(result.totalFiles,640);assert.equal(result.scopedCount,scoped.length);assert.equal(result.categoryCount,expected.length);
  assert.equal(Object.values(result.stageCounts).reduce((a,b)=>a+b,0),scoped.length);assert.deepEqual(result.subcategoryCounts,category.subcategoryCounts(scoped,c.stage));assert.equal(result.facets.hosts.reduce((n,h)=>n+h.n,0),640);assert.equal(result.facets.people.reduce((n,p)=>n+p.n,0),rows.filter(inScope).length);
 }
 assert.equal(yearOf({filename:'target',cycle:'46-1',mtime:'2026-01-01T00:00:00Z'},-540),2025);assert.equal(yearOf({filename:'2026년 target',mtime:'2025-01-01',cycle:'46-1'},-540),2026);
 const {normalizeSearchCriteria}=require('../lib/workDriveSearch.cjs');assert.equal(normalizeSearchCriteria({limit:50001}).limit,50000);assert.equal(normalizeSearchCriteria({limit:Infinity}).limit,200);assert.equal(normalizeSearchCriteria({scope:'mine'}).scope,'mine');assert.equal(normalizeSearchCriteria({scope:'dept'}).scope,'dept');
});

test('disconnect releases sole full-catalog child/cache, preserves concurrent employee reads and removes abort listeners',async()=>{
 const {EventEmitter}=require('node:events');let launches=0,terminations=0;const children=[];
 const reader=createDriveListReader({launchChild:()=>{launches++;const child=new EventEmitter();child.messages=[];Object.assign(child,{ref(){},unref(){},terminate:async()=>{terminations++;},postMessage:m=>child.messages.push(m)});children.push(child);return child;}});
 try{
  const a=new AbortController(),b=new AbortController(),first=reader.read({signal:a.signal}),second=reader.read({signal:b.signal});await tick();const firstRejected=assert.rejects(first,e=>e.name==='AbortError');a.abort();await firstRejected;assert.equal(terminations,0);const child=children[0];child.emit('message',{id:child.messages[0].id,ok:true,signature:'s',snapshot:{rows:[{id:'other-employee'}]}});assert.equal((await second).rows[0].id,'other-employee');b.abort();assert.equal(terminations,0);
  const solo=new AbortController(),pending=reader.read({signal:solo.signal}),rejected=assert.rejects(pending,e=>e.name==='AbortError');await tick();solo.abort();await rejected;await tick();assert.equal(terminations,1);assert.equal(reader.status().waiters,0);
  const fresh=reader.read();await tick();assert.equal(launches,2);assert(!children[1].messages[0].knownSignature);children[1].emit('message',{id:children[1].messages[0].id,ok:true,snapshot:{rows:[]}});await fresh;
 }finally{await reader.close();}
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {createDriveListReader}=require('../lib/workDriveListAsync.cjs');
const projectRoot=process.cwd();require('node:module').register(pathToFileURL(path.join(projectRoot,'scripts/work-drive-esm-loader.mjs')));
const boss={userId:'nenovaSS3',userName:'fixture-admin'},a={userId:'fixture-a',userName:'fixture-a'},b={userId:'fixture-b',userName:'fixture-b'};
async function fixture(run){
 const prior=process.cwd(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-drive-list-')),root=path.join(dir,'data/drive');fs.mkdirSync(root,{recursive:true});
 const rows=[{id:'a',filename:'a.txt',rel:'a.txt',size:5,uploaderName:a.userName,stage:'발주',uploadedAt:'2025-12-31'},{id:'b',filename:'b.txt',rel:'b.txt',size:7,uploaderName:b.userName,sensitive:true,uploadedAt:'2026-01-01'},{id:'snapshot',filename:'snapshot.txt',rel:'snapshot.txt',size:3,uploaderName:a.userName,sensitive:true,egressSnapshot:true,uploadedAt:'2026-01-02'},{id:'a',filename:'a.txt',rel:'a.txt',size:5,uploaderName:a.userName,stage:'출고',uploadedAt:'2025-12-31'},{id:'removed',filename:'removed.txt',rel:'removed.txt',size:4,uploaderName:b.userName,deleted:true,uploadedAt:'2026-01-03'},{id:'dl',type:'download',fileId:'a',size:999}];
 for(const row of rows)if(row.rel)fs.writeFileSync(path.join(root,row.rel),Buffer.alloc(row.size));
 fs.writeFileSync(path.join(root,'orphan.txt'),'orphan');fs.writeFileSync(path.join(root,'pairs.json'),'{}');const index=path.join(root,'index.jsonl');fs.writeFileSync(index,rows.map(JSON.stringify).join('\n')+'\n');process.chdir(dir);
 try{await run({dir,root,index,rows,wd:await import(pathToFileURL(path.join(projectRoot,'lib/workDrive.js')))});}finally{process.chdir(prior);assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));assert(path.basename(dir).startsWith('nenova-drive-list-'));fs.rmSync(dir,{recursive:true,force:true});}
}
test('one read-only child snapshot preserves list/order/per-call ACL and usage; concurrent calls coalesce',()=>fixture(async({root,index,wd})=>{
 const reader=createDriveListReader({projectRoot}),original=fs.readFileSync(index),names=fs.readdirSync(root),expected=wd.listVisible(boss),usage=wd.driveUsage();
 try{
  const [x,y,z]=await Promise.all([reader.read({includeUsage:true}),reader.read(),reader.read({includeUsage:true})]);assert.deepEqual(x,y);assert.deepEqual(y,z);assert.deepEqual(wd.listVisible(boss,x.rows),expected);
  for(const user of [boss,a,b,null])assert.deepEqual(wd.listVisible(user,x.rows),wd.listVisible(user));
  assert(!wd.listVisible(a,x.rows).some(row=>row.id==='snapshot'));assert(!wd.listVisible(a,x.rows).some(row=>row.id==='b'));assert(wd.listVisible(b,x.rows).some(row=>row.id==='b'));
  for(const k of ['used','files','indexedNaive','onDisk','onDiskFiles'])assert.equal(x.usage[k],usage[k]);assert.deepEqual(Object.keys(x.usage),Object.keys(usage));assert(x.rows.every(row=>row.canDownload===undefined),'ACL result must not be cached across users');
  assert.deepEqual(reader.stats(),{indexReads:1,diskWalks:1});await reader.read();assert.deepEqual(reader.stats(),{indexReads:1,diskWalks:1});
  fs.writeFileSync(path.join(root,'external-orphan.txt'),'fresh');const fresh=await reader.read({includeUsage:true});assert.equal(fresh.usage.onDisk,usage.onDisk+5);assert.equal(reader.stats().diskWalks,2,'disk totals are fresh, not TTL cached');
  fs.unlinkSync(path.join(root,'external-orphan.txt'));assert.deepEqual(fs.readFileSync(index),original);assert.deepEqual(fs.readdirSync(root),names,'reader must not create lock/job/temp files');
 }finally{await reader.close();}
}));
test('external correction/append, same-size atomic replacement and deletion invalidate; unreadable index never serves stale rows',()=>fixture(async({index,wd,rows})=>{
 const reader=createDriveListReader({projectRoot});
 try{
  await reader.read();fs.appendFileSync(index,JSON.stringify({...rows[0],deleted:true})+'\n');let next=await reader.read();assert(!wd.listVisible(a,next.rows).some(row=>row.id==='a'));assert.equal(reader.stats().indexReads,2);
  const replacement=index+'.replacement',text=fs.readFileSync(index,'utf8').replace('b.txt','c.txt');assert.equal(Buffer.byteLength(text),fs.statSync(index).size);fs.writeFileSync(replacement,text);fs.renameSync(replacement,index);next=await reader.read();assert(wd.listVisible(b,next.rows).some(row=>row.filename==='c.txt'));assert.equal(reader.stats().indexReads,3);
  fs.renameSync(index,index+'.saved');fs.mkdirSync(index);await assert.rejects(reader.read(),/READ_FAILED/);fs.rmdirSync(index);fs.renameSync(index+'.saved',index);assert((await reader.read()).rows.length>0);
  fs.unlinkSync(index);assert.deepEqual((await reader.read()).rows,[]);assert.equal(reader.status().waiters,0);
 }finally{await reader.close();}
}));
test('bounded admission, timeout and shutdown reject safely without touching originals',()=>fixture(async({index})=>{
 const original=fs.readFileSync(index),busy=createDriveListReader({projectRoot,maxWaiters:1}),slow=createDriveListReader({projectRoot,timeoutMs:1});
 try{
  const accepted=busy.read();await assert.rejects(busy.read(),error=>error.statusCode===503&&/BUSY/.test(error.message));await accepted;
  await assert.rejects(slow.read(),/TIMEOUT/);await slow.close();assert.deepEqual(fs.readFileSync(index),original);
  const closing=busy.read(),closed=assert.rejects(closing,/CLOSED/);await busy.close();await closed;await assert.rejects(busy.read(),/CLOSED/);
 }finally{await busy.close();await slow.close();}
}));
test('a caller arriving during an active read gets a new snapshot; IPC never receives caller identity or credentials',async()=>{
 const {EventEmitter}=require('node:events'),child=new EventEmitter(),messages=[];let settings;
 Object.assign(child,{ref(){},unref(){},terminate:async()=>{},postMessage:message=>messages.push(message)});
 const reader=createDriveListReader({projectRoot,launchChild:(_file,input)=>{settings=input;return child;}});
 try{
  const first=reader.read({includeUsage:false,user:{token:'must-not-cross-ipc'}});await new Promise(resolve=>setImmediate(resolve));
  const second=reader.read({includeUsage:true,authorization:'must-not-cross-ipc'});assert.equal(messages.length,1);
  child.emit('message',{id:messages[0].id,ok:true,snapshot:{rows:[{id:'before-correction'}]}});assert.equal((await first).rows[0].id,'before-correction');assert.equal(messages.length,2);
  child.emit('message',{id:messages[1].id,ok:true,snapshot:{rows:[{id:'after-correction'}],usage:{used:0}}});assert.equal((await second).rows[0].id,'after-correction');
  assert.deepEqual(Object.keys(settings),['projectRoot']);for(const message of messages)assert.deepEqual(Object.keys(message),['id','includeUsage']);assert(!JSON.stringify({settings,messages}).includes('must-not-cross-ipc'));
 }finally{await reader.close();}
});
test('synchronous child-launch and IPC-send failures reject503 instead of escaping the microtask',async()=>{
 const launchFailure=createDriveListReader({launchChild:()=>{throw Error('synthetic launch failure');}});
 await assert.rejects(launchFailure.read(),error=>error.statusCode===503&&/CHILD_FAILED/.test(error.message));assert.equal(launchFailure.status().waiters,0);await launchFailure.close();
 const {EventEmitter}=require('node:events'),child=new EventEmitter();let terminated=0;
 Object.assign(child,{ref(){},unref(){},terminate:async()=>{terminated++;},postMessage(){throw Error('synthetic send failure');}});
 const sendFailure=createDriveListReader({launchChild:()=>child});await assert.rejects(sendFailure.read(),error=>error.statusCode===503&&/CHILD_FAILED/.test(error.message));await sendFailure.close();assert.equal(terminated,1);assert.equal(sendFailure.status().waiters,0);
});
test('expired queued callers reject before starting any new read',async()=>{
 const {EventEmitter}=require('node:events'),child=new EventEmitter(),messages=[];let now=0,launches=0;
 Object.assign(child,{ref(){},unref(){},terminate:async()=>{},postMessage:message=>messages.push(message)});
 const reader=createDriveListReader({timeoutMs:10000,clock:()=>now,launchChild:()=>{launches++;return child;}});
 try{
  const first=reader.read();await new Promise(resolve=>setImmediate(resolve));const second=reader.read(),expired=assert.rejects(second,/TIMEOUT/);now=10001;
  child.emit('message',{id:messages[0].id,ok:true,snapshot:{rows:[]}});await first;await expired;assert.equal(launches,1);assert.equal(messages.length,1,'expired pending batch must not start IPC work');assert.equal(reader.status().waiters,0);
 }finally{await reader.close();}
});
test('a slow child termination cannot extend pending HTTP deadlines',async()=>{
 const {EventEmitter}=require('node:events'),child=new EventEmitter();let release;
 Object.assign(child,{ref(){},unref(){},terminate:()=>new Promise(resolve=>{release=resolve;}),postMessage(){}});
 const reader=createDriveListReader({timeoutMs:20,launchChild:()=>child}),guard=setInterval(()=>{},1000);
 try{
  await assert.rejects(reader.read(),/TIMEOUT/);await new Promise(resolve=>setTimeout(resolve,5));assert(release);
  await assert.rejects(reader.read(),/TIMEOUT/);assert.equal(reader.status().waiters,0);
 }finally{release?.();await reader.close();clearInterval(guard);}
});

test('unchanged exact-signature snapshots reuse row identity while usage remains fresh',()=>fixture(async({index,rows})=>{
 const reader=createDriveListReader({projectRoot});try{
  const first=await reader.read({includeUsage:true}),next=await reader.read({includeUsage:true});assert.equal(next.rows,first.rows);assert.notEqual(next.usage,first.usage);assert.equal(reader.stats().diskWalks,2);
  fs.appendFileSync(index,JSON.stringify({...rows[0],stage:'품질'})+'\n');const updated=await reader.read();assert.notEqual(updated.rows,first.rows);assert.equal(updated.rows.find(row=>row.id==='a').stage,'품질');
 }finally{await reader.close();}
}));

test('legacy and opt-in lossless response preserve all authorized fields, JSON values and ordering',()=>fixture(async({wd})=>{
 const http=require('node:http'),{sendDriveListJson}=require('../lib/workDriveListResponse.cjs'),{encodeDriveFileTable,decodeDriveList}=require('../lib/workDriveListTable.cjs');
 for(const user of [boss,a,b,null]){
  const files=wd.listVisible(user);files.push(JSON.parse('{"id":"edge","__proto__":"own","null":null,"array":[1,"x"],"number":0,"false":false,"empty":"","negative":-1,"object":{"nested":true}}'));
  const payload={success:true,files,stages:['a'],usage:{used:0}};assert.deepEqual(decodeDriveList({...payload,files:undefined,fileTable:await encodeDriveFileTable(files)}),payload);
 }
 const payload={success:true,files:wd.listVisible(boss),me:'fixture',stages:['발주'],usage:wd.driveUsage()};
 const server=http.createServer((req,res)=>{sendDriveListJson(res,payload,{table:req.url==='/table',chunkBytes:64}).catch(()=>res.destroy());});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{for(const route of ['/legacy','/table']){const response=await fetch('http://127.0.0.1:'+server.address().port+route);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/json/);assert.deepEqual(decodeDriveList(await response.json()),payload);}}finally{await new Promise(resolve=>server.close(resolve));}
}));

test('response backpressure and disconnect stop further writes',async()=>{
 const {EventEmitter}=require('node:events'),{sendDriveListJson}=require('../lib/workDriveListResponse.cjs'),res=new EventEmitter();let writes=0,ended=false;
 Object.assign(res,{setHeader(){},write(){writes++;queueMicrotask(()=>res.emit('close'));return false;},end(){ended=true;}});
 await sendDriveListJson(res,{success:true,files:Array.from({length:200},(_,i)=>({id:String(i),filename:'fixture'}))},{chunkBytes:10});assert.equal(writes,1);assert.equal(ended,false);for(const event of ['close','drain','error'])assert.equal(res.listenerCount(event),0);
});

test('usage-only reader scans freshly without returning rows; its slow queue cannot block the list',()=>fixture(async({root,wd})=>{
 const {createDriveUsageReader}=require('../lib/workDriveListAsync.cjs'),usageReader=createDriveUsageReader({projectRoot}),listReader=createDriveListReader({projectRoot});
 try{const first=await usageReader.read();assert.equal(first.rows,undefined);assert.equal(first.usage.onDisk,wd.driveUsage().onDisk);fs.writeFileSync(path.join(root,'fresh-orphan.txt'),'fresh');const next=await usageReader.read();assert.equal(next.usage.onDisk,first.usage.onDisk+5);assert.equal(usageReader.stats().diskWalks,2);const list=await listReader.read();assert.equal(list.usage,undefined);assert.equal(listReader.stats().diskWalks,0);}finally{await usageReader.close();await listReader.close();}
 const {EventEmitter}=require('node:events'),usageChild=new EventEmitter(),listChild=new EventEmitter();let message;
 for(const child of [usageChild,listChild])Object.assign(child,{ref(){},unref(){},terminate:async()=>{}});
 usageChild.postMessage=m=>{message=m;};listChild.postMessage=m=>queueMicrotask(()=>listChild.emit('message',{id:m.id,ok:true,snapshot:{rows:[]}}));
 const slow=createDriveUsageReader({maxWaiters:1,launchChild:()=>usageChild}),fast=createDriveListReader({launchChild:()=>listChild});
 try{const pending=slow.read(),closed=assert.rejects(pending,/CLOSED/);await new Promise(resolve=>setImmediate(resolve));assert.equal(message.usageOnly,true);await assert.rejects(slow.read(),/BUSY/);assert.deepEqual((await fast.read()).rows,[]);assert.equal(fast.status().waiters,0);await slow.close();await closed;}finally{await slow.close();await fast.close();}
}));

test('API opts into deferred usage explicitly, authorizes separate usage before work, and preserves legacy admin usage',()=>fixture(async({wd})=>{
 let listCalls=0,usageCalls=0,failUsage=false;
 const source=fs.readFileSync(path.join(projectRoot,'pages/api/work/drive.js'),'utf8').replace(/^import[\s\S]*?from ['"][^'"]+['"];?\s*/gm,'').replace('export default','return');
 const expectedUsage={used:0,max:100,files:0,pct:0};
 const deps={fs,path,withAuth:fn=>fn,...wd,isOrbitReportViewer:u=>u?.userId===boss.userId,sendDriveListJson:async(res,payload)=>res.status(200).json(payload),readDriveListAsync:async options=>{listCalls++;assert.equal(options?.includeUsage,undefined);return {rows:wd.readDriveListRows()};},readDriveUsageAsync:async()=>{usageCalls++;if(failUsage)throw Error('fixture slow disk failure');return {usage:expectedUsage};}};
 const handler=new Function(...Object.keys(deps),source)(...Object.values(deps));
 async function request(user,query){const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(payload){this.payload=payload;return this;}};await handler({method:'GET',user,query},res);return res;}
 let result=await request(boss,{format:'table-v1',usage:'deferred'});assert.equal(result.statusCode,200);assert.equal(result.payload.usage,null);assert.deepEqual(result.payload.files,wd.listVisible(boss));assert.equal(usageCalls,0);assert.equal(result.headers['Cache-Control'],'no-store');
 result=await request(a,{usage:'only'});assert.equal(result.statusCode,403);assert.equal(usageCalls,0);
 result=await request(boss,{usage:'only'});assert.equal(result.statusCode,200);assert.deepEqual(result.payload.usage,expectedUsage);assert.equal(listCalls,1);
 result=await request(boss,{});assert.equal(result.statusCode,200);assert.deepEqual(result.payload.usage,expectedUsage);assert.deepEqual(result.payload.files,wd.listVisible(boss));
 result=await request(a,{});assert(!Object.hasOwn(result.payload,'usage'));assert.deepEqual(result.payload.files,wd.listVisible(a));
 failUsage=true;result=await request(boss,{usage:'only'});assert.equal(result.statusCode,503);assert.equal(result.headers['Retry-After'],'2');result=await request(boss,{format:'table-v1',usage:'deferred'});assert.equal(result.statusCode,200);assert(result.payload.files.length>0);
}));

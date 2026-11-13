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

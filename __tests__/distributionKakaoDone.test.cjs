const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createKakaoDoneStore}=require('../lib/distributionKakaoDoneStore');
test('real files preserve check/uncheck across new store, retries and conflicting users without raw data',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nenova-kakao-done-'));const key=crypto.createHash('sha256').update('fixture source').digest('hex');
 try{const a=createKakaoDoneStore({directory:root}),b=createKakaoDoneStore({directory:root});assert.equal((await a.read(key)).done,false);
  const req={key,done:true,expectedRevision:null,requestId:crypto.randomUUID()},saved=await a.save(req);assert.equal((await b.read(key)).done,true);assert.deepEqual(await b.save(req),saved);
  await assert.rejects(()=>b.save({...req,done:false,requestId:crypto.randomUUID()}),e=>e.statusCode===409&&e.current.done);
  const undone=await b.save({key,done:false,expectedRevision:saved.revision,requestId:crypto.randomUUID()});assert.equal((await createKakaoDoneStore({directory:root}).read(key)).done,false);
  const results=await Promise.allSettled([a,b].map(s=>s.save({key,done:true,expectedRevision:undone.revision,requestId:crypto.randomUUID()})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
  for(const f of await fs.readdir(root)){assert.match(f,/^[a-f0-9]{64}\.(?:root|[a-f0-9-]+)\.json$/);assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(root,f),'utf8'))).sort(),['key','done','previous','revision','at'].sort());}
  await assert.rejects(()=>a.read('../escape'));await assert.rejects(()=>a.save({...req,done:'true'}));
 }finally{assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'nenova-kakao-done-'));await fs.rm(root,{recursive:true,force:true});}
});
test('completion key changes with edited request and is stable across metadata',async()=>{
 const {requestDoneKey}=await import('../lib/distributionKakaoDoneClient.js');const r={id:'fixture',text:'업체A 수국 1박스 추가'};
 assert.equal(await requestDoneKey(r),await requestDoneKey({...r,time:'tomorrow'}));assert.notEqual(await requestDoneKey(r),await requestDoneKey({...r,text:'업체A 수국 2박스 추가'}));
});
test('actual completion API validates origin/body/method and persists only advisory state',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nenova-kakao-api-')),old=process.env.DISTRIBUTION_KAKAO_DONE_DIR;process.env.DISTRIBUTION_KAKAO_DONE_DIR=root;
 try{const api=require('../scripts/load-isolated-erp-api.cjs')('pages/api/kakao/request-done.js',{}),key=crypto.createHash('sha256').update('api fixture').digest('hex');
  const call=async(method,body={},headers={},query={})=>{let status=200,data;await api({method,body,headers:{host:'fixture.local',...headers},query,user:{userId:'fixture'}},{setHeader(){},status(n){status=n;return this},json(v){data=v;return this}});return {status,data};};
  const body={key,done:true,expectedRevision:null,requestId:crypto.randomUUID()};
  assert.equal((await call('POST',body,{origin:'https://evil.local'})).status,403);assert.equal((await call('POST',body,{origin:'https://fixture.local'})).status,403);assert.equal((await call('DELETE')).status,405);
  assert.equal((await call('POST',{...body,text:'raw chat must not be accepted'})).status,400);assert.equal((await fs.readdir(root)).length,0);
  assert.equal((await call('POST',body,{origin:'http://fixture.local'})).data.state.done,true);assert.equal((await call('GET',{}, {},{keys:key})).data.states[0].done,true);
  assert.equal((await call('POST',{...body,done:false,requestId:crypto.randomUUID()})).status,409);
 }finally{if(old===undefined)delete process.env.DISTRIBUTION_KAKAO_DONE_DIR;else process.env.DISTRIBUTION_KAKAO_DONE_DIR=old;assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'nenova-kakao-api-'));await fs.rm(root,{recursive:true,force:true});}
});

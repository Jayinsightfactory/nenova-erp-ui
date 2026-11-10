const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),store=require('../lib/shipmentStatementStore.cjs');
test('durable exact revisions, competing writers one winner, cross-year/customer isolation and reusable settings',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'statement-')),options={root},s={year:'2026',week:45,custKey:7},record={sourceHash:'hash',draft:{defaultDay:'수',groups:[],entries:{}}};
 try{
  assert.equal(await store.read(s,options),null);
  const results=await Promise.allSettled([store.save(s,record,0,'staff-a',options),store.save(s,record,0,'staff-b',options)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.statusCode,409);
  const one=await store.read(s,options);assert.equal(one.version,1);await store.save(s,{...record,draft:{...record.draft,defaultDay:'월'}},1,'staff-c',options);
  assert.equal((await store.read(s,{...options,revision:1})).draft.defaultDay,'수');assert.equal((await store.read(s,options)).draft.defaultDay,'월');
  assert.equal(await store.read({...s,year:'2025'},options),null);assert.equal(await store.read({...s,custKey:8},options),null);assert.equal((await store.latestPreferences(7,options)).defaultDay,'월');
  await assert.rejects(()=>store.save(s,record,1,'staff-a',options),{statusCode:409});await assert.rejects(()=>store.read({...s,year:'../'},options),{statusCode:400});
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

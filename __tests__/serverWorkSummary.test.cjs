'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {summary}=require('../scripts/server-work-summary.cjs');
test('separates order read/write timing, preserves the stages of the actual slow sample, and distinguishes no traffic',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nenova-summary-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const at=new Date().toISOString(),route='/api/orders',group={count:4,errors:0,busy:0,maxMs:18000,buckets:[2,0,0,0,0,0,0,2,0]},events=[
  {kind:'minute',loopMaxMs:12,cpuPct:11,rssMiB:120,groups:{[route]:group}},
  {kind:'request',route,method:'POST',ms:18000,status:200,stages:{dbQuery:4000,privateField:'private-value'},id:'private-value'},
  {kind:'request',route,method:'POST',ms:12000,status:503,stages:{dbQuery:8000}},
  {kind:'request',route,method:'GET',ms:1100,status:200,stages:{dbQuery:950}},
  {kind:'request',route:'/api/orders?name=private-value',method:'GET',ms:19999,status:500},
 ];
 await fs.writeFile(path.join(dir,'work-'+at.slice(0,10)+'.jsonl'),events.map(e=>JSON.stringify({...e,at})).join('\n'));
 const v=await summary(dir,30);assert.equal(v.slowSamples.length,2);assert.deepEqual(v.slowSamples[0],{route,method:'POST',samples:2,maxMs:18000,statusAtMax:200,stagesAtMaxMs:{dbQuery:4000}});
 assert.equal(v.slowSamples[1].method,'GET');assert.equal(v.focusRoutes.find(r=>r.route===route).count,4);assert.equal(v.focusRoutes.find(r=>r.route==='/api/desktop/home-workspace').p95BucketMs,null);
 assert.equal(v.slowStageMaxMs.dbQuery,8000);assert.ok(!JSON.stringify(v).includes('private-value'));
});

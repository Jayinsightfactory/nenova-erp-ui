'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {start,measure}=require('../lib/serverWorkTelemetry.cjs');
test('concurrent slow request keeps its own stage; private paths, headers and values never enter logs',async()=>{
 const events=[],obs=start({write:e=>events.push(e)}),server=http.createServer(async(req,res)=>{
   if(req.url.startsWith('/api/auth/login'))await measure('dbQuery',()=>new Promise(r=>setTimeout(r,30)));
   res.writeHead(503);res.end();
 });
 try{
   await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
   await Promise.all(['/api/auth/login?username=private123','/api/private123'].map(p=>fetch(origin+p,{headers:{authorization:'private123'}})));
   obs.tick();const reqs=events.filter(x=>x.kind==='request'),minute=events.find(x=>x.kind==='minute');
   assert.equal(reqs.length,2);assert.ok(reqs.find(x=>x.route==='/api/auth/login').stages.dbQuery>=20);
   assert.deepEqual(reqs.find(x=>x.route==='other-api').stages,{});assert.equal(minute.groups['other-api'].busy,1);
   assert.ok(!JSON.stringify(events).includes('private123'));
 }finally{obs.stop();await new Promise(r=>server.close(r));}
});

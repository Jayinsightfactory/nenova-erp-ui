const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {requestOptions,companyCalendarRequest}=require('../company-calendar.cjs');
test('shared calendar bridge fixes path, binds actor, strips renderer-supplied ownership and endpoints',()=>{
 const r=requestOptions({method:'POST',url:'https://evil.test',query:{month:'2026-11',ownerId:'other'},command:{action:'create',expectedRevision:0,requestId:randomUUID(),title:'회의',date:'2026-11-13',createdBy:'other',url:'/api/shipment'}},'verified');
 assert.equal(r.url,'https://nenovaweb.com/api/desktop/company-calendar');assert.equal(r.options.redirect,'error');const body=JSON.parse(r.options.body);assert.equal(body.expectedOwnerId,'verified');assert.deepEqual(body.query,{month:'2026-11'});assert.equal('createdBy'in body.command,false);assert.equal('url'in body.command,false);
 for(const query of [{week:'2026-02-30'},{month:'2026-13'},{}])assert.throws(()=>requestOptions({method:'GET',query},'a'));
 assert.throws(()=>requestOptions({method:'DELETE',query:{month:'2026-11'}},'a'));
});
test('bridge rejects late account results, unauthorized and oversized/mismatched responses',async()=>{
 const payload={method:'GET',query:{month:'2026-11'}},data={success:true,schemaVersion:1,ownerId:'a',revision:0,events:[]};let current=true,locked=false;
 const args={payload,owner:'a',isCurrent:()=>current,onUnauthorized:()=>locked=true};assert.equal((await companyCalendarRequest({...args,fetch:async()=>Response.json(data)})).revision,0);
 await assert.rejects(companyCalendarRequest({...args,fetch:async()=>{current=false;return Response.json(data);}}),/계정/);current=true;
 await assert.rejects(companyCalendarRequest({...args,fetch:async()=>Response.json({...data,ownerId:'b'})}),/계정/);
 await assert.rejects(companyCalendarRequest({...args,fetch:async()=>new Response('',{status:401})}),/로그인/);assert.equal(locked,true);
 assert.equal((await companyCalendarRequest({...args,fetch:async()=>Response.json({success:false,error:'conflict'},{status:409})})).status,409);
 await assert.rejects(companyCalendarRequest({...args,fetch:async()=>new Response('x',{headers:{'content-length':3*1024*1024}})}),/너무/);
});

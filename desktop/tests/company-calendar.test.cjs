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

test('bridge accepts only six-digit event colors and preserves omission for older editors',()=>{
 const payload={method:'POST',query:{month:'2026-11'},command:{action:'create',expectedRevision:0,requestId:randomUUID(),title:'회의',date:'2026-11-13'}};
 assert.equal('color'in JSON.parse(requestOptions(payload,'a').options.body).command,false);
 assert.equal(JSON.parse(requestOptions({...payload,command:{...payload.command,color:'#A13BCD'}},'a').options.body).command.color,'#a13bcd');
 for(const color of ['',null,123,'red','#abc','#12345678','var(--color)','url(x)'])assert.throws(()=>requestOptions({...payload,command:{...payload.command,color}},'a'),/색상/);
});

test('bridge transports only validated weekly range and explicit series acknowledgement',()=>{
 const payload={method:'POST',query:{month:'2027-01'},command:{action:'update',expectedRevision:1,requestId:randomUUID(),id:randomUUID(),title:'선주문 1차',date:'2026-11-25',weekly:{endDate:'2026-11-27',deadline:'2027-01-08',inclusive:false},recurringEdit:true}};
 const command=JSON.parse(requestOptions(payload,'a').options.body).command;assert.deepEqual(command.weekly,payload.command.weekly);assert.equal(command.recurringEdit,true);const reset={...payload.command.weekly,resetDate:'2027-01-06'};assert.deepEqual(JSON.parse(requestOptions({...payload,command:{...payload.command,weekly:reset}},'a').options.body).command.weekly,reset);
 for(const weekly of [null,[],{endDate:'2026-02-30',deadline:'2027-01-08'},{endDate:'2026-11-27',deadline:'2027-01-08',inclusive:0},{...payload.command.weekly,startNumber:1},{...payload.command.weekly,createdBy:'other'}])assert.throws(()=>requestOptions({...payload,command:{...payload.command,weekly}},'a'));
 assert.throws(()=>requestOptions({...payload,command:{...payload.command,recurringEdit:'true'}},'a'));
 for(const resetDate of ['',null,'2027-02-30'])assert.throws(()=>requestOptions({...payload,command:{...payload.command,weekly:{...payload.command.weekly,resetDate}}},'a'));
 const older={...payload.command};delete older.weekly;delete older.recurringEdit;const oldCommand=JSON.parse(requestOptions({...payload,command:older},'a').options.body).command;assert.equal('weekly'in oldCommand,false);assert.equal('recurringEdit'in oldCommand,false);
});

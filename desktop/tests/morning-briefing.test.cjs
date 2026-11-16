'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {morningBriefing,projectBriefing}=require('../morning-briefing.cjs');
const card=(extra={})=>({id:'orderRequests',title:'주문 신청 승인 대기',status:'red',statusLabel:'바로 확인',headline:'2건 대기',lines:['연습꽃집 가'],more:0,href:'/admin/order-requests',linkLabel:'열기',...extra});
const body=(cards=[card()])=>({success:true,ownerId:'u1',today:'2026-11-15',summary:'바로 확인할 것 1가지',overall:'red',generatedAt:'2026-11-15T00:00:00Z',cards});
const reply=(status,data)=>({status,ok:status>=200&&status<300,text:async()=>JSON.stringify(data)});

test('cards are bounded, statuses whitelisted and the tally is recounted from cards',()=>{
  const out=projectBriefing(body([card(),card({id:'week',status:'weird',headline:'x'.repeat(500),lines:Array(20).fill('줄')}),card({id:'',title:''})]));
  assert.equal(out.cards.length,2);assert.equal(out.cards[1].status,'gray');assert.equal(out.cards[1].headline.length,120);assert.equal(out.cards[1].lines.length,8);
  assert.deepEqual(out.tally,{red:1,amber:0,green:0,gray:1});assert.equal(out.overall,'red');
});
test('only same-site screen paths survive as links',()=>{
  for(const href of ['https://evil.example/','//evil.example','javascript:alert(1)','/a b'])assert.equal(projectBriefing(body([card({href})])).cards[0].href,'');
  assert.equal(projectBriefing(body([card({href:'/mgmt/approvals?status=requested'})])).cards[0].href,'/mgmt/approvals?status=requested');
});
test('a server "green" summary cannot hide missing cards',()=>{
  assert.equal(projectBriefing({...body([]),overall:'green'}).overall,'gray');
  assert.equal(projectBriefing(body([card({status:'green'}),card({id:'week',status:'gray',unavailable:true})])).overall,'gray');
  assert.equal(projectBriefing(body([card({status:'green'}),card({id:'creditLimit',status:'gray',statusLabel:'한도 미설정'})])).overall,'green');
  assert.throws(()=>projectBriefing({success:false}));assert.throws(()=>projectBriefing({success:true,cards:'x'}));
});
test('request is one credentialed GET and fails closed on account change, 401 and old servers',async()=>{
  const calls=[];let current=true,unauthorized=0;
  const run=(status,data,owner='u1')=>morningBriefing({owner,isCurrent:()=>current,onUnauthorized:()=>unauthorized++,fetch:async(url,options)=>{calls.push([url,options.method,options.credentials]);return reply(status,data);}});
  const ok=await run(200,body());assert.equal(ok.success,true);assert.equal(ok.ownerId,'u1');assert.equal(ok.cards.length,1);
  assert.equal(calls.length,1);assert.match(calls[0][0],/\/api\/briefing$/);assert.equal(calls[0][1],'GET');assert.equal(calls[0][2],'include');
  await assert.rejects(run(200,body(),'someone-else'),/계정이 변경/);
  await assert.rejects(run(401,{}),/로그인/);assert.equal(unauthorized,1);
  await assert.rejects(run(404,{}),/아직 반영되지/);await assert.rejects(run(500,{}),/500/);
  current=false;await assert.rejects(run(200,body()),/로그인이 필요/);await assert.rejects(morningBriefing({owner:'',isCurrent:()=>true}),/로그인이 필요/);
});

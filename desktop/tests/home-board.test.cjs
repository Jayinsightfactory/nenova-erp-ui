const test=require('node:test'),assert=require('node:assert/strict');
const {homeRequests,projectRequests}=require('../home-board.cjs');
const {closeMainAction}=require('../lifecycle.cjs');
test('closing a work window preserves notes; explicit quit closes everything',()=>{
  for(const mainCount of [1,2])assert.equal(closeMainAction({mainCount,notesOpen:true}),'close-window');
  assert.equal(closeMainAction({mainCount:1,notesOpen:false}),'quit');
  assert.equal(closeMainAction({mainCount:2,notesOpen:true,explicitQuit:true}),'quit');
});
test('board exposes canonical labels and safe summary fields only',()=>{
  const rows=projectRequests([{id:'ABCDEF123456',title:'request',status:'working',category:'feature',at:'2026-11-13T00:00:00Z',by:'private',body:'secret',shot:'secret',log:['secret']},{id:'bad',title:'bad'}]);
  assert.deepEqual(rows,[{id:'abcdef123456',title:'request',status:'working',statusLabel:'처리중',categoryLabel:'기능요청',updatedAt:'2026-11-13T00:00:00.000Z'}]);
  assert.throws(()=>projectRequests(Array(201).fill({})));
});
test('board uses fixed GET, prevents stale-account responses and rejects unauthorized',async()=>{
  let current=true,unauthorized=0;
  const fetch=async(url,options)=>{assert.equal(url,'https://nenovaweb.com/api/pm/staff-requests');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');return Response.json({success:true,requests:[]});};
  assert.equal((await homeRequests({owner:'a',fetch,isCurrent:()=>current})).ownerId,'a');
  await assert.rejects(homeRequests({owner:'a',fetch:async(...args)=>{const r=await fetch(...args);current=false;return r;},isCurrent:()=>current}),/계정/);
  await assert.rejects(homeRequests({owner:'a',fetch:async()=>new Response('',{status:401}),isCurrent:()=>true,onUnauthorized:()=>unauthorized++}),/로그인/);assert.equal(unauthorized,1);
});

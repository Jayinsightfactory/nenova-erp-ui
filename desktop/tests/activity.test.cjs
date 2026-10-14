'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createActivity } = require('../activity.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
test('desktop keeps unacknowledged events encrypted-writer ready, retries idempotently and isolates accounts', async () => {
  let saved = [], current = 'alice', online = false;
  const calls = [], warnings = [];
  const opts = {read:()=>saved,write:rows=>{saved=structuredClone(rows);},owner:()=>current,endpoint:'https://nenovaweb.com/api/work/activity',warn:x=>warnings.push(x),fetch:async (url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);if(!online)throw Error('offline');
    return {ok:true,json:async()=>({success:true,acceptedIds:body.events.map(e=>e.id)})};
  }};
  const a=createActivity(opts);a.record('rename','/orders?password=secret#token');await tick();
  assert.equal(saved.length,1);assert.equal(saved[0].event.path,'/orders');assert.equal(saved[0].event.label,'탭 이름 변경');assert.ok(!JSON.stringify(saved).includes('secret'));
  const id=saved[0].event.id; current='bob';online=true; await a.flush();assert.equal(saved.length,1);
  const restored=createActivity(opts);current='alice';await restored.flush();assert.equal(saved.length,0);assert.equal(calls.at(-1).events[0].id,id);assert.equal(calls.at(-1).expectedUserId,'alice');assert.ok(warnings.some(Boolean));
});
test('unknown commands, automatic state and unauthenticated shell are not fabricated as user operations',()=>{
  let owner='';const saved=[];const a=createActivity({read:()=>[],write:x=>saved.push(x),owner:()=>owner,fetch:async()=>{throw Error('offline');},endpoint:'/'});
  a.record('open','/');owner='alice';a.record('state','/');a.record('homeDraft','/');assert.equal(a.pending(),0);assert.equal(saved.length,0);
});
test('disk persistence errors remain visible and memory queue is retained',async()=>{
  const warnings=[];const a=createActivity({read:()=>[],write:()=>{throw Error('disk');},owner:()=>'alice',fetch:async()=>{throw Error('offline');},endpoint:'/',warn:x=>warnings.push(x)});
  a.record('open','/dashboard');await tick();assert.equal(a.pending(),1);assert.ok(warnings.some(x=>x.includes('디스크')));
});

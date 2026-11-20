import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCountryOrderEvidence as reconcile } from '../lib/countryOrderReconciliation.js';
const scope={country:'China',year:2026,orderWeek:'47-02'};
const cell={custKey:1,prodKey:2,unit:'bunches',quantity:100};
const item={sourceKey:'message-1/row-1',scope,custKey:1,prodKey:2,unit:'bunches',quantity:20,at:'2026-11-19T02:00:00Z',kind:'addition',selected:true};
const baseline={scope,queriedAt:'2026-11-19T01:00:00Z',deliveredAt:'2026-11-19T01:10:00Z',rows:[cell],sourceKeys:[]};
const make=(quantity=100)=>({scope,baseline,current:{scope,queriedAt:'2026-11-19T03:00:00Z',rows:[{...cell,quantity},{...cell,custKey:3,quantity:50}]},messages:[item],decisions:{},events:[]});
const event={id:'history-8',scope,custKey:1,prodKey:2,unit:'bunches',orderDetailKey:8,kind:'increase',before:100,after:120,at:'2026-11-19T02:05:00Z'};
test('100→120 with proven registered20 exports120; all other ERP orders survive',()=>{
  const data=make(120);data.events=[event];data.decisions[item.sourceKey]={mode:'registered',eventId:event.id};const result=reconcile(data);
  assert.equal(result.canExport,true);assert.deepEqual(result.rows.map(r=>r.quantity),[120,50]);assert.equal(result.findings[0].status,'REGISTERED');assert.equal(result.rows[0].additionalQuantity,0);
});
test('chat-only20 explicitly confirmed gives120 without any ERP mutation',()=>{
  const data=make();data.decisions[item.sourceKey]={mode:'new',confirmed:true};const before=JSON.stringify(data);assert.equal(reconcile(data).rows[0].quantity,120);assert.equal(JSON.stringify(data),before);
});
test('same source duplicate only adds20 once, equal separate source adds another20',()=>{
  const data=make();data.decisions[item.sourceKey]={mode:'new',confirmed:true};data.messages.push({...item});assert.equal(reconcile(data).rows[0].quantity,120);assert.equal(reconcile(data).duplicateCount,1);
  const second={...item,sourceKey:'message-2/row-1'};data.messages.push(second);data.decisions[second.sourceKey]={mode:'new',confirmed:true};assert.equal(reconcile(data).rows[0].quantity,140);
});
test('partial110 and unproven same total120 require review, never auto-add remainder',()=>{
  for(const qty of [110,120]){const data=make(qty);data.decisions[item.sourceKey]={mode:'new',confirmed:true};const result=reconcile(data);assert.equal(result.canExport,false);assert.equal(result.rows[0].quantity,qty);}
});
test('country/year/week isolated and no missing baseline guess',()=>{
  for(const patch of [{year:2025},{country:'Colombia'},{orderWeek:'47-01'}]){const data=make();data.messages=[{...item,scope:{...scope,...patch}}];assert.equal(reconcile(data).canExport,false);assert.equal(reconcile(data).rows[0].quantity,100);}
  const data=make();data.baseline=null;assert.equal(reconcile(data).canExport,false);
});
test('wrong unit/customer/quantity/time event or already allocated event blocks',()=>{
  for(const patch of [{unit:'stems'},{custKey:4},{after:110},{at:'2026-11-19T01:50:00Z'}]){const data=make(120);data.events=[{...event,...patch}];data.decisions[item.sourceKey]={mode:'registered',eventId:event.id};assert.equal(reconcile(data).canExport,false);}
  const data=make(120),second={...item,sourceKey:'other'};data.messages.push(second);data.events=[event];data.decisions=Object.fromEntries([item,second].map(i=>[i.sourceKey,{mode:'registered',eventId:event.id}]));assert.equal(reconcile(data).canExport,false);
});
test('cancel/correction and missing time never enter additions; sent source never adds again',()=>{
  for(const patch of [{kind:'cancel'},{kind:'correction'},{at:''}]){const data=make();data.messages=[{...item,...patch}];assert.equal(reconcile(data).canExport,false);}
  const data=make(120);data.baseline={...baseline,sourceKeys:[item.sourceKey]};assert.equal(reconcile(data).rows[0].quantity,120);assert.equal(reconcile(data).findings[0].status,'ALREADY_SENT');
});
test('sent chat-only additions survive reentry while ERP is unchanged; later registration consumes carry',()=>{
  const first=make();first.decisions[item.sourceKey]={mode:'new',confirmed:true};const result=reconcile(first);
  const saved={...baseline,queriedAt:first.current.queriedAt,deliveredAt:'2026-11-19T03:10:00Z',rows:result.rows,erpRows:first.current.rows,pendingSources:result.pendingSources,sourceKeys:result.sourceKeys};
  const next=make();next.baseline=saved;next.current.queriedAt='2026-11-19T04:00:00Z';next.messages=[];
  assert.equal(reconcile(next).rows[0].quantity,120);assert.equal(reconcile(next).findings[0].status,'CARRY_PENDING');
  next.current.rows[0].quantity=120;next.events=[{...event,at:'2026-11-19T03:30:00Z'}];assert.equal(reconcile(next).canExport,false);
  next.decisions[item.sourceKey]={mode:'registered',eventId:event.id};assert.equal(reconcile(next).rows[0].quantity,120);assert.deepEqual(reconcile(next).pendingSources,[]);
});

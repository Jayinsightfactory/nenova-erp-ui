import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {qualityScope,qualitySignals,transitionQuality} from '../lib/farmQuality.js';
import {buildQualityInbox,resolveQualityInboxTarget,qualityInboxMutationPolicy,inboxError} from '../lib/farmQualityInbox.js';
import {normalizeEvidenceKeys} from '../lib/farmQualityEvidence.js';
const code=fs.readFileSync('lib/farmQualityInboxStore.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const source=(key,extra={})=>({DeductionKey:key,OrderYear:2026,OrderWeek:'12',ProdKey:1,ProductName:'장미',FarmName:'',FarmKey:null,SourceUnit:'박스',Quantity:2,ImportConfirmed:false,CustKey:key,CustName:`업체 ${key}`,...extra});
let sources=[source(1),source(2)],inboxes=[],links=[],cases=[],events=[],evidence=[],writes=[],failLinks=false,lockCount=0;
let schema={inboxId:1,sourceId:2,caseInboxLength:16};
const q=async(text,p={})=>{
 const v=k=>p[k]?.value;
 if(text.includes('OBJECT_ID'))return {recordset:[schema]};
 if(text.includes('sp_getapplock')){lockCount++;assert.equal(v('resource'),'farm-quality-inbox:2026');return {recordset:[{LockResult:0}]};}
 if(text.includes('WHERE e.RequestKey=@req'))return {recordset:events.filter(e=>e.RequestKey===v('req')).map(e=>({...e,OrderYear:cases.find(c=>c.CaseKey===e.CaseKey)?.OrderYear}))};
 if(text.includes('FROM dbo.WebSalesDefectDeduction'))return {recordset:sources.filter(s=>s.OrderYear===v('year'))};
 if(text.startsWith('SELECT * FROM dbo.WebFarmQualityInboxSource'))return {recordset:structuredClone(links.filter(l=>l.OrderYear===v('year')))};
 if(text.startsWith('SELECT * FROM dbo.WebFarmQualityInbox'))return {recordset:structuredClone(inboxes.filter(i=>i.OrderYear===v('year')))};
 if(text.startsWith('SELECT * FROM dbo.WebFarmQualityCase'))return {recordset:structuredClone(cases.filter(c=>c.OrderYear===v('year')))};
 if(text.startsWith('SELECT e.EventKey'))return {recordset:structuredClone(events.filter(e=>cases.some(c=>c.CaseKey===e.CaseKey&&c.OrderYear===v('year'))))};
 writes.push(text);
 if(text.startsWith('INSERT dbo.WebFarmQualityInboxSource')){
  if(failLinks)throw Error('injected link failure');
  for(const name of Object.keys(p).filter(k=>/^source\d+$/.test(k))){assert(!links.some(l=>l.OrderYear===v('year')&&l.SourceKey===v(name)),'ownership must be unique');links.push({OrderYear:v('year'),SourceKey:v(name),InboxKey:v('inbox'),LinkedEventKey:v('event')});}
  return {recordset:[]};
 }
 if(text.startsWith('INSERT dbo.WebFarmQualityInbox(')){inboxes.push({InboxKey:v('inbox'),OrderYear:v('year'),Version:1,Excluded:0});return {recordset:[]};}
 if(text.startsWith('INSERT dbo.WebFarmQualityCase')){cases.push({CaseKey:v('key'),OrderYear:v('year'),SourceKey:v('source'),ProdKey:v('prod'),FarmName:v('farm'),FarmKey:v('fk'),ProductName:v('product'),Title:v('title'),Status:'NEW',Version:1,InboxKey:v('inbox')});return {recordset:[]};}
 if(text.startsWith('INSERT dbo.WebFarmQualityEvent')){const e={EventKey:events.length+1,CaseKey:v('key'),RequestKey:v('req'),PayloadHash:v('hash'),Kind:v('kind'),Body:v('body'),AfterStatus:v('after'),BeforeStatus:v('before'),AuthorName:v('name'),CreatedAt:new Date('2026-09-15T00:00:00Z')};events.push(e);return {recordset:[e]};}
 if(text.startsWith('UPDATE dbo.WebFarmQualityCase SET InboxKey')){cases.find(c=>c.CaseKey===v('key')).InboxKey=v('inbox');return {recordset:[]};}
 if(text.startsWith('UPDATE dbo.WebFarmQualityCase')){const c=cases.find(c=>c.CaseKey===v('key'));c.Status=v('status');c.Version++;return {recordset:[]};}
 if(text.startsWith('UPDATE dbo.WebFarmQualityInbox')){const i=inboxes.find(i=>i.InboxKey===v('inbox'));i.Version++;if(v('reactivate')===1)i.Excluded=0;if(p.excluded){i.Excluded=v('excluded');i.ExclusionReason=v('reason');}return {recordset:[]};}
 if(text.startsWith('SELECT EvidenceKey'))return {recordset:evidence.filter(e=>e.EvidenceKey===v('evidence')&&e.OrderYear===v('year')&&e.CreatedBy===v('actor')&&!e.EventKey)};
 if(text.startsWith('UPDATE dbo.WebFarmQualityEvidence')){evidence.find(e=>e.EvidenceKey===v('evidence')).EventKey=v('event');return {recordset:[]};}
 throw Error(`Unexpected SQL ${text}`);
};
// Serialize fake transactions exactly as the transaction-owned year lock does.
let queue=Promise.resolve();
const tx=fn=>{const run=queue.then(async()=>{const snap=structuredClone({inboxes,links,cases,events,evidence});try{return await fn(q);}catch(e){({inboxes,links,cases,events,evidence}=snap);throw e;}});queue=run.catch(()=>{});return run;};
const api=await new AsyncFunction('crypto','query','sql','withTransaction','qualityScope','qualitySignals','transitionQuality','buildQualityInbox','resolveQualityInboxTarget','qualityInboxMutationPolicy','inboxError','normalizeEvidenceKeys',code+';return {loadQualityInbox,saveQualityInboxEvent,setQualityInboxExclusion};')(crypto,q,{NVarChar:1,Int:2,UniqueIdentifier:3,BigInt:4},tx,qualityScope,qualitySignals,transitionQuality,buildQualityInbox,resolveQualityInboxTarget,qualityInboxMutationPolicy,inboxError,normalizeEvidenceKeys);
const sales={userId:'s',deptName:'영업부'},manager={userId:'m',deptName:'수입부'};
const item=()=>api.loadQualityInbox({year:2026}).then(r=>r.items[0]);
const target=i=>({anchorSourceKey:i.sourceKeys[0],revision:i.revision,...(i.inboxKeys.length?{inboxKey:i.inboxKeys[0]}:{}),...(i.caseKeys.length?{caseKey:i.caseKeys[0]}:{})});
const input=i=>({year:2026,target:target(i),kind:'COMMENT',body:'관찰',requestId:crypto.randomUUID(),caseVersion:i.cases[0]?.version,inboxVersion:i.exclusionScopes[0]?.version});
const initial=await item();assert.equal(writes.length,0,'GET never writes');
const draft=input(initial);
for(const missing of ['inboxId','sourceId','caseInboxLength']){
 const previous=schema;schema={...schema,[missing]:null};
 const beforeWrites=writes.length,beforeLocks=lockCount;
 await assert.rejects(api.loadQualityInbox({year:2026}),e=>e.code==='INBOX_NOT_READY'&&e.message.includes('저장소 설치'));
 await assert.rejects(api.saveQualityInboxEvent(draft,sales),e=>e.code==='INBOX_NOT_READY');
 await assert.rejects(api.setQualityInboxExclusion({...draft,action:'exclude',reason:'검토'},manager),e=>e.code==='INBOX_NOT_READY');
 assert.equal(writes.length,beforeWrites);assert.equal(lockCount,beforeLocks,'missing schema rejects before starting mutation');
 schema=previous;
}
const first=await api.saveQualityInboxEvent(draft,sales);
assert.equal(cases.length,1);assert.equal(events.length,1);assert.equal(links.length,2);assert.equal(cases[0].FarmName,'');assert.equal(cases[0].FarmKey,null);
assert(!('PayloadHash' in first.event));assert(!('RequestKey' in first.event));
assert.equal((await api.saveQualityInboxEvent(draft,sales)).replayed,true);assert.equal(events.length,1);
await assert.rejects(api.saveQualityInboxEvent({...draft,body:'변경'},sales),e=>e.code==='INBOX_INVALID');
await assert.rejects(api.saveQualityInboxEvent({...draft,requestId:crypto.randomUUID()},sales),e=>e.code==='INBOX_STALE');
const exclusion={...input(await item()),action:'exclude',reason:'검토 후 제외'};
await assert.rejects(api.setQualityInboxExclusion(exclusion,sales),e=>e.code==='INBOX_FORBIDDEN');
await api.setQualityInboxExclusion(exclusion,manager);assert.equal(cases[0].Status,'NEW');assert((await item()).excluded);
await assert.rejects(api.saveQualityInboxEvent(input(await item()),sales));
await api.setQualityInboxExclusion({...input(await item()),action:'restore',reason:'추가 확인'},manager);assert(!(await item()).excluded);
sources.push(source(3));const grown=await item();assert.deepEqual(grown.newSourceKeys,[3]);
const snap=structuredClone({inboxes,links,cases,events,evidence});failLinks=true;
await assert.rejects(api.saveQualityInboxEvent(input(grown),sales),/injected/);failLinks=false;
assert.deepEqual({inboxes,links,cases,events,evidence},snap,'failed membership acknowledgement rolls back every write');
await api.saveQualityInboxEvent(input(await item()),sales);assert.equal(links.length,3);
const invalidEvidence={...input(await item()),evidenceKeys:[crypto.randomUUID()]},eventCount=events.length;
await assert.rejects(api.saveQualityInboxEvent(invalidEvidence,sales));assert.equal(events.length,eventCount);
const request={...input(await item()),kind:'REQUEST',eventDate:'2026-09-15',dueDate:'2026-09-20'};
await api.saveQualityInboxEvent(request,manager);assert.equal(cases[0].Status,'WAITING');
for(const kind of ['COMMENT','REQUEST']){
 await api.setQualityInboxExclusion({...input(await item()),action:'exclude',reason:`${kind} 이전 제외 사유`},manager);
 assert((await item()).excluded);
 const oldAuditCount=events.filter(e=>e.Kind==='EXCLUDE').length;
 sources.push(source(sources.length+1));
 const fresh=await item();assert(!fresh.excluded);assert.equal(fresh.newSourceKeys.length,1);
 await api.saveQualityInboxEvent({...input(fresh),kind,...(kind==='REQUEST'?{eventDate:'2026-09-15',dueDate:'2026-09-20'}:{})},kind==='COMMENT'?sales:manager);
 const reloaded=await item();
 assert.deepEqual(reloaded.newSourceKeys,[]);
 assert.equal(reloaded.excluded,false,`${kind} acknowledgement must remain active after reload`);
 assert.equal(inboxes[0].Excluded,0,'reactivation must be durable, not inferred only from timestamps');
 assert.equal(inboxes[0].ExclusionReason,`${kind} 이전 제외 사유`);
 assert.equal(events.filter(e=>e.Kind==='EXCLUDE').length,oldAuditCount,'prior exclusion audit remains intact');
}
// Fresh first REQUEST with unknown farm succeeds; overlapping first saves stale.
inboxes=[];links=[];cases=[];events=[];
const virtual=await item(),a={...input(virtual),kind:'REQUEST',eventDate:'2026-09-15',dueDate:'2026-09-20'},b=input(virtual);
const concurrent=await Promise.allSettled([api.saveQualityInboxEvent(a,manager),api.saveQualityInboxEvent(b,sales)]);
assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal(cases.length,1);assert.equal(cases[0].Status,'WAITING');
assert.equal(new Set(links.map(l=>l.SourceKey)).size,sources.length);assert(lockCount>0);
// A stale cross-year anchor cannot materialize another year's source.
const currentItem=await item(),beforeYear=structuredClone({inboxes,links,cases,events});
sources=sources.map(s=>({...s,OrderYear:2025}));
await assert.rejects(api.saveQualityInboxEvent({...input(currentItem),requestId:crypto.randomUUID()},sales),e=>e.code==='INBOX_STALE');
assert.deepEqual({inboxes,links,cases,events},beforeYear);
const apiSource=fs.readFileSync('pages/api/sales/farm-quality.js','utf8');
assert(apiSource.indexOf('req.headers.origin')<apiSource.indexOf("req.body.action==='inboxEvent'"),'new endpoint actions remain behind same-origin validation');
assert.match(apiSource,/saveQualityInboxEvent\(req.body,req.user\)/);
const migration=fs.readFileSync('docs/migrations/2026-09-14_farm_quality.sql','utf8');
assert.match(migration,/PRIMARY KEY\(OrderYear,SourceKey\)/);
assert.match(migration,/FOREIGN KEY\(InboxKey,OrderYear\)/);
assert.match(migration,/FOREIGN KEY\(LinkedEventKey\)/);
console.log('Farm inbox store: first comment/request, ownership, replay, rollback, exclusions and read-only GET passed');

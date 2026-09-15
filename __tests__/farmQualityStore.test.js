import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {canDeleteFarmQuality,qualityScope,qualityGroups,qualityAnalytics,qualitySignals,qualitySourceCoverage,qualitySignalCoverage,transitionQuality} from '../lib/farmQuality.js';
import {normalizeEvidenceKeys} from '../lib/farmQualityEvidence.js';
const source=fs.readFileSync('lib/farmQualityStore.js','utf8').replace(/^(?:import|export \{).*;\r?\n/gm,'').replaceAll('export async function','async function')+'\nconst loadQualityInbox=async()=>({items:[],counts:{total:0}}); const lockQualityInboxYear=async()=>{};';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const incoming={userId:'u1',userName:'담당자',deptName:'수입부'};
let cases=[],events=[],evidence=[],rollbacks=0;
let anchorOwned=false;
const validSource={DeductionKey:10,OrderYear:2026,OrderWeek:'36',ProdKey:5,ProductName:'Novia',FarmName:'Farm',FarmKey:2,SourceUnit:'박스',Quantity:1,ImportConfirmed:true};
let mockSources=[validSource];
const caseEventWriteAttempts=[];
const q=async(sql,p={})=>{
 const v=k=>p[k]?.value;
 if(sql.startsWith('SELECT InboxKey FROM dbo.WebFarmQualityInboxSource'))return {recordset:anchorOwned?[{InboxKey:'11111111-1111-4111-8111-111111111111'}]:[]};
 if(sql.startsWith('DELETE FROM dbo.WebFarmQualityInboxSource'))return {recordset:[]};
 if(/(?:INSERT|UPDATE|DELETE)\s+(?:FROM\s+)?dbo\.WebFarmQuality(?:Case|Event)\b/i.test(sql))caseEventWriteAttempts.push(sql);
 if(sql.includes('OBJECT_ID'))return {recordset:[{id:1,caseId:1,evidenceId:1}]};
 if(sql.includes('SELECT CaseKey,PayloadHash'))return {recordset:events.filter(e=>e.RequestKey===v('req'))};
 if(sql.includes('FROM dbo.WebSalesDefectDeduction'))return {recordset:mockSources.filter(row=>Number(row.OrderYear)===v('year')&&(v('source')==null||Number(row.DeductionKey)===v('source')))};
 if(sql.includes('FROM dbo.ViewWarehouse vw'))return {recordset:[]};
 if(sql.includes('SELECT c.*, latest.Body'))return {recordset:[{...cases[0],FarmName:'Farm',ProdKey:5,ProductName:'Novia',Title:'손상',CreatedByName:'담당자',DueDate:null,UpdatedAt:new Date('2026-09-14T01:00:00Z')}]};
 if(sql.includes('WITH RankedEvents'))return {recordset:[
  {CaseKey:cases[0].CaseKey,EventKey:2,Kind:'REQUEST',Body:'농장 확인 요청',EventNo:2,EventCount:4,CreatedAt:new Date('2026-09-14T01:01:00Z')},
  {CaseKey:cases[0].CaseKey,EventKey:3,Kind:'RESPONSE',Body:'농장 답변',EventNo:3,EventCount:4,CreatedAt:new Date('2026-09-14T01:02:00Z')},
  {CaseKey:cases[0].CaseKey,EventKey:4,Kind:'COMMENT',Body:'추가 코멘트',EventNo:4,EventCount:4,CreatedAt:new Date('2026-09-14T01:03:00Z')}
 ]};
 if(sql.includes('INSERT dbo.WebFarmQualityCase')){cases.push({CaseKey:v('key'),OrderYear:v('year'),Status:'NEW',Version:1});return {recordset:[]};}
 if(sql.includes('SELECT * FROM dbo.WebFarmQualityCase'))return {recordset:cases.filter(c=>c.CaseKey===v('key')&&c.OrderYear===v('year'))};
 if(sql.includes('SELECT CaseKey,Version,Title FROM dbo.WebFarmQualityCase'))return {recordset:cases.filter(c=>String(c.CaseKey).toLowerCase()===String(v('key')).toLowerCase()&&c.OrderYear===v('year'))};
 if(sql.includes('SELECT EventKey FROM dbo.WebFarmQualityEvent'))return {recordset:events.filter(e=>String(e.CaseKey).toLowerCase()===String(v('key')).toLowerCase()).map(e=>({EventKey:e.EventKey}))};
 if(sql.includes('INSERT dbo.WebFarmQualityEvent')){const EventKey=events.length+1;const saved={EventKey,CaseKey:v('key'),RequestKey:v('req'),PayloadHash:v('hash'),Kind:v('kind'),Body:v('body'),AuthorId:v('author'),AuthorName:v('name'),Department:v('dept'),BeforeStatus:v('before'),AfterStatus:v('after'),EventDate:v('date'),DueDate:v('due'),AppliedWeek:v('applied'),CreatedAt:new Date('2026-09-14T01:00:00Z')};events.push(saved);return {recordset:[saved]};}
 if(sql.includes('SELECT EvidenceKey FROM dbo.WebFarmQualityEvidence'))return {recordset:evidence.filter(e=>e.EvidenceKey===v('evidence')&&e.OrderYear===v('year')&&e.CreatedBy===v('author')&&e.EventKey==null)};
 if(sql.includes('UPDATE dbo.WebFarmQualityEvidence SET EventKey')){const e=evidence.find(e=>e.EvidenceKey===v('evidence')&&e.EventKey==null);if(e)e.EventKey=v('event');return {recordset:[]};}
 if(sql.includes('DELETE FROM dbo.WebFarmQualityEvidence')){evidence=evidence.filter(e=>e.EventKey!==v('event'));return {recordset:[]};}
 if(sql.includes('DELETE FROM dbo.WebFarmQualityEvent')){events=events.filter(e=>String(e.CaseKey).toLowerCase()!==String(v('key')).toLowerCase());return {recordset:[]};}
 if(sql.includes('DELETE FROM dbo.WebFarmQualityCase')){const before=cases.length;cases=cases.filter(c=>!(String(c.CaseKey).toLowerCase()===String(v('key')).toLowerCase()&&c.OrderYear===v('year')&&c.Version===v('version')));return {recordset:[],rowsAffected:[before-cases.length]};}
 if(sql.includes('UPDATE dbo.WebFarmQualityCase')){const c=cases.find(c=>c.CaseKey===v('key')&&c.OrderYear===v('year'));c.Status=v('status');c.Version++;c.DueDate=v('kind')==='REQUEST'?v('due'):c.DueDate;c.AppliedWeek=v('kind')==='APPLY'?v('applied'):v('kind')==='REQUEST'?null:c.AppliedWeek;c.UpdatedAt=new Date('2026-09-14T01:00:00Z');return {recordset:[{Version:c.Version,Status:c.Status,DueDate:c.DueDate,AppliedWeek:c.AppliedWeek,UpdatedAt:c.UpdatedAt}]};}
 throw Error('Unexpected SQL '+sql);
};
const tx=async fn=>{const snapshot=structuredClone({cases,events,evidence});try{return await fn(q);}catch(e){cases=snapshot.cases;events=snapshot.events;evidence=snapshot.evidence;rollbacks++;throw e;}};
const {deleteQualityCase,loadQuality,saveQuality}=await new AsyncFunction('crypto','query','sql','withTransaction','canDeleteFarmQuality','qualityScope','qualityGroups','qualityAnalytics','qualitySignals','qualitySourceCoverage','transitionQuality','canUseDefectIncoming','normalizeEvidenceKeys','qualitySignalCoverage',source+';return {deleteQualityCase,loadQuality,saveQuality};')(crypto,q,{NVarChar:1,Int:2,UniqueIdentifier:3,BigInt:4},tx,canDeleteFarmQuality,qualityScope,qualityGroups,qualityAnalytics,qualitySignals,qualitySourceCoverage,transitionQuality,u=>u.deptName==='수입부',normalizeEvidenceKeys,qualitySignalCoverage);
const create={action:'create',year:2026,sourceKey:10,title:'손상',body:'관찰',requestId:crypto.randomUUID()};
for(const scenario of [
 {label:'unconfirmed',patch:{ImportConfirmed:false},kind:'SAME_ITEM_WEEK'},
 {label:'missing farm',patch:{FarmName:'',FarmKey:null},kind:'UNASSIGNED_ITEM_WEEK'},
]){
 mockSources=[
  {...validSource,...scenario.patch,CustKey:101,CustName:'업체 A'},
  {...validSource,...scenario.patch,DeductionKey:11,CustKey:102,CustName:'업체 B'},
 ];
 const candidate=qualitySignals(mockSources,qualityScope({year:2026})).find(signal=>signal.kind===scenario.kind);
 assert(candidate,`${scenario.label} source must still appear in automatic detection`);
 assert.equal(candidate.canCreate,false);assert.equal(candidate.sourceKey,null);
 const snapshot=structuredClone({cases,events}),attempts=caseEventWriteAttempts.length;
 await assert.rejects(saveQuality({...create,sourceKey:10,requestId:crypto.randomUUID()},incoming),/수입부 확인이 완료된 품목·농장만 등록할 수 있습니다/);
 assert.deepEqual({cases,events},snapshot,`${scenario.label} rejection preserves stored cases/events`);
 assert.equal(caseEventWriteAttempts.length,attempts,`${scenario.label} must reject before any Case/Event write, even a rolled-back write`);
}
mockSources=[validSource];
const first=await saveQuality(create,incoming);
assert.equal(first.caseVersion,2);assert.equal(first.event.Body,'관찰');assert.equal(first.event.EventKey,'1');
assert.equal(cases.length,1);assert.equal(events.length,1);
events[0].CaseKey=events[0].CaseKey.toUpperCase();
assert.equal((await saveQuality(create,incoming)).caseKey,first.caseKey,'SQL GUID casing must not hide saved detail');assert.equal(events.length,1);
await assert.rejects(saveQuality({...create,body:'달라짐'},incoming));
const request={action:'event',year:2026,caseKey:first.caseKey,version:2,kind:'REQUEST',body:'농장 확인 요청',eventDate:'2026-09-14',dueDate:'2026-09-18',requestId:crypto.randomUUID()};
for(const mode of ['case','anchor']){
 if(mode==='case')cases[0].InboxKey='11111111-1111-4111-8111-111111111111';else anchorOwned=true;
 const writesBefore=caseEventWriteAttempts.length,countBefore=events.length;
 await assert.rejects(saveQuality({...request,kind:'COMMENT',requestId:crypto.randomUUID()},incoming),e=>e.code==='INBOX_REQUIRED'&&e.message.includes('통합 피드백'));
 assert.equal(events.length,countBefore);assert.equal(caseEventWriteAttempts.length,writesBefore,'legacy inbox bypass rejects before writes');
 delete cases[0].InboxKey;anchorOwned=false;
}
await saveQuality(request,incoming);assert.equal(cases[0].Status,'WAITING');
const comment={...request,kind:'COMMENT',version:1,requestId:crypto.randomUUID(),body:'영업부 추가 확인'};
const savedComment=await saveQuality(comment,{...incoming,deptName:'영업부'});assert.equal(cases[0].Status,'WAITING');
assert.equal(savedComment.event.Body,'영업부 추가 확인');assert.equal(savedComment.caseStatus,'WAITING');
assert.equal(events.at(-1).Department,'영업부');assert.equal(events.at(-1).AuthorName,'담당자');
const count=events.length;
await assert.rejects(saveQuality({...request,year:2025,requestId:crypto.randomUUID()},incoming));
await assert.rejects(saveQuality({...request,kind:'RESPONSE',requestId:crypto.randomUUID()},incoming));
assert.equal(events.length,count,'stale response and cross-year must rollback');
await assert.rejects(saveQuality({...request,version:4,kind:'RESPONSE',requestId:crypto.randomUUID()},{...incoming,deptName:'영업부'}));
await saveQuality({...request,version:4,kind:'RESPONSE',requestId:crypto.randomUUID()},incoming);assert.equal(cases[0].Status,'ANSWERED');
const imageKey=crypto.randomUUID();evidence.push({EvidenceKey:imageKey,OrderYear:2026,CreatedBy:'u1',EventKey:null});
await saveQuality({...request,version:5,kind:'COMMENT',body:'사진 근거',evidenceKeys:[imageKey],requestId:crypto.randomUUID()},incoming);
assert.equal(evidence[0].EventKey,events.at(-1).EventKey,'evidence must bind to the immutable event inside the transaction');
const foreignImage=crypto.randomUUID();evidence.push({EvidenceKey:foreignImage,OrderYear:2025,CreatedBy:'u1',EventKey:null});
await assert.rejects(saveQuality({...request,version:6,kind:'COMMENT',body:'다른 연도 사진',evidenceKeys:[foreignImage],requestId:crypto.randomUUID()},incoming));
assert.equal(evidence.at(-1).EventKey,null,'cross-year evidence must remain unbound after rollback');
const loaded=await loadQuality({year:2026,from:1,to:53});
assert.equal(loaded.signalCoverage.analyzedSourceCount,1);assert.equal(loaded.signalCoverage.noPatternSourceCount,1);
assert.equal(loaded.coverage.sourceTotal,1);assert.equal(loaded.coverage.activeTotal,1);assert.equal(loaded.coverage.rows[0].customerName,'업체 미지정');
assert.equal(loaded.cases[0].EventCount,4);
assert.deepEqual(loaded.cases[0].RecentEvents.map(event=>[event.EventNo,event.Kind,event.Body]),[[2,'REQUEST','농장 확인 요청'],[3,'RESPONSE','농장 답변'],[4,'COMMENT','추가 코멘트']]);
await assert.rejects(deleteQualityCase({year:2026,caseKey:first.caseKey,version:cases[0].Version},{userId:'admin'}),error=>error.code==='FARM_QUALITY_DELETE_ADMIN_ONLY');
await assert.rejects(deleteQualityCase({year:2025,caseKey:first.caseKey,version:cases[0].Version},{userId:'nenovaSS3'}));
await assert.rejects(deleteQualityCase({year:2026,caseKey:first.caseKey,version:cases[0].Version-1},{userId:'nenovaSS3'}),error=>error.code==='QUALITY_STALE');
const deleted=await deleteQualityCase({year:2026,caseKey:first.caseKey,version:cases[0].Version},{userId:'nenovaSS3',userName:'관리자'});
assert.equal(deleted.deleted,true);assert.equal(cases.length,0);assert.equal(events.length,0);assert.equal(evidence.length,1,'연결된 이미지만 삭제하고 다른 연도 임시 이미지는 보존한다.');
assert(rollbacks>=4);
console.log('Farm quality transaction mock: idempotent write, year-scoped previews and guarded case deletion passed');

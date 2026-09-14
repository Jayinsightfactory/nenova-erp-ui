import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {qualityScope,qualityGroups,transitionQuality} from '../lib/farmQuality.js';
const source=fs.readFileSync('lib/farmQualityStore.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const incoming={userId:'u1',userName:'담당자',deptName:'수입부'};
let cases=[],events=[],rollbacks=0;
const q=async(sql,p={})=>{
 const v=k=>p[k]?.value;
 if(sql.includes('OBJECT_ID'))return {recordset:[{id:1,caseId:1}]};
 if(sql.includes('SELECT CaseKey,PayloadHash'))return {recordset:events.filter(e=>e.RequestKey===v('req'))};
 if(sql.includes('FROM dbo.WebSalesDefectDeduction'))return {recordset:[{DeductionKey:10,OrderYear:2026,OrderWeek:'36',ProdKey:5,ProductName:'Novia',FarmName:'Farm',FarmKey:2,SourceUnit:'박스',Quantity:1,ImportConfirmed:true}]};
 if(sql.includes('INSERT dbo.WebFarmQualityCase')){cases.push({CaseKey:v('key'),OrderYear:v('year'),Status:'NEW',Version:1});return {recordset:[]};}
 if(sql.includes('SELECT * FROM dbo.WebFarmQualityCase'))return {recordset:cases.filter(c=>c.CaseKey===v('key')&&c.OrderYear===v('year'))};
 if(sql.includes('INSERT dbo.WebFarmQualityEvent')){events.push({CaseKey:v('key'),RequestKey:v('req'),PayloadHash:v('hash'),Kind:v('kind'),Body:v('body'),AuthorName:v('name'),Department:v('dept')});return {recordset:[]};}
 if(sql.includes('UPDATE dbo.WebFarmQualityCase')){const c=cases.find(c=>c.CaseKey===v('key')&&c.OrderYear===v('year'));c.Status=v('status');c.Version++;return {recordset:[]};}
 throw Error('Unexpected SQL '+sql);
};
const tx=async fn=>{const snapshot=structuredClone({cases,events});try{return await fn(q);}catch(e){cases=snapshot.cases;events=snapshot.events;rollbacks++;throw e;}};
const {saveQuality}=await new AsyncFunction('crypto','query','sql','withTransaction','qualityScope','qualityGroups','transitionQuality','canUseDefectIncoming',source+';return {saveQuality};')(crypto,q,{NVarChar:1,Int:2,UniqueIdentifier:3},tx,qualityScope,qualityGroups,transitionQuality,u=>u.deptName==='수입부');
const create={action:'create',year:2026,sourceKey:10,title:'손상',body:'관찰',requestId:crypto.randomUUID()};
const first=await saveQuality(create,incoming);
assert.equal(cases.length,1);assert.equal(events.length,1);
assert.equal((await saveQuality(create,incoming)).caseKey,first.caseKey);assert.equal(events.length,1);
await assert.rejects(saveQuality({...create,body:'달라짐'},incoming));
const request={action:'event',year:2026,caseKey:first.caseKey,version:2,kind:'REQUEST',body:'농장 확인 요청',eventDate:'2026-09-14',dueDate:'2026-09-18',requestId:crypto.randomUUID()};
await saveQuality(request,incoming);assert.equal(cases[0].Status,'WAITING');
const comment={...request,kind:'COMMENT',version:1,requestId:crypto.randomUUID(),body:'영업부 추가 확인'};
await saveQuality(comment,{...incoming,deptName:'영업부'});assert.equal(cases[0].Status,'WAITING');
assert.equal(events.at(-1).Department,'영업부');assert.equal(events.at(-1).AuthorName,'담당자');
const count=events.length;
await assert.rejects(saveQuality({...request,year:2025,requestId:crypto.randomUUID()},incoming));
await assert.rejects(saveQuality({...request,kind:'RESPONSE',requestId:crypto.randomUUID()},incoming));
assert.equal(events.length,count,'stale response and cross-year must rollback');
await assert.rejects(saveQuality({...request,version:4,kind:'RESPONSE',requestId:crypto.randomUUID()},{...incoming,deptName:'영업부'}));
await saveQuality({...request,version:4,kind:'RESPONSE',requestId:crypto.randomUUID()},incoming);assert.equal(cases[0].Status,'ANSWERED');
assert(rollbacks>=4);
console.log('Farm quality transaction mock: idempotent create/replay, state version, comment, author, permissions and year isolation passed');

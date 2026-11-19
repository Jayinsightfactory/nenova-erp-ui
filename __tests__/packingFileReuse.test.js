import test from 'node:test';
import assert from 'node:assert/strict';
import {packingFileReuse,analyzedPackingUploads,readCompletedPackingAnalysis} from '../lib/packingFileReuse.js';
const hash='a'.repeat(64),changed='b'.repeat(64);
const row=(id,extra={})=>({id:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,country:'CO',sourceHash:hash,fileName:'46-1 원본.pdf',hasAnalysis:true,at:'2026-11-18T01:00:00Z',...extra});
test('same bytes reuse the analysis even under a new filename; never infer a new year/week',()=>{
 const old=row(1,{dateYear:'2025',fileName:'2025 46-1.pdf'});
 const plan=packingFileReuse([old],{country:'CO',sourceHash:hash,fileName:'2026 46-1.pdf'});
 assert.equal(plan.exact,old);assert.equal(plan.exact.dateYear,'2025');assert.equal(plan.previous,null);
});
test('same name changed bytes is only a previous-version candidate, not an exact reuse',()=>{
 const old=row(1);const plan=packingFileReuse([old],{country:'CO',sourceHash:changed,fileName:'46-1 원본.pdf'});
 assert.equal(plan.exact,null);assert.equal(plan.previous,old);
});
test('newest analyzed exact copy wins; unanalysed and foreign-country copies never win',()=>{
 const rows=[row(1),row(2,{hasAnalysis:false,at:'2026-11-19'}),row(3,{country:'NL'}),row(4,{at:'2026-11-18T02:00:00Z'})];
 assert.equal(packingFileReuse(rows,{country:'CO',sourceHash:hash,fileName:'other.pdf'}).exact,rows[3]);
 assert.equal(analyzedPackingUploads(rows,'CO').length,1);
 assert.deepEqual(rows.map(r=>r.id.slice(-1)),['1','2','3','4']);
});
test('damaged summaries are excluded and missing hashes fail closed',()=>{
 assert.deepEqual(analyzedPackingUploads([row(1,{id:'../x'}),row(2,{sourceHash:'bad'}),row(3,{fileName:null}),row(4,{hasAnalysis:'true'})],'CO'),[]);
 assert.throws(()=>packingFileReuse([],{country:'CO',sourceHash:''}));
 assert.throws(()=>analyzedPackingUploads(null,'CO'));
});
test('matching-reviewed files pin within country without overriding the newest revision or previous-file reuse',()=>{
 const reviewed=row(1,{matchingReviewed:true,at:'2026-11-17'});
 const pending=row(2,{sourceHash:changed,reviewConfirmed:true,at:'2026-11-19'});
 const foreign=row(3,{country:'CN',matchingReviewed:true});
 assert.deepEqual(analyzedPackingUploads([pending,reviewed,foreign],'CO'),[reviewed,pending]);
 assert.equal(packingFileReuse([pending,reviewed],{country:'CO',sourceHash:'c'.repeat(64),fileName:reviewed.fileName}).previous,pending);
 const latest={...reviewed,matchingReviewed:false,at:'2026-11-20'};
 assert.equal(packingFileReuse([reviewed,latest],{country:'CO',sourceHash:hash,fileName:reviewed.fileName}).exact,latest);
});
test('unconsumed server completion is read with cacheOnly; cache miss never admits analysis',async()=>{
 const bodies=[];let status=200;
 const request=async(url,opts)=>{assert.equal(url,'/api/import/tools/parse-pdf');bodies.push(JSON.parse(opts.body));return {ok:status===200,status,json:async()=>({content:[{type:'text',text:'{}'}],stop_reason:'end_turn'})};};
 assert((await readCompletedPackingAnalysis({country:'CO',pdfBase64:'fixture',request})).content);
 status=404;assert.equal(await readCompletedPackingAnalysis({country:'CO',pdfBase64:'fixture',request}),null);
 assert.deepEqual(bodies,[{country:'CO',pdfBase64:'fixture',cacheOnly:true},{country:'CO',pdfBase64:'fixture',cacheOnly:true}]);
});
test('cache transport or malformed response errors never fall back to a paid request',async()=>{
 let count=0;const request=async()=>{count++;return {ok:false,status:503,json:async()=>({error:{message:'fixture unavailable'}})};};
 await assert.rejects(readCompletedPackingAnalysis({country:'CO',pdfBase64:'x',request}),/fixture unavailable/);assert.equal(count,1);
 await assert.rejects(readCompletedPackingAnalysis({country:'CO',pdfBase64:'x',request:async()=>({ok:true,status:200,json:async()=>({})})}),/자동 재분석하지/);
});

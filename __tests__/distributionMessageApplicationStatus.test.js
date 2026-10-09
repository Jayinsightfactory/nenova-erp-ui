const assert = require('node:assert/strict');
require('./pasteInboxPreanalysis.test');
require('./pasteAnalysisStore.test');
const {groupAppliedItems}=require('../lib/distributionMessageApplicationStatus');
const groupRow=(index,customer,custKey,extra=false)=>({pair:{index,request:{custKey,customerText:customer,inputQty:index+1},unparsedRequest:extra},application:{status:'UNCONFIRMED',entry:null}});
const groupedInput=[groupRow(0,'남대문 청화',10),groupRow(1,'남대문 청화',10),groupRow(2,'같은 이름',11),groupRow(3,'같은 이름',12),groupRow(4,'남대문 청화',10),groupRow(5,'업체 확인 필요',null,true)];
const groupedBefore=JSON.stringify(groupedInput);
const groupedResult=groupAppliedItems(groupedInput);
assert.deepEqual(groupedResult.groups.map(g=>g.items.length),[2,1,1,1]);
assert.deepEqual(groupedResult.groups.flatMap(g=>g.items),groupedInput.slice(0,5),'source order and every item retained');
assert.strictEqual(groupedResult.additional[0],groupedInput[5],'unpaired rows retained, not deleted or marked applied');
assert.equal(JSON.stringify(groupedInput),groupedBefore,'display grouping never mutates quantity or audit evidence');
assert.equal(groupAppliedItems([groupRow(0,'A'),groupRow(1,'A')]).groups.length,1);
assert.equal(groupAppliedItems([groupRow(0,'A'),groupRow(1,'B')]).groups.length,2);
assert.deepEqual(groupAppliedItems([]),{groups:[],additional:[]});
const { summarizeAuditReports } = require('../lib/distributionMessageApplicationStatus');
const identity = 'nenovakakao/chat-a/message-1';
const request = id => ({ id, sourceIdentity: identity, quote: `원문 ${id}`, customerText: '거래처', productText: '품목', inputQty: 2, inputUnit: '박스' });
const finding = (id, status) => ({ id, sourceIdentity: identity, status, reasonKorean: '참고 이력', evidence: { candidateEvents: [{ before: 1, after: 3, unit: '박스', changeAt: '2026-09-11T00:30:00.000Z', week: '37-99', shipmentDate: '2026-09-11' }] } });
const report = (id, createdAt, rows) => ({ id, createdAt, advisoryOnly: true, erpAction: 'NONE', report: { asOf: '2026-09-11T00:40:00.000Z', requests: rows.requests, findings: rows.findings, unresolved: rows.unresolved, warnings: [] } });
const summaries = summarizeAuditReports([report('new', '2026-09-11T00:41:00.000Z', { requests: [request('a'), request('b')], findings: [finding('a', 'MATCHING_HISTORY'), finding('b', 'PARTIAL_HISTORY')], unresolved: [{ sourceIdentity: identity, quote: '미해결', reason: '추가 확인' }] }), report('old', '2026-09-11T00:20:00.000Z', { requests: [request('a')], findings: [finding('a', 'MATCHING_HISTORY')], unresolved: [] })]);
assert.equal(summaries.length, 1); assert.equal(summaries[0].auditId, 'new', 'latest archive wins only by exact source identity'); assert.equal(summaries[0].allMatchingHistory, false, 'one matching request cannot turn a multi-request message into completed'); assert.equal(summaries[0].partialRequestCount, 1); assert.equal(summaries[0].unresolvedCount, 1); assert.equal(summaries[0].entries[0].quote, '원문 a'); assert.equal(summaries[0].entries[0].candidateEvents[0].after, 3);
const complete = summarizeAuditReports([report('complete', '2026-09-11T00:42:00.000Z', { requests: [request('a'), request('b')], findings: [finding('a', 'MATCHING_HISTORY'), finding('b', 'MATCHING_HISTORY')], unresolved: [] })])[0]; assert.equal(complete.allMatchingHistory, true);
const mismatched = summarizeAuditReports([report('wrong-id', '2026-09-11T00:43:00.000Z', { requests: [request('a')], findings: [finding('different', 'MATCHING_HISTORY')], unresolved: [] })])[0]; assert.equal(mismatched.allMatchingHistory, false, 'source identity alone never joins a finding by index');
const duplicate = summarizeAuditReports([report('duplicate', '2026-09-11T00:44:00.000Z', { requests: [request('a'), request('a')], findings: [finding('a', 'MATCHING_HISTORY')], unresolved: [] })])[0]; assert.equal(duplicate.allMatchingHistory, false, 'one finding cannot be reused for duplicate requests');
const extra = summarizeAuditReports([report('extra', '2026-09-11T00:45:00.000Z', { requests: [request('a')], findings: [finding('a', 'MATCHING_HISTORY'), finding('unrequested', 'MATCHING_HISTORY')], unresolved: [] })])[0]; assert.equal(extra.allMatchingHistory, false, 'an unpaired finding prevents a whole-message match');
console.log('distribution message application status tests passed');

const {appliedOperationEntry,matchOperationByExactContent,formatKakaoMessage,sourceConfirmation}=require('../lib/distributionMessageApplicationStatus');
const scope={identity,year:'2026',week:'37-01',requestCount:2};
const operation={sourceIdentity:identity,year:'2026',week:'37-01',status:'committed',verified:true,committedCount:2,at:'2026-09-15 11:00:00',entries:[{sourceIdentity:identity},{sourceIdentity:identity}]};
const manual={sourceIdentity:identity,year:'2026',week:'37-01',status:'MANUALLY_APPLIED',createdAt:'2026-09-15T02:01:00Z'};
assert.equal(sourceConfirmation(scope).confirmed,false);
assert.equal(sourceConfirmation({...scope,manual}).confirmed,true);
assert.equal(sourceConfirmation({...scope,operation}).confirmed,true);
assert.equal(sourceConfirmation({...scope,requestCount:1,operation:{...operation,committedCount:3,entries:[{sourceIdentity:identity},{sourceIdentity:identity},{sourceIdentity:identity}]}}).confirmed,true,'one raw message may expand into multiple successfully committed product rows');
assert.equal(sourceConfirmation({...scope,operation:{...operation,entries:[{sourceIdentity:identity},{sourceIdentity:'different-message'}]}}).confirmed,false,'mixed-source operation rows never auto-confirm this message');
assert.equal(sourceConfirmation({...scope,requestCount:2,appliedItemCount:2}).confirmed,true,'all source requests covered by exact history evidence auto-confirm');
assert.equal(sourceConfirmation({...scope,requestCount:2,appliedItemCount:1}).confirmed,false,'partial history coverage does not confirm the whole source');
for(const patch of [{verified:false},{verified:undefined},{status:'preview'},{status:'failed'},{undo:true},{undone:true},{incomplete:true},{committedCount:1},{year:'2025'},{week:'37-02'},{entries:[{sourceIdentity:identity}]}]) {
  assert.equal(sourceConfirmation({...scope,operation:{...operation,...patch}}).confirmed,false,JSON.stringify(patch));
}
const cancelled={...manual,status:'MANUALLY_NOT_APPLIED'};
assert.equal(sourceConfirmation({...scope,manual:cancelled,operation}).cancelled,true,'later cancellation overrides automatic completion');
assert.equal(sourceConfirmation({...scope,manual:cancelled,operation:{...operation,at:'2026-09-15 11:02:00'}}).confirmed,true,'new successful operation reconfirms using KST vs UTC');
assert.equal(sourceConfirmation({...scope,manual:{...manual,year:'2025'}}).confirmed,false);
assert.equal(sourceConfirmation({...scope,manual:{...manual,status:'CLEAR'}}).confirmed,false);
assert.equal(sourceConfirmation({...scope,operation,requestCount:0}).confirmed,false);
const appliedRequest={id:`${identity}:4`,action:'ADD',custKey:10,prodKey:20,qty:3,unit:'박스'};
const appliedEntry={sourceIdentity:identity,type:'ADD',custKey:10,prodKey:20,custName:'업체',prodName:'장미',qty:3,unit:'박스'};
const exactOperation={sourceIdentity:identity,year:'2026',week:'37-01',status:'committed',verified:true,committedCount:1,entries:[appliedEntry]};
assert.deepEqual(appliedOperationEntry({operation:exactOperation,identity,year:'2026',week:'37-01',request:appliedRequest,requestId:appliedRequest.id,requests:[appliedRequest]}),{status:'APPLIED',entry:appliedEntry});
for(const patch of [{verified:false},{sourceIdentity:'other'},{year:'2025'},{week:'37-02'},{undo:true},{undone:true},{incomplete:true},{entries:[{...appliedEntry,type:'CANCEL'}]},{entries:[appliedEntry,appliedEntry],committedCount:2}]) {
  const changed={...exactOperation,...patch};
  assert.equal(appliedOperationEntry({operation:changed,identity,year:'2026',week:'37-01',request:appliedRequest,requestId:appliedRequest.id,requests:[appliedRequest]}).status,'UNCONFIRMED',JSON.stringify(patch));
}
assert.equal(appliedOperationEntry({operation:exactOperation,identity,year:'2026',week:'37-01',request:appliedRequest,requestId:appliedRequest.id,requests:[appliedRequest,{...appliedRequest,id:`${identity}:5`}]}).status,'UNCONFIRMED','duplicate customer/product/action requests remain unresolved');
assert.equal(appliedOperationEntry({operation:exactOperation,identity,year:'2026',week:'37-01',request:appliedRequest,requestId:'other:4',requests:[appliedRequest]}).status,'UNCONFIRMED','a request id from another message never pairs');
const sourceRow={identity:'chat/source-message',created_at:'2026-10-05T10:00:00+09:00',message:'40-01 변경사항\n업체\n장미 2박스 추가'};
const sourceRequest={id:`${sourceRow.identity}:3`,sourceIdentity:sourceRow.identity,action:'ADD',custKey:10,prodKey:20,inputQty:2,inputUnit:'박스',timestamp_approximate:false,status:'PENDING'};
const externalEntry={sourceIdentity:'another/origin',type:'ADD',custKey:10,prodKey:20,custName:'업체',prodName:'장미',qty:2,unit:'박스'};
const externalOperation={key:9491,sourceIdentity:'another/origin',year:'2026',week:'37-01',at:'2026-10-05 10:05:00',status:'committed',verified:true,committedCount:1,entries:[externalEntry]};
const contentMatches=matchOperationByExactContent({messages:[sourceRow],changesByIdentity:new Map([[sourceRow.identity,[{sourceIndex:2}]]]),liveHistory:{[sourceRow.identity]:{sourceIdentity:sourceRow.identity,status:'MATCHED',requests:[sourceRequest]}},operations:[externalOperation],year:'2026',week:'37-01'});
assert.equal(contentMatches.get(`${sourceRow.identity}\u001f${sourceRequest.id}`)?.matchKind,'OPERATION_CONTENT','a unique exact committed entry can pair despite a different Kakao identity');
assert.equal(sourceConfirmation({...scope,identity:sourceRow.identity,appliedItemCount:contentMatches.size,requestCount:1}).confirmed,true,'exact cross-source operation content confirms and highlights a fully-covered source');
const duplicateSource={...sourceRow,identity:'chat/duplicate-source'};
const duplicateRequests={[sourceRow.identity]:{sourceIdentity:sourceRow.identity,status:'MATCHED',requests:[sourceRequest]},[duplicateSource.identity]:{sourceIdentity:duplicateSource.identity,status:'MATCHED',requests:[{...sourceRequest,id:`${duplicateSource.identity}:3`,sourceIdentity:duplicateSource.identity}]} };
assert.equal(matchOperationByExactContent({messages:[sourceRow,duplicateSource],changesByIdentity:new Map([[sourceRow.identity,[{sourceIndex:2}]],[duplicateSource.identity,[{sourceIndex:2}]]]),liveHistory:duplicateRequests,operations:[externalOperation],year:'2026',week:'37-01'}).size,0,'one operation entry is never reused for duplicate source messages');
assert.equal(matchOperationByExactContent({messages:[sourceRow],changesByIdentity:new Map([[sourceRow.identity,[{sourceIndex:2}]]]),liveHistory:{[sourceRow.identity]:{sourceIdentity:sourceRow.identity,status:'MATCHED',requests:[sourceRequest]}},operations:[externalOperation,{...externalOperation,key:9492}],year:'2026',week:'37-01'}).size,0,'multiple identical processing candidates remain ambiguous');
for(const patch of [{verified:false},{week:'37-02'},{at:'2026-10-05 09:59:00'},{entries:[{...externalEntry,qty:3}]},{entries:[{...externalEntry,unit:'단'}]}]) {
  assert.equal(matchOperationByExactContent({messages:[sourceRow],changesByIdentity:new Map([[sourceRow.identity,[{sourceIndex:2}]]]),liveHistory:{[sourceRow.identity]:{sourceIdentity:sourceRow.identity,status:'MATCHED',requests:[sourceRequest]}},operations:[{...externalOperation,...patch}],year:'2026',week:'37-01'}).size,0,JSON.stringify(patch));
}
const completeMessage='37-01 변경사항\n\n업체 A\n장미 3박스 추가\n\n오늘 출고입니다';
assert.equal(formatKakaoMessage(completeMessage),'37-01 변경사항\n\n업체 A\n장미 3박스 추가\n\n오늘 출고입니다');
assert.equal(formatKakaoMessage(`  ${completeMessage}\n\n`),formatKakaoMessage(completeMessage),'formatting whitespace is normalized without removing message lines');
const ui=require('node:fs').readFileSync(require('node:path').join(__dirname,'../components/orders/DistributionSalesInbox.js'),'utf8');
assert.match(ui,/source-confirm-toggle:/);
assert.match(ui,/confirmation\.confirmed&&!confirmation\.cancelled\?'MANUALLY_NOT_APPLIED':'MANUALLY_APPLIED'/);
assert.match(ui,/compact-match-row \$\{confirmation\.confirmed&&!confirmation\.cancelled\?'history-completed':''\}/,'a confirmed source row receives the completion highlight class');
assert.match(ui,/exactHistoryCoverage=historyApplicationCoverage\(appliedItems,changes.length\)/,'API-only or missing parsed requests prevent whole-source auto-confirmation');
assert.match(ui,/\.\.\.exactHistoryCoverage/,'all items can be confirmed by quantity or verified committed history');
assert.match(ui,/exactContentOperationMatches\.get\(/,'exact cross-source operation history is shown and included in full-source confirmation');
assert.match(ui,/role="alert"/);
assert.match(ui,/previousOperationRevision\.current!==operationRevision/,'only an actual new operation schedules an evidence refresh');
assert.match(ui,/!operationRefreshPending\.current/,'opening or enabling a restored inbox alone must not refresh application evidence');
assert.match(ui,/paired-message-original/,'the full organized Kakao message is visible in the left column');
assert.match(ui,/paired-applied-items/,'the right column shows applied items, not ERP event explanations');
assert.match(ui,/application\.status==='APPLIED'\?'적용':'미확인'/,'only an exact verified item audit is colored applied');
console.log('source confirmation toggle and successful-operation tests passed');

const {readApplicationChannel}=require('../lib/distributionApplicationRefresh');
(async()=>{
  const state={manual:{old:true},audit:{old:true},operation:{old:true}};
  const success=(value)=>({ok:true,json:async()=>value});
  const errorMessage=(data,fallback)=>data.error||fallback;
  const channel=(label,fetchImpl,apply,isCurrent=()=>true)=>readApplicationChannel({label,url:'/fixture',fetchImpl,signal:new AbortController().signal,validate:data=>data.valid===true,apply,isCurrent,errorMessage});
  const results=await Promise.all([
    channel('manual',async()=>success({valid:true,new:true}),data=>{state.manual=data;}),
    channel('audit',async()=>({ok:false,json:async()=>({error:'audit unavailable'})}),data=>{state.audit=data;}),
    channel('operation',async()=>success({valid:true,new:true}),data=>{state.operation=data;}),
  ]);
  assert.deepEqual(results.map(result=>result.ok),[true,false,true],'one failed endpoint does not discard independent successes');
  assert.equal(results[1].error.message,'audit unavailable');
  assert.deepEqual(state.audit,{old:true},'failed channel keeps its previous same-scope result');
  assert.equal(state.manual.new,true);assert.equal(state.operation.new,true);

  let releaseLate;
  let current=true;
  const late=channel('manual',()=>new Promise(resolve=>{releaseLate=resolve;}),data=>{state.manual=data;},()=>current);
  current=false;releaseLate(success({valid:true,late:true}));
  assert.equal((await late).ok,true);
  assert.equal(state.manual.late,undefined,'a prior-scope response cannot replace the current scope');

  const controller=new AbortController();
  const timeout=readApplicationChannel({label:'audit',url:'/fixture',signal:controller.signal,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})))),validate:()=>true,isCurrent:()=>true,apply:()=>{throw Error('aborted response applied');},errorMessage});
  controller.abort();
  assert.equal((await timeout).ok,false,'timed-out channel reports failure without replacing prior data');
  assert.deepEqual(state.audit,{old:true});
  console.log('independent application channels, endpoint failure, stale scope and timeout fixtures passed');
})().catch(error=>{console.error(error);process.exitCode=1;});

const {appliedHistoryEntry,historyApplicationCoverage}=require('../lib/distributionMessageApplicationStatus');
const notApplied={status:'UNCONFIRMED',entry:null};
const sqlRequest={id:`${identity}:1`,shipmentEvents:[{changeAt:'2026-09-15 11:02:00',before:2,after:7}],qty:2};
const sqlPair={request:sqlRequest,requestId:sqlRequest.id,expectedRequestId:sqlRequest.id};
const sql=appliedHistoryEntry({pair:sqlPair,application:notApplied,confirmedRequests:[sqlRequest]});
assert.equal(sql.matchKind,'SQL_HISTORY','exact SQL result applies even when native event represents combined requests');
assert.equal(sql.evidenceAt,'2026-09-15T02:02:00.000Z');
assert.strictEqual(appliedHistoryEntry({pair:sqlPair,application:{status:'APPLIED',matchKind:'OPERATION_CONTENT'},confirmedRequests:[sqlRequest]}).matchKind,'OPERATION_CONTENT','verified web history keeps priority');
for(const patch of [{unparsedRequest:true},{duplicateRequest:true},{requestId:null},{expectedRequestId:'other:1'}]){
 assert.equal(appliedHistoryEntry({pair:{...sqlPair,...patch},application:notApplied,confirmedRequests:[sqlRequest]}).status,'UNCONFIRMED');
}
assert.equal(appliedHistoryEntry({pair:sqlPair,application:notApplied,confirmedRequests:[sqlRequest,sqlRequest],quantityRequests:[sqlRequest]}).status,'UNCONFIRMED','duplicate exact evidence cannot fall through');
const quantity=appliedHistoryEntry({pair:sqlPair,application:notApplied,quantityRequests:[sqlRequest]});
assert.equal(quantity.matchKind,'QUANTITY_HISTORY');assert.equal(quantity.evidenceAt,undefined);
const sqlItems=[{pair:sqlPair,application:sql}];
const coverage=historyApplicationCoverage(sqlItems,1);
assert.deepEqual(coverage,{appliedItemCount:1,evidenceAt:'2026-09-15T02:02:00.000Z'});
assert.equal(sourceConfirmation({...scope,requestCount:1,manual:cancelled,...coverage}).confirmed,true,'later EXE/SQL change reconfirms earlier manual cancellation');
assert.equal(sourceConfirmation({...scope,requestCount:1,manual:{...cancelled,createdAt:'2026-09-15T02:03:00Z'},...coverage}).cancelled,true,'later manual cancellation remains authoritative');
assert.equal(sourceConfirmation({...scope,requestCount:1,manual:cancelled,appliedItemCount:1,evidenceAt:'invalid',asOf:'2099-01-01'}).cancelled,true,'invalid native time and fresh query time cannot override manual cancellation');
assert.equal(historyApplicationCoverage([...sqlItems,...sqlItems],2).appliedItemCount,0,'duplicate source pairs block completion');
assert.equal(historyApplicationCoverage([...sqlItems,{pair:{...sqlPair,unparsedRequest:true},application:sql}],1).appliedItemCount,0,'extra API rows block completion');
assert.equal(historyApplicationCoverage(sqlItems,2).appliedItemCount,0,'missing source requests block completion');
const secondRequest={...sqlRequest,id:`${identity}:2`};
const secondPair={request:secondRequest,requestId:secondRequest.id,expectedRequestId:secondRequest.id};
const mixedCoverage=historyApplicationCoverage([...sqlItems,{pair:secondPair,application:quantity}],2);
assert.deepEqual(mixedCoverage,{appliedItemCount:2,evidenceAt:null},'exact SQL and quantity evidence jointly complete, but numeric candidates cannot override a manual cancellation by timestamp');
assert.equal(sourceConfirmation({...scope,...mixedCoverage}).confirmed,true);
assert.equal(historyApplicationCoverage([{pair:sqlPair,application:{...sql,evidenceAt:null}}],1).evidenceAt,null);
console.log('exact native SQL item coverage and manual timestamp precedence passed');

const oldExactAndNewCandidate={...sqlRequest,shipmentEvents:[{before:0,after:2,changeAt:'2026-09-15 10:00:00'},{before:2,after:7,changeAt:'2026-09-15 12:00:00'}]};
const candidateApplication=appliedHistoryEntry({pair:sqlPair,application:notApplied,confirmedRequests:[oldExactAndNewCandidate]});
assert.equal(candidateApplication.status,'APPLIED','exact SQL comparison still confirms the item');
assert.equal(candidateApplication.evidenceAt,null,'later nonmatching same-key candidate must not supply completion time');
const candidateCoverage=historyApplicationCoverage([{pair:sqlPair,application:candidateApplication}],1);
assert.equal(sourceConfirmation({...scope,requestCount:1,manual:{...cancelled,createdAt:'2026-09-15T02:00:00Z'},...candidateCoverage}).cancelled,true,'old exact history plus unrelated later event cannot override manual cancellation');

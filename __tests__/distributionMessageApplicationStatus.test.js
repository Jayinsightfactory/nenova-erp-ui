const assert = require('node:assert/strict');
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

const {appliedOperationEntry,formatKakaoMessage,sourceConfirmation}=require('../lib/distributionMessageApplicationStatus');
const scope={identity,year:'2026',week:'37-01',requestCount:2};
const operation={sourceIdentity:identity,year:'2026',week:'37-01',status:'committed',committedCount:2,at:'2026-09-15 11:00:00',entries:[{sourceIdentity:identity},{sourceIdentity:identity}]};
const manual={sourceIdentity:identity,year:'2026',week:'37-01',status:'MANUALLY_APPLIED',createdAt:'2026-09-15T02:01:00Z'};
assert.equal(sourceConfirmation(scope).confirmed,false);
assert.equal(sourceConfirmation({...scope,manual}).confirmed,true);
assert.equal(sourceConfirmation({...scope,operation}).confirmed,true);
for(const patch of [{status:'preview'},{status:'failed'},{undo:true},{undone:true},{incomplete:true},{committedCount:1},{year:'2025'},{week:'37-02'},{entries:[{sourceIdentity:identity}]}]) {
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
const completeMessage='37-01 변경사항\n\n업체 A\n장미 3박스 추가\n\n오늘 출고입니다';
assert.equal(formatKakaoMessage(completeMessage),'37-01 변경사항\n\n업체 A\n장미 3박스 추가\n\n오늘 출고입니다');
assert.equal(formatKakaoMessage(`  ${completeMessage}\n\n`),formatKakaoMessage(completeMessage),'formatting whitespace is normalized without removing message lines');
const ui=require('node:fs').readFileSync(require('node:path').join(__dirname,'../components/orders/DistributionSalesInbox.js'),'utf8');
assert.match(ui,/source-confirm-toggle:/);
assert.match(ui,/confirmation\.confirmed&&!confirmation\.cancelled\?'MANUALLY_NOT_APPLIED':'MANUALLY_APPLIED'/);
assert.match(ui,/role="alert"/);
assert.match(ui,/applicationScope,open,disabled,operationRevision/);
assert.match(ui,/paired-message-original/,'the full organized Kakao message is visible in the left column');
assert.match(ui,/paired-applied-items/,'the right column shows applied items, not ERP event explanations');
assert.match(ui,/application\.status==='APPLIED'\?'적용':'미확인'/,'only an exact verified item audit is colored applied');
console.log('source confirmation toggle and successful-operation tests passed');

'use strict';

{
  const assert=require('node:assert/strict');
  const {confirmedHistoryRequests}=require('../lib/distributionCompactMatchUi');
  const comparison={products:[{requests:[{sourceIdentity:'mixed',requestId:'a',evidenceStatus:'CONSISTENT',requestedSignedDelta:-2,observedSignedDelta:-2}]}]};
  const item={sourceIdentity:'mixed',status:'AMBIGUOUS',requests:[{id:'a',status:'DISTRIBUTION_EVIDENCE'},{id:'b',status:'AMBIGUOUS'}]};
  assert.deepEqual(confirmedHistoryRequests(comparison,'mixed',item).map(r=>r.id),['a']);
  assert.equal(confirmedHistoryRequests(comparison,'other',item).length,0);
  assert.equal(confirmedHistoryRequests(comparison,'mixed',{...item,requests:[...item.requests,item.requests[0]]}).length,0);
  assert.equal(confirmedHistoryRequests(comparison,'mixed',{...item,requests:[{id:'a',status:'ORDER_ONLY'}]}).length,0);
}

const assert = require('node:assert/strict');
const { classifyMessage, summarizeMessage, matchingSummary } = require('../lib/distributionCompactMatchUi');

assert.equal(classifyMessage({ message: '37-1 잔량\n수국 3\n장미 2' }), 'STOCK');
assert.equal(classifyMessage('*호주 36차 잔량\n소재2호\n에뮤그라스 2\n반커부쉬 1+3단\n37-1 베트남 호접 잔량\n화이트 8F - 41 box (655st)'), 'STOCK', 'stock table separator is not a signed cancellation');
assert.equal(classifyMessage('@담당자\n메시지가 삭제되었습니다.'), 'REVIEW', 'Kakao tombstone is not an ERP deletion request');
assert.equal(classifyMessage('메시지가 삭제되었습니다.\n라움\n화이트 1박스 취소'), 'REQUEST', 'actual remaining request is preserved');
assert.equal(classifyMessage('재고\n화이트 -1박스'), 'REQUEST', 'attached negative quantity remains reviewable as a request');
assert.equal(classifyMessage({ message: '출고 후 잔량\n화이트 2' }), 'STOCK', '출고 is a noun here, not a distribution action');
assert.equal(classifyMessage({ message: '재고\n화이트 +1' }), 'REQUEST', 'signed changes must not disappear into stock');
assert.equal(classifyMessage({ message: '변화\n화이트 1' }), 'REVIEW');
for (const action of ['추가', '증가', '늘려', '더해', '플러스', '취소', '감소', '빼', '마이너스', '차감']) {
  assert.equal(classifyMessage({ message: `재고\n화이트 1박스 ${action}` }), 'REQUEST', `${action} is a canonical request action`);
}
assert.equal(classifyMessage({ message: '라움\n수국 1박스 취소\n재고로 잡아주세요' }), 'REQUEST', 'a cancellation remains a request even with stock wording');
assert.equal(classifyMessage({ message: '라움\n수국 1박스 삭제' }), 'REQUEST', 'ambiguous destructive wording remains a request for review, not a stock header');
assert.equal(classifyMessage({ message: '37-1 분배 요청\n라움 수국' }), 'REVIEW');
assert.equal(classifyMessage('소재2호\n레몬잎 5박스\n오늘 출고 부탁합니다'),'REVIEW');
assert.equal(classifyMessage('37차 레몬잎 추가\n소재2호\n레몬잎 5박스\n-> 오늘 출고입니다'),'REQUEST');
assert.equal(classifyMessage('네덜란드 잔량\n마트리카리아 50st(검역 -5st)'),'STOCK');
assert.equal(classifyMessage('37-1 중국잔량 (태림취소분)\n킹스데이 10단\n전산 반영해놨습니다'),'STOCK');
assert.equal(classifyMessage('추가취소방에 전달 안됐다고 합니다'),'REVIEW');
assert.equal(classifyMessage('잔량\n화이트 2박스 취소\n라움으로 2박스 추가'),'REQUEST');
assert.equal(classifyMessage({ message: '재고 확인 부탁드립니다' }), 'REVIEW');
assert.equal(classifyMessage({ message: '무슨 뜻인지 확인 필요' }), 'REVIEW');
assert.equal(summarizeMessage({ message: '37-1 카네이션\n라움\n화이트 1박스 추가\n꽃길\n레드 1박스 취소' }), '라움 · 화이트 1박스 추가 외 1건');
assert.equal(summarizeMessage({ message: '37-1 변경사항\n화이트 1박스 추가' }), '화이트 1박스 추가', 'a generic header is never guessed as a customer');
assert.equal(summarizeMessage({ message: '37-1 변경사항\n라움\n취소\n화이트 1박스\n블루 1박스' }), '라움 · 화이트 1박스 취소 외 1건', 'a standalone action applies to following quantity lines');
assert.equal(summarizeMessage({ message: '라움\n화이트 1박스 취소\n블루 1박스' }), '라움 · 화이트 1박스 취소 외 1건', 'the next quantity line inherits the immediately known action');
assert.equal(summarizeMessage({ message: '' }), '내용 확인 필요');

const consistent = (requestId, sourceIdentity, evidenceStatus = 'CONSISTENT', requestedSignedDelta = 1, observedSignedDelta = 1) => ({ requestId, sourceIdentity, custKey: 1, prodKey: 7, evidenceStatus, requestedSignedDelta, observedSignedDelta });
const comparison = { products: [{ prodKey: 7, prodName: '화이트', requests: [consistent('r1', 'm1'), consistent('r2', 'm1'), consistent('r3', 'm1', 'UNCONFIRMED')] }] };
const request = (id, action = 'ADD', status = 'DISTRIBUTION_EVIDENCE') => ({ id, customerText: '라움', productText: '화이트', action, status, shipmentEvents: [{ eventId: id }] });
const liveItem = { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [request('r1'), request('r2'), request('r3', 'CANCEL')] };
const partial = matchingSummary(comparison, 'm1', liveItem);
assert.deepEqual(partial, { status: 'PARTIAL', label: '일부 매칭', matchedCount: 2, totalCount: 3, operationSummary: '라움 · 화이트 · 분배 추가' });

const matched = matchingSummary({ products: [{ prodKey: 7, prodName: '화이트', requests: [consistent('r1', 'm1')] }] }, 'm1', { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [request('r1')] });
assert.equal(matched.status, 'MATCHED'); assert.equal(matched.label, '매칭');
assert.equal(matched.operationSummary, '라움 · 화이트 · 분배 추가');

const numericCandidate = matchingSummary({ products: [] }, 'm-candidate', {
  sourceIdentity: 'm-candidate', status: 'UNIT_HISTORY_CANDIDATE',
  requests: [{ id: 'candidate-1', customerText: '라움', productText: '플라야블랑카', action: 'ADD', inputUnit: '단', unit: '송이', status: 'UNIT_HISTORY_CANDIDATE', matchState: 'NUMERIC_HISTORY_CANDIDATE', shipmentEvents: [{ eventId: 's1' }] }],
});
assert.deepEqual(numericCandidate, { status: 'CANDIDATE', label: '이력 후보', matchedCount: 1, totalCount: 1, operationSummary: '라움 · 플라야블랑카 · 분배 추가 후보 · 단→송이' });
const productCandidate = matchingSummary(null, 'm-product-candidate', {
  sourceIdentity: 'm-product-candidate', status: 'PRODUCT_HISTORY_CANDIDATE',
  requests: [{ id: 'product-candidate-1', customerText: '라움', productText: 'Ecuador Playa Blanca', action: 'ADD', inputUnit: '단', unit: '송이', status: 'PRODUCT_HISTORY_CANDIDATE', matchState: 'NUMERIC_HISTORY_CANDIDATE', shipmentEvents: [{ eventId: 's2' }] }],
});
assert.deepEqual(productCandidate, { status: 'CANDIDATE', label: '이력 후보', matchedCount: 1, totalCount: 1, operationSummary: '라움 · Ecuador Playa Blanca · 분배 추가 후보 · 단→송이' });

const observedCancel = matchingSummary({ products: [{ requests: [consistent('r1', 'm1', 'CONSISTENT', -1, -1)] }] }, 'm1', { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [request('r1', 'ADD')] });
assert.equal(observedCancel.operationSummary, '라움 · 화이트 · 분배 취소', 'summary direction comes from observed evidence, not the request action');

const shipmentEventWithoutStatus = matchingSummary({ products: [{ requests: [consistent('r1', 'm1')] }] }, 'm1', { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [request('r1', 'ADD', null)] });
assert.equal(shipmentEventWithoutStatus.status, 'UNCONFIRMED', 'a shipment event alone is not explicit distribution evidence');

const ambiguousItem = matchingSummary({ products: [{ requests: [consistent('r1', 'm1')] }] }, 'm1', { sourceIdentity: 'm1', status: 'AMBIGUOUS', requests: [request('r1')] });
assert.equal(ambiguousItem.status, 'PARTIAL'); assert.equal(ambiguousItem.matchedCount, 1);

const duplicate = matchingSummary({ products: [{ requests: [consistent('same', 'm1')] }] }, 'm1', { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [request('same'), request('same')] });
assert.equal(duplicate.status, 'UNCONFIRMED'); assert.equal(duplicate.matchedCount, 0); assert.equal(duplicate.totalCount, 2);
const missingId = matchingSummary({ products: [{ requests: [consistent('r1', 'm1')] }] }, 'm1', { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [request('r1'), { customerText: '라움', shipmentEvents: [{ eventId: 'x' }] }] });
assert.equal(missingId.status, 'PARTIAL'); assert.equal(missingId.matchedCount, 1); assert.equal(missingId.totalCount, 2);
const orderOnly = matchingSummary({ products: [{ requests: [consistent('r1', 'm1')] }] }, 'm1', { sourceIdentity: 'm1', status: 'ORDER_ONLY', requests: [{ ...request('r1'), status: 'ORDER_ONLY', shipmentEvents: [] }] });
assert.equal(orderOnly.status, 'UNCONFIRMED');
const manualOnly = matchingSummary({ products: [{ requests: [consistent('r1', 'm1')] }] }, 'm1', { sourceIdentity: 'm1', manualApplication: 'MANUALLY_APPLIED', requests: [] });
assert.equal(manualOnly.status, 'UNCONFIRMED'); assert.equal(manualOnly.totalCount, 0);
const wrongIdentity = matchingSummary({ products: [{ requests: [consistent('r1', 'other')] }] }, 'm1', { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [request('r1')] });
assert.equal(wrongIdentity.status, 'UNCONFIRMED');
const extraComparisonRequest = matchingSummary({ products: [{ requests: [consistent('r1', 'm1'), consistent('extra', 'm1')] }] }, 'm1', { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [request('r1')] });
assert.equal(extraComparisonRequest.status, 'PARTIAL'); assert.equal(extraComparisonRequest.matchedCount, 1); assert.equal(extraComparisonRequest.totalCount, 1);
const missingLiveIdentity = matchingSummary({ products: [{ requests: [consistent('r1', 'm1')] }] }, 'm1', { status: 'DISTRIBUTION_EVIDENCE', requests: [request('r1')] });
assert.equal(missingLiveIdentity.status, 'UNCONFIRMED');
const partialHistoryOnly = matchingSummary({ products: [{ requests: [consistent('r1', 'm1', 'PARTIAL', 5, 2)] }] }, 'm1', { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [request('r1')] });
assert.deepEqual(partialHistoryOnly, { status: 'PARTIAL', label: '일부 매칭', matchedCount: 0, totalCount: 1, operationSummary: '대응 작업 미확인' });
const partialWithoutPublicEvent = matchingSummary({ products: [{ requests: [consistent('r1', 'm1', 'PARTIAL', 5, 2)] }] }, 'm1', { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [{ ...request('r1'), shipmentEvents: [] }] });
assert.equal(partialWithoutPublicEvent.status, 'PARTIAL'); assert.equal(partialWithoutPublicEvent.matchedCount, 0);
const invalidComparisonNumbers = matchingSummary({ products: [{ requests: [consistent('r1', 'm1', 'CONSISTENT', 1, '1')] }] }, 'm1', { sourceIdentity: 'm1', status: 'DISTRIBUTION_EVIDENCE', requests: [request('r1')] });
assert.equal(invalidComparisonNumbers.status, 'UNCONFIRMED');
console.log('distribution compact match UI tests passed');

{
  const {quantityProcessedRequests}=require('../lib/distributionCompactMatchUi');
  const candidate={id:'quantity-1',status:'PRODUCT_HISTORY_CANDIDATE',matchState:'NUMERIC_HISTORY_CANDIDATE',action:'CANCEL',inputQty:2,inputUnit:'박스',unit:'박스',shipmentEvents:[{eventId:'qty-event',before:5,after:3,unit:'박스'}]};
  const item={sourceIdentity:'quantity-source',status:'PRODUCT_HISTORY_CANDIDATE',requests:[candidate]};
  assert.equal(quantityProcessedRequests('quantity-source',item).length,1);
  assert.equal(matchingSummary(null,'quantity-source',item).status,'QUANTITY_MATCHED');
  assert.equal(quantityProcessedRequests('other-year-source',item).length,0);
  // Display-unit differences are valid when the normalized ERP quantity is the
  // same (e.g. 1박스 versus 10단). Keep true near-misses covered separately.
  assert.equal(quantityProcessedRequests('quantity-source',{...item,requests:[{...candidate,inputUnit:'단',unit:'단',qty:2}]}).length,1);
  for(const delta of [{action:'ADD'},{inputQty:3,qty:3},{status:'AMBIGUOUS'},{status:'ORDER_ONLY'},{inputQty:NaN,qty:NaN}]) {
    assert.equal(quantityProcessedRequests('quantity-source',{...item,requests:[{...candidate,...delta}]}).length,0);
  }
  assert.equal(quantityProcessedRequests('quantity-source',{...item,requests:[candidate,candidate]}).length,0);
  const mixed={...item,status:'AMBIGUOUS',requests:[candidate,{id:'pending',status:'AMBIGUOUS'}]};
  assert.equal(quantityProcessedRequests('quantity-source',mixed).length,1);
  assert.notEqual(matchingSummary(null,'quantity-source',mixed).status,'QUANTITY_MATCHED');
  const exact={id:'exact',status:'DISTRIBUTION_EVIDENCE'};
  const balance={products:[{requests:[consistent('exact','quantity-source')]}]};
  assert.equal(matchingSummary(balance,'quantity-source',{...item,status:'AMBIGUOUS',requests:[candidate,exact]}).status,'QUANTITY_MATCHED');
  console.log('user quantity processing policy: positive, near misses, mixed coverage passed');
}

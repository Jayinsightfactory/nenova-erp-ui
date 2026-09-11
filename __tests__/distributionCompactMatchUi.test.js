'use strict';

const assert = require('node:assert/strict');
const { classifyMessage, summarizeMessage, matchingSummary } = require('../lib/distributionCompactMatchUi');

assert.equal(classifyMessage({ message: '37-1 잔량\n수국 3\n장미 2' }), 'STOCK');
assert.equal(classifyMessage({ message: '출고 후 잔량\n화이트 2' }), 'STOCK', '출고 is a noun here, not a distribution action');
assert.equal(classifyMessage({ message: '재고\n화이트 +1' }), 'REQUEST', 'signed changes must not disappear into stock');
assert.equal(classifyMessage({ message: '변화\n화이트 1' }), 'REQUEST');
for (const action of ['추가', '증가', '늘려', '더해', '플러스', '취소', '감소', '빼', '마이너스', '차감']) {
  assert.equal(classifyMessage({ message: `재고\n화이트 1박스 ${action}` }), 'REQUEST', `${action} is a canonical request action`);
}
assert.equal(classifyMessage({ message: '라움\n수국 1박스 취소\n재고로 잡아주세요' }), 'REQUEST', 'a cancellation remains a request even with stock wording');
assert.equal(classifyMessage({ message: '라움\n수국 1박스 삭제' }), 'REQUEST', 'ambiguous destructive wording remains a request for review, not a stock header');
assert.equal(classifyMessage({ message: '37-1 분배 요청\n라움 수국' }), 'REQUEST');
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
